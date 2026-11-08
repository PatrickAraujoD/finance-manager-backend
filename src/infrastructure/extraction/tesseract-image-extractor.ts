import imageSize from 'image-size';
import { createWorker } from 'tesseract.js';
import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../application/ports/receipt-extractor';
import { amountFromText } from './amount-from-text';

const NO_AMOUNT: ExtractionResult = { amount: null, confidence: 0 };
const MAX_BYTES = 5 * 1024 * 1024;

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
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxPixels = options.maxPixels ?? 25_000_000;
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
    const worker = await createWorker('por', 1, { langPath, gzip: true, cacheMethod: 'none' });
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
