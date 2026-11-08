import imageSize from 'image-size';
import { createWorker } from 'tesseract.js';
import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../application/ports/receipt-extractor';
import { amountFromText } from './amount-from-text';

const NO_AMOUNT: ExtractionResult = { amount: null, confidence: 0 };
const MAX_BYTES = 5 * 1024 * 1024;

/** Wall-clock limit for one OCR run. A legible receipt takes about a second; 10 s is generous. */
export const OCR_TIMEOUT_MS = 10_000;
/**
 * Decoded-size ceiling (width x height) checked from the header before OCR. 12 MP covers any
 * phone photo of a receipt (a 4000x3000 shot) while bounding the memory a decompression bomb
 * can claim.
 */
export const MAX_IMAGE_PIXELS = 12_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function hasImageSignature(buffer: Buffer): boolean {
  return (
    (buffer.length >= PNG_SIGNATURE.length &&
      buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) ||
    (buffer.length >= JPEG_SIGNATURE.length &&
      buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE))
  );
}

export interface TesseractImageExtractorOptions {
  /** Hard wall-clock limit for one OCR run; the worker is terminated when it is exceeded. */
  timeoutMs?: number;
  /** Images with more pixels than this are refused before decoding (decompression bombs). */
  maxPixels?: number;
  /** OCR runs allowed at the same time; extra calls fail fast instead of piling up. */
  maxConcurrent?: number;
}

/** OCR with the Portuguese data bundled in node_modules: no download at run time. */
export class TesseractImageExtractor implements ReceiptExtractor {
  private readonly timeoutMs: number;
  private readonly maxPixels: number;
  private readonly maxConcurrent: number;
  private running = 0;

  constructor(options: TesseractImageExtractorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
    this.maxPixels = options.maxPixels ?? MAX_IMAGE_PIXELS;
    this.maxConcurrent = options.maxConcurrent ?? 2;
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return NO_AMOUNT;
    if (!this.hasSafeDimensions(buffer)) return NO_AMOUNT;
    if (this.running >= this.maxConcurrent) throw new Error('OCR is busy');

    this.running++;
    try {
      const text = await this.recognize(buffer);
      return amountFromText(text, 'ocr');
    } finally {
      this.running--;
    }
  }

  /** Reads only the image header; anything unreadable or too large is refused. */
  private hasSafeDimensions(buffer: Buffer): boolean {
    // image-size understands many formats (and has had parser bugs); it only ever sees the two
    // we accept.
    if (!hasImageSignature(buffer)) return false;
    try {
      const { width, height } = imageSize(buffer);
      if (!width || !height) return false;
      return width * height <= this.maxPixels;
    } catch {
      return false;
    }
  }

  private async recognize(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { langPath } = require('@tesseract.js-data/por') as { langPath: string };
    const worker = await createWorker('por', 1, {
      langPath,
      gzip: true,
      cacheMethod: 'none',
      // Without a handler tesseract.js rethrows a decoding failure from inside the worker's
      // message callback, which is an uncaught exception that kills the whole process. With
      // one, the failure just rejects the recognize() promise, handled below.
      errorHandler: () => undefined,
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('OCR timed out')), this.timeoutMs);
      });
      const result = await Promise.race([worker.recognize(buffer), timeout]);
      return result.data.text;
    } catch (error) {
      if (error instanceof Error && error.message === 'OCR timed out') throw error;
      // Undecodable image: nothing readable.
      return '';
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  }
}
