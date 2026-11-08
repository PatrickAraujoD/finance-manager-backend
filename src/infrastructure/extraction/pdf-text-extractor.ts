import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../application/ports/receipt-extractor';
import { amountFromText } from './amount-from-text';

const NO_AMOUNT: ExtractionResult = { amount: null, confidence: 0 };
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RESULT_CHARS = 1_000_000;

/** Wall-clock limit for one extraction; the child is killed when it is exceeded. */
export const PDF_TIMEOUT_MS = 8_000;
/** Resident memory limit of the child. Beyond it the child is killed, whatever it is doing. */
export const PDF_MAX_RSS_MB = 512;
/** Extractions allowed at once; further calls fail fast instead of queueing. */
export const PDF_MAX_CONCURRENT = 2;
/** How often the parent samples the child's memory. */
const RSS_POLL_MS = 100;
// V8 heap cap inside the child. It does not cover typed arrays, which is why the RSS watchdog
// exists too; it just makes plain JS runaway fail early.
const CHILD_HEAP_MB = 192;
// Marks our children in `ps` so tests (and operators) can tell them apart.
const CHILD_MARKER = '--fm-pdf-child';

export interface PdfTextExtractorOptions {
  /** Pages read from the start of the document; the rest is ignored. */
  maxPages?: number;
  /** Hard wall-clock limit; the child process is killed when it is exceeded. */
  timeoutMs?: number;
  /** Resident memory limit of the child, in MB; it is killed above it. */
  maxRssMb?: number;
  /** Extractions that may run at the same time; extra calls fail fast. */
  maxConcurrent?: number;
}

// Parsing an untrusted PDF is the riskiest thing this server does, so it runs in a disposable
// child process (a plain `node -e` script, no build step, same under Jest and in production):
//  - the PDF arrives on stdin and the text leaves on fd 3, so whatever pdf.js prints on
//    stdout/stderr (paths, stack traces) is discarded and can never reach a response;
//  - the process is started with an empty environment (no secrets to read) and dies after one
//    document, which returns every byte of memory to the OS (a worker thread kept leaking);
//  - the parent watches its RSS and wall clock and sends SIGKILL, so no input can use more
//    than the limits below.
const CHILD_SOURCE = `
const fs = require('node:fs');
const [modulePath, maxPages, hardLimitMs] = process.argv.slice(1);
// Last line of defence if the parent disappears: the child never outlives its time limit.
setTimeout(() => process.exit(2), Number(hardLimitMs));
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const { PDFParse } = require(modulePath);
    const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false });
    const result = await parser.getText({ first: Number(maxPages) });
    fs.writeSync(3, JSON.stringify({ text: result.text }));
    process.exit(0);
  } catch {
    process.exit(1);
  }
});
`;

export class PdfTextExtractor implements ReceiptExtractor {
  private readonly maxPages: number;
  private readonly timeoutMs: number;
  private readonly maxRssBytes: number;
  private readonly maxConcurrent: number;
  private running = 0;

  constructor(options: PdfTextExtractorOptions = {}) {
    this.maxPages = options.maxPages ?? 5;
    this.timeoutMs = options.timeoutMs ?? PDF_TIMEOUT_MS;
    this.maxRssBytes = (options.maxRssMb ?? PDF_MAX_RSS_MB) * 1024 * 1024;
    this.maxConcurrent = options.maxConcurrent ?? PDF_MAX_CONCURRENT;
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return NO_AMOUNT;
    if (this.running >= this.maxConcurrent) throw new Error('PDF extraction is busy');

    this.running++;
    try {
      const text = await this.readText(buffer);
      return text === null ? NO_AMOUNT : amountFromText(text, 'native');
    } finally {
      this.running--;
    }
  }

  /** Text of the first pages, or null when unreadable or over the memory limit. */
  private readText(buffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          `--max-old-space-size=${CHILD_HEAP_MB}`,
          '-e',
          CHILD_SOURCE,
          require.resolve('pdf-parse'),
          String(this.maxPages),
          String(this.timeoutMs + 1_000),
          CHILD_MARKER,
        ],
        { stdio: ['pipe', 'ignore', 'ignore', 'pipe'], env: {} },
      );

      let output = '';
      let settled = false;
      let polling = false;
      let timedOut = false;
      let killedForMemory = false;

      const kill = () => child.kill('SIGKILL');
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, this.timeoutMs);
      const watchdog = setInterval(() => {
        if (polling || child.pid === undefined) return;
        polling = true;
        // Fail closed: if the child's memory cannot be read, it cannot be limited, so it dies.
        readRssBytes(child.pid).then(
          (rssBytes) => {
            polling = false;
            if (!settled && rssBytes > this.maxRssBytes) {
              killedForMemory = true;
              kill();
            }
          },
          () => {
            // A child that just exited normally also makes the read fail; give its exit event
            // a moment to arrive before treating the failure as "cannot be measured".
            setTimeout(() => {
              polling = false;
              if (settled || child.exitCode !== null || child.signalCode !== null) return;
              killedForMemory = true;
              kill();
            }, 50);
          },
        );
      }, RSS_POLL_MS);

      child.stdio[3]?.on('data', (chunk: Buffer) => {
        if (output.length < MAX_RESULT_CHARS * 2) output += chunk.toString('utf8');
      });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(buffer);
      child.on('error', () => finish(null));
      // 'close' fires once the process is gone and its pipes are drained: no zombie is left.
      child.on('close', () => {
        if (timedOut) return fail(new Error('PDF extraction timed out'));
        if (killedForMemory) return finish(null);
        finish(parseOutput(output));
      });

      function finish(value: string | null): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        resolve(value);
      }
      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        reject(error);
      }
    });
  }
}

/**
 * Resident memory of a process, in bytes. Reads /proc/<pid>/status (Linux, no extra binary) and
 * falls back to `ps -o rss=` (macOS; needs `procps` in slim Docker images). Rejects when neither
 * gives a positive number, so the caller can fail closed.
 */
async function readRssBytes(pid: number): Promise<number> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const kib = Number.parseInt(/^VmRSS:\s*(\d+)\s*kB/m.exec(status)?.[1] ?? '', 10);
    if (Number.isFinite(kib) && kib > 0) return kib * 1024;
  } catch {
    // No /proc (macOS) or the process is gone: try ps.
  }
  return new Promise((resolve, reject) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 1_000 }, (error, out) => {
      const kib = Number.parseInt(out, 10);
      if (error || !Number.isFinite(kib) || kib <= 0) return reject(new Error('RSS unreadable'));
      resolve(kib * 1024);
    });
  });
}

function parseOutput(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text.slice(0, MAX_RESULT_CHARS) : null;
  } catch {
    return null;
  }
}
