import { createDeflate } from 'node:zlib';

/** Deflates `gigabytes` GiB of spaces without ever holding more than a chunk in memory. */
function deflateSpaces(gigabytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const deflate = createDeflate({ level: 9 });
    const parts: Buffer[] = [];
    deflate.on('data', (part: Buffer) => parts.push(part));
    deflate.on('end', () => resolve(Buffer.concat(parts)));
    deflate.on('error', reject);
    const chunk = Buffer.alloc(1 << 20, 0x20);
    let written = 0;
    const pump = (): void => {
      while (written < gigabytes * 1024) {
        written++;
        if (!deflate.write(chunk)) {
          deflate.once('drain', pump);
          return;
        }
      }
      deflate.end();
    };
    pump();
  });
}

/**
 * A valid-looking one-page PDF whose only content stream is a Flate bomb: about 1 MB of file
 * per GiB of spaces it inflates to. Generated at test time so no large binary is committed.
 */
export async function flateBombPdf(gigabytes: number): Promise<Buffer> {
  const data = await deflateSpaces(gigabytes);
  const head =
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n' +
    `4 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`;
  const tail = '\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n';
  return Buffer.concat([Buffer.from(head, 'latin1'), data, Buffer.from(tail, 'latin1')]);
}

/** Samples this process's RSS while it is running; `peakGrowthMb()` is the rise over the start. */
export class RssSampler {
  private peak = process.memoryUsage().rss;
  private readonly start = this.peak;
  private readonly timer = setInterval(() => {
    this.peak = Math.max(this.peak, process.memoryUsage().rss);
  }, 25);

  stop(): void {
    clearInterval(this.timer);
    this.peak = Math.max(this.peak, process.memoryUsage().rss);
  }

  peakGrowthMb(): number {
    return (this.peak - this.start) / 1024 / 1024;
  }
}
