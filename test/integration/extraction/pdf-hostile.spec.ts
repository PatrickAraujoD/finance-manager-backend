import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfTextExtractor } from '../../../src/infrastructure/extraction/pdf-text-extractor';
import { RssSampler, flateBombPdf } from './support/pdf-bombs';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

/** Lines of `ps` that are PDF extraction children started by this project. */
function leftoverChildren(): string[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  // pid, ppid, then a command that starts with the node binary and carries the marker argument.
  return out
    .split('\n')
    .filter((line) => /^\s*\d+\s+\d+\s+\S*node\s/.test(line) && line.includes('--fm-pdf-child'));
}

describe('PdfTextExtractor against hostile PDFs', () => {
  jest.setTimeout(300_000);

  // Ceiling for how much the *server* process may grow while it parses a hostile file. The
  // parsing happens elsewhere (a child process), so this only has to cover noise.
  const PARENT_GROWTH_LIMIT_MB = 200;

  it('survives a ~1 MB Flate bomb that inflates to 1 GiB, with the parent RSS flat', async () => {
    const bomb = await flateBombPdf(1);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const sampler = new RssSampler();
    const result = await new PdfTextExtractor().extract(bomb).catch(() => null);
    sampler.stop();
    expect(result === null || result.amount === null).toBe(true);
    expect(sampler.peakGrowthMb()).toBeLessThan(PARENT_GROWTH_LIMIT_MB);
  });

  it('kills a PDF below 5 MB whose stream claims 4 GiB, in bounded time', async () => {
    const bomb = await flateBombPdf(4);
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const sampler = new RssSampler();
    const started = Date.now();
    const result = await new PdfTextExtractor().extract(bomb).catch(() => null);
    sampler.stop();
    expect(result === null || result.amount === null).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(sampler.peakGrowthMb()).toBeLessThan(PARENT_GROWTH_LIMIT_MB);
  });

  it('does not grow the parent over 100 consecutive extractions', async () => {
    const extractor = new PdfTextExtractor();
    const pdf = fixture('comprovante-texto.pdf');
    // Warm-up, so one-time allocations are not counted as growth.
    await extractor.extract(pdf);
    global.gc?.();
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 100; i++) {
      expect((await extractor.extract(pdf)).amount?.cents).toBe(12345);
    }
    global.gc?.();
    const growthMb = (process.memoryUsage().rss - before) / 1024 / 1024;
    // The old worker-thread design leaked roughly 7 MB per run (700 MB over 100 runs). 150 MB
    // is generous for noise and still catches that.
    expect(growthMb).toBeLessThan(150);
  });

  it('leaves no child process behind, even after kills', async () => {
    await new PdfTextExtractor({ timeoutMs: 50 }).extract(fixture('comprovante-texto.pdf')).catch(() => null);
    await new PdfTextExtractor().extract(await flateBombPdf(1)).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(leftoverChildren()).toEqual([]);
  });

  it('refuses a third simultaneous extraction fast instead of queueing it', async () => {
    const extractor = new PdfTextExtractor();
    const pdf = fixture('comprovante-texto.pdf');
    const first = extractor.extract(pdf);
    const second = extractor.extract(pdf);
    await expect(extractor.extract(pdf)).rejects.toThrow(/busy/);
    expect((await first).amount?.cents).toBe(12345);
    expect((await second).amount?.cents).toBe(12345);
    // The slots are free again afterwards.
    expect((await extractor.extract(pdf)).amount?.cents).toBe(12345);
  });

  it('keeps paths and stack traces out of the errors it returns', async () => {
    const error = await new PdfTextExtractor({ timeoutMs: 1 })
      .extract(fixture('comprovante-texto.pdf'))
      .then(() => null, (e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('PDF extraction timed out');
    expect(error?.stack ?? '').not.toContain('node_modules');
  });
});
