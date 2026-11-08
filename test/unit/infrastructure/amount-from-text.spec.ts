import { amountFromText } from '../../../src/infrastructure/extraction/amount-from-text';

const cents = (text: string, source: 'native' | 'ocr' = 'native') =>
  amountFromText(text, source).amount?.cents ?? null;

describe('amountFromText', () => {
  describe('clear labelled amounts', () => {
    it.each([
      ['Valor: R$ 123,45', 12345],
      ['Valor R$ 123,45', 12345],
      ['valor r$ 123,45', 12345],
      ['VALOR: R$123,45', 12345],
      ['Valor: 123,45', 12345],
      ['Valor: R$ 1.234,56', 123456],
      ['Valor: R$ 1234,56', 123456],
      ['Valor: 1.234.567,89', 123456789],
      ['Valor pago: R$ 50,00', 5000],
      ['Valor total: R$ 50,00', 5000],
      ['Total: R$ 50,00', 5000],
      ['Total pago R$ 50,00', 5000],
      ['Valor do pagamento: R$ 50,00', 5000],
      ['Valor da transferência: R$ 50,00', 5000],
      ['Valor da transferencia: R$ 50,00', 5000],
      ['Comprovante de pagamento\nValor: R$ 123,45\nBanco X', 12345],
      ['10/11/2026 Valor R$ 9,90', 990],
      ['Valor: R$ 0,05', 5],
    ])('%j -> %j', (text, expected) => {
      expect(cents(text)).toBe(expected);
    });

    it('tolerates spaces, tabs and line breaks between the label and the amount', () => {
      expect(cents('Valor   :   R$   123,45')).toBe(12345);
      expect(cents('Valor\tR$ 123,45')).toBe(12345);
      expect(cents('Valor\nR$ 123,45')).toBe(12345);
      expect(cents('Valor:\r\n\r\nR$ 123,45')).toBe(12345);
    });

    it('accepts the same amount repeated under different labels', () => {
      expect(cents('Valor: R$ 50,00\nTotal: R$ 50,00')).toBe(5000);
    });
  });

  describe('dangerous inputs return null instead of guessing', () => {
    it.each([
      ['empty text', ''],
      ['blank text', '   \n\t '],
      ['no label at all', 'R$ 123,45'],
      ['only a balance', 'Saldo R$ 1.000,00'],
      ['balance and fee, no clear label', 'Saldo R$ 1.000,00\nTarifa R$ 2,50'],
      ['label for a fee', 'Valor da tarifa R$ 2,50'],
      ['a balance whose name ends in total', 'Saldo total R$ 1.000,00'],
      ['two different labelled amounts', 'Valor R$ 50,00\nValor R$ 60,00'],
      ['conflicting labels', 'Valor: R$ 50,00\nTotal: R$ 60,00'],
      ['decimal point instead of comma', 'Valor: 1234.56'],
      ['American format', 'Valor: R$ 1,234.56'],
      ['three decimal places', 'Valor: R$ 10,999'],
      ['no decimals', 'Valor: R$ 10'],
      ['one decimal place', 'Valor: R$ 10,5'],
      ['misplaced thousands separator', 'Valor: R$ 12.34,56'],
      ['trailing extra group', 'Valor: R$ 10,99,88'],
      ['negative amount', 'Valor: -R$ 10,00'],
      ['zero amount', 'Valor: R$ 0,00'],
      ['zero conflicting with a real amount', 'Valor: R$ 0,00\nTotal: R$ 50,00'],
      ['label without an amount', 'Valor: indisponível'],
      ['label followed by a date', 'Valor 10/11/2026 R$ 50,00'],
      ['amount separated from its label by words', 'Valor da operação foi R$ 50,00'],
      ['label glued to a previous word', 'Pagamento Valor R$ 50,00'],
      ['amount too large to be safe', 'Valor: 99.999.999.999.999.999,99'],
    ])('%s', (_name, text) => {
      expect(cents(text)).toBeNull();
    });

    it('picks the labelled amount and ignores loose ones', () => {
      expect(cents('Saldo R$ 1.000,00\nValor R$ 50,00\nTarifa R$ 2,50')).toBe(5000);
    });

    it('does not invent digits from OCR noise', () => {
      expect(cents('Valor R$ 12S,45', 'ocr')).toBeNull();
      expect(cents('Valor R$ 1 23,45', 'ocr')).toBeNull();
      expect(cents('Valor R$ ,45', 'ocr')).toBeNull();
      expect(cents('!!! ### @@@ \u0000 �', 'ocr')).toBeNull();
    });

    it('survives a huge hostile text', () => {
      const hostile = 'Valor '.repeat(100_000) + '1'.repeat(500_000);
      expect(cents(hostile)).toBeNull();
    });
  });

  describe('confidence', () => {
    it('is high for native PDF text and medium for OCR', () => {
      const native = amountFromText('Valor: R$ 1,00', 'native').confidence;
      const ocr = amountFromText('Valor: R$ 1,00', 'ocr').confidence;
      expect(native).toBeGreaterThan(ocr);
      expect(ocr).toBeGreaterThan(0);
    });

    it('is 0 when there is no amount', () => {
      expect(amountFromText('Saldo R$ 1,00', 'native')).toEqual({ amount: null, confidence: 0 });
    });
  });
});
