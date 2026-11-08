import { Worker } from 'node:worker_threads';
import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../application/ports/receipt-extractor';
import { amountFromText } from './amount-from-text';

const NO_AMOUNT: ExtractionResult = { amount: null, confidence: 0 };
const MAX_BYTES = 5 * 1024 * 1024;

export interface PdfTextExtractorOptions {
  /** Pages read from the start of the document; the rest is ignored. */
  maxPages?: number;
  /** Hard wall-clock limit; the parsing thread is killed when it is exceeded. */
  timeoutMs?: number;
}

// pdf-parse (pdf.js) loads its own worker through a dynamic import() that Jest's CommonJS VM
// cannot run, and parsing an untrusted PDF is exactly what we want to be able to kill. So the
// parsing runs in a throw-away worker thread with a memory cap, started from this inline
// CommonJS script (eval: true), which works the same under Jest and in production.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { PDFParse } = require(workerData.module);
  const parser = new PDFParse({ data: new Uint8Array(workerData.data), isEvalSupported: false });
  try {
    const result = await parser.getText({ first: workerData.maxPages });
    parentPort.postMessage({ text: result.text });
  } finally {
    await parser.destroy();
  }
})().catch((error) => parentPort.postMessage({ error: String(error && error.message) }));
`;

export class PdfTextExtractor implements ReceiptExtractor {
  private readonly maxPages: number;
  private readonly timeoutMs: number;

  constructor(options: PdfTextExtractorOptions = {}) {
    this.maxPages = options.maxPages ?? 5;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return NO_AMOUNT;
    const text = await this.readText(buffer);
    return text === null ? NO_AMOUNT : amountFromText(text, 'native');
  }

  /** Text of the first pages, or null when the file is not a readable PDF. Throws on timeout. */
  private readText(buffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          module: require.resolve('pdf-parse'),
          data: buffer,
          maxPages: this.maxPages,
        },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('PDF extraction timed out'));
      }, this.timeoutMs);
      const finish = (value: string | null) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(value);
      };
      worker.once('message', (message: { text?: string; error?: string }) =>
        finish(typeof message.text === 'string' ? message.text : null),
      );
      // A crash or out-of-memory kill on a hostile file just means "nothing readable".
      worker.once('error', () => finish(null));
      worker.once('exit', () => finish(null));
    });
  }
}
