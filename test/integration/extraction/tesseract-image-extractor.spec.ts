import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { TesseractImageExtractor } from '../../../src/infrastructure/extraction/tesseract-image-extractor';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

describe('TesseractImageExtractor (OCR, real fixtures)', () => {
  jest.setTimeout(120_000);
  const extractor = new TesseractImageExtractor();

  it('reads the labelled amount of a PNG', async () => {
    const result = await extractor.extract(fixture('comprovante.png'), 'image/png');
    expect(result.amount?.cents).toBe(12345);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('reads the labelled amount of a JPEG', async () => {
    const canvas = createCanvas(600, 160);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 160);
    ctx.fillStyle = '#000000';
    ctx.font = '40px sans-serif';
    ctx.fillText('Valor R$ 123,45', 30, 95);
    const result = await extractor.extract(canvas.toBuffer('image/jpeg'), 'image/jpeg');
    expect(result.amount?.cents).toBe(12345);
  });

  it('returns null for an image with no text', async () => {
    const canvas = createCanvas(300, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 100);
    const result = await extractor.extract(canvas.toBuffer('image/png'), 'image/png');
    expect(result.amount).toBeNull();
  });

  it('returns null for bytes that are not an image', async () => {
    expect((await extractor.extract(fixture('lixo.pdf'), 'image/png')).amount).toBeNull();
    expect((await extractor.extract(fixture('comprovante-texto.pdf'), 'image/png')).amount).toBeNull();
  });

  it('refuses images above the pixel ceiling without decoding them', async () => {
    const bomb = Buffer.from(fixture('comprovante.png'));
    bomb.writeUInt32BE(20000, 16); // IHDR width
    bomb.writeUInt32BE(20000, 20); // IHDR height
    const result = await extractor.extract(bomb, 'image/png');
    expect(result.amount).toBeNull();
  });

  it('gives up with an error when OCR exceeds the timeout', async () => {
    const slow = new TesseractImageExtractor({ timeoutMs: 1 });
    await expect(slow.extract(fixture('comprovante.png'), 'image/png')).rejects.toThrow(/timed out/);
  });

  it('rejects instead of queueing when too many OCR jobs run at once', async () => {
    const single = new TesseractImageExtractor({ maxConcurrent: 1 });
    const first = single.extract(fixture('comprovante.png'), 'image/png');
    await expect(single.extract(fixture('comprovante.png'), 'image/png')).rejects.toThrow(/busy/);
    expect((await first).amount?.cents).toBe(12345);
  });
});
