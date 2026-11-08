import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Money } from '../../../src/domain/money';
import { CompositeReceiptExtractor } from '../../../src/infrastructure/extraction/composite-receipt-extractor';
import { PdfTextExtractor } from '../../../src/infrastructure/extraction/pdf-text-extractor';
import { TesseractImageExtractor } from '../../../src/infrastructure/extraction/tesseract-image-extractor';
import { FakeReceiptExtractor } from '../../support/fakes/fake-receipt-extractor';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'fixtures', name));

describe('CompositeReceiptExtractor', () => {
  jest.setTimeout(120_000);

  describe('routing', () => {
    const pdf = new FakeReceiptExtractor({ amount: Money.fromCents(1), confidence: 0.9 });
    const image = new FakeReceiptExtractor({ amount: Money.fromCents(2), confidence: 0.6 });
    const composite = new CompositeReceiptExtractor(pdf, image);
    const buffer = Buffer.from('x');

    it('sends PDFs to the pdf extractor', async () => {
      expect((await composite.extract(buffer, 'application/pdf')).amount?.cents).toBe(1);
    });

    it.each(['image/png', 'image/jpeg'])('sends %s to the image extractor', async (mime) => {
      expect((await composite.extract(buffer, mime)).amount?.cents).toBe(2);
    });

    it.each(['text/plain', 'image/gif', 'application/pdf; x=1', ''])(
      'returns null for the unsupported type %j without calling anyone',
      async (mime) => {
        const before = pdf.calls.length + image.calls.length;
        expect(await composite.extract(buffer, mime)).toEqual({ amount: null, confidence: 0 });
        expect(pdf.calls.length + image.calls.length).toBe(before);
      },
    );
  });

  describe('with the real extractors', () => {
    const composite = new CompositeReceiptExtractor(new PdfTextExtractor(), new TesseractImageExtractor());

    it('reads a text PDF', async () => {
      const result = await composite.extract(fixture('comprovante-texto.pdf'), 'application/pdf');
      expect(result.amount?.cents).toBe(12345);
    });

    it('reads a PNG', async () => {
      const result = await composite.extract(fixture('comprovante.png'), 'image/png');
      expect(result.amount?.cents).toBe(12345);
    });

    it('gives null for the garbage PDF', async () => {
      expect((await composite.extract(fixture('lixo.pdf'), 'application/pdf')).amount).toBeNull();
    });
  });
});
