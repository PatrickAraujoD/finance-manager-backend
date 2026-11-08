import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfTextExtractor } from '../../../src/infrastructure/extraction/pdf-text-extractor';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

describe('PdfTextExtractor (pdf-parse, real fixtures)', () => {
  const extractor = new PdfTextExtractor();

  it('reads the labelled amount of a text PDF', async () => {
    const result = await extractor.extract(fixture('comprovante-texto.pdf'));
    expect(result.amount?.cents).toBe(12345);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('returns null when several amounts have no clear label', async () => {
    const result = await extractor.extract(fixture('comprovante-varios-valores.pdf'));
    expect(result).toEqual({ amount: null, confidence: 0 });
  });

  it('returns null for a PDF without a text layer', async () => {
    expect((await extractor.extract(fixture('sem-texto.pdf'))).amount).toBeNull();
  });

  it('returns null for garbage with a PDF header', async () => {
    expect((await extractor.extract(fixture('lixo.pdf'))).amount).toBeNull();
  });

  it('returns null for a PNG renamed to PDF', async () => {
    expect((await extractor.extract(fixture('falso.pdf'))).amount).toBeNull();
  });

  it('refuses to parse a buffer above 5 MB', async () => {
    const big = Buffer.concat([fixture('comprovante-texto.pdf'), Buffer.alloc(5 * 1024 * 1024)]);
    expect((await extractor.extract(big)).amount).toBeNull();
  });

  it('only reads the first pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 10; i++) {
      const page = doc.addPage([400, 300]);
      if (i === 8) page.drawText('Valor: R$ 77,00', { x: 30, y: 200, size: 14, font });
    }
    const pdf = Buffer.from(await doc.save());
    expect((await new PdfTextExtractor({ maxPages: 3 }).extract(pdf)).amount).toBeNull();
    expect((await new PdfTextExtractor({ maxPages: 9 }).extract(pdf)).amount?.cents).toBe(7700);
  });

  it('gives up with an error when extraction exceeds the timeout', async () => {
    const slow = new PdfTextExtractor({ timeoutMs: 1 });
    await expect(slow.extract(fixture('comprovante-texto.pdf'))).rejects.toThrow(/timed out/);
  });
});
