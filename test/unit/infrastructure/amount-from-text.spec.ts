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
      ['Valor: R$ 1.234,56', 123456],
      ['Valor: R$ 1234,56', 123456],
      ['Valor pago: 1.000.000,00', 100000000],
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
      ['a weak label without R$', 'Valor: 123,45'],
      ['a weak label without R$, total', 'Total 50,00'],
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

  describe('suffixes that change the meaning of the number', () => {
    it.each([
      'Total 10,00%',
      'Valor R$ 10,00%',
      'Valor 100,00 USD',
      'Valor R$ 100,00 EUR',
      'Valor R$ 10,00 US$',
      'Valor R$ 10,00 \u20ac',
      'Valor 10,30h',
      'Valor R$ 100,00 D',
      'Valor R$ 100,00 C',
      'Valor R$ 3,00 itens',
      'Valor R$ 2,50 kg',
      'Valor R$ 3,00 un',
      'Valor R$ 12,00\u0663',
    ])('rejects %j', (text) => {
      expect(cents(text)).toBeNull();
    });

    it('never reads a quantity as the amount', () => {
      expect([3000, null]).toContain(cents('Total 12,00 kg Valor R$ 30,00'));
      expect([3000, null]).toContain(cents('Total 3,00 itens Valor R$ 30,00'));
    });

    it('does not mistake a line break or the next label for a suffix', () => {
      expect(cents('Valor R$ 50,00\nBanco X')).toBe(5000);
      expect(cents('Valor R$ 50,00 Valor R$ 50,00')).toBe(5000);
      expect(cents('Valor R$ 50,00 de hoje')).toBe(5000);
    });
  });

  describe('a payment that did not happen', () => {
    it.each([
      'Valor R$ 100,00 (estornado)',
      'Pagamento estornado. Valor R$ 100,00',
      'Pagamento agendado para 10/12 Valor R$ 100,00',
      'Pagamento n\u00e3o realizado\nValor R$ 100,00',
      'PAGAMENTO NAO REALIZADO Valor R$ 100,00',
      'Pagamento cancelado Valor R$ 100,00',
      'Pagamento negado Valor R$ 100,00',
      'Pagamento recusado Valor R$ 100,00',
      'Pagamento falhou Valor R$ 100,00',
      'Pagamento pendente Valor R$ 100,00',
    ])('gives null for %j', (text) => {
      expect(cents(text)).toBeNull();
    });
  });

  describe('a payment that is not settled', () => {
    it.each([
      'Pix devolvido\nValor R$ 100,00',
      'Comprovante de devolu\u00e7\u00e3o\nValor R$ 100,00',
      'Reembolso\nValor R$ 100,00',
      'Pagamento expirado\nValor R$ 100,00',
      'Transfer\u00eancia n\u00e3o efetivada\nValor R$ 100,00',
      'Pagamento n\u00e3o conclu\u00eddo\nValor R$ 100,00',
      'Pagamento em processamento\nValor R$ 100,00',
      'Aguardando pagamento\nValor R$ 100,00',
      'Pagamento em an\u00e1lise\nValor R$ 100,00',
      'Boleto gerado\nValor R$ 100,00',
      'QR Code gerado\nValor R$ 100,00',
      'Or\u00e7amento\nValor R$ 100,00',
      'Proposta\nValor R$ 100,00',
      'Valor R$ 100,00 (previsto)',
    ])('gives null for %j', (text) => {
      expect(cents(text)).toBeNull();
    });

    it.each([
      'Pagamento efetivado\nValor R$ 100,00',
      'Pix enviado com sucesso\nValor R$ 100,00',
      'Transfer\u00eancia conclu\u00edda\nValor R$ 100,00',
      'Pagamento realizado\nValor R$ 100,00',
    ])('still suggests the amount for the real receipt %j', (text) => {
      expect(cents(text)).toBe(10000);
    });
  });

  describe('card statements', () => {
    it.each([
      'Fatura\nTotal R$ 900,00\nPagamento minimo',
      'Fatura\nTotal R$ 900,00\nPagamento m\u00ednimo R$ 135,00',
    ])('gives null for %j', (text) => {
      expect(cents(text)).toBeNull();
    });
  });

  describe('section labels around the label', () => {
    it.each([
      'Tarifa\nValor R$ 3,50',
      'Juros\nValor R$ 2,00',
      'Desconto\nValor R$ 2,00',
      'Saldo: Total R$ 500,00',
      'Saldo\nTotal R$ 500,00',
      'Sub-total R$ 5,00',
      'Pre-total R$ 5,00',
      'Total de parcelas 12 Valor R$ 50,00',
      'Taxa\n\nValor R$ 3,50',
    ])('gives null for %j', (text) => {
      expect(cents(text)).toBeNull();
    });

    it('does not let a neighbouring line that has its own amount veto the label', () => {
      expect(cents('Tarifa: R$ 3,50\nValor R$ 100,00')).toBe(10000);
    });
  });

  describe('discounts', () => {
    it('does not trust a generic Valor when a discount is listed', () => {
      expect(cents('Valor R$ 100,00\nDesconto R$ 5,00')).toBeNull();
    });

    it('trusts the amount that is explicitly the paid one', () => {
      expect(cents('Valor original R$ 100,00\nValor pago R$ 95,00')).toBe(9500);
      expect(cents('Valor R$ 100,00\nDesconto R$ 5,00\nValor pago R$ 95,00')).toBe(9500);
    });

    it('keeps ignoring the discount itself', () => {
      expect(cents('Valor do desconto R$ 5,00')).toBeNull();
    });
  });

  describe('weak labels (bare Valor / Total) need the R$', () => {
    it('answers only with R$ next to the amount', () => {
      expect(cents('Valor R$ 50,00')).toBe(5000);
      expect(cents('Total R$ 50,00')).toBe(5000);
      expect(cents('Valor 50,00')).toBeNull();
      expect(cents('Total 50,00')).toBeNull();
    });

    it('keeps strong labels working without R$', () => {
      expect(cents('Valor pago 50,00')).toBe(5000);
      expect(cents('Valor total 50,00')).toBe(5000);
      expect(cents('Total pago 50,00')).toBe(5000);
      expect(cents('Valor do pagamento 50,00')).toBe(5000);
      expect(cents('Valor da transfer\u00eancia 50,00')).toBe(5000);
    });

    it('trusts weak labels less than strong ones', () => {
      const weak = amountFromText('Valor R$ 50,00', 'native').confidence;
      const strong = amountFromText('Valor pago R$ 50,00', 'native').confidence;
      expect(strong).toBeGreaterThan(weak);
      expect(weak).toBeGreaterThan(0);
      const weakOcr = amountFromText('Valor R$ 50,00', 'ocr').confidence;
      expect(weak).toBeGreaterThan(weakOcr);
    });
  });

  describe('ceiling of R$ 1.000.000,00', () => {
    it.each([
      'Valor R$ 9.000.000.000.000,00',
      'Valor R$ 1.000.000.000,00',
      'Valor R$ 1.000.000,01',
      'Valor pago 1.234.567,89',
    ])('gives null above the ceiling: %j', (text) => {
      expect(cents(text)).toBeNull();
    });

    it('accepts exactly the ceiling', () => {
      expect(cents('Valor R$ 1.000.000,00')).toBe(100_000_000);
    });
  });

  describe('linear time on adversarial text', () => {
    const N = 200_000;
    const hostile: Record<string, string> = {
      spaces: ' '.repeat(N),
      tabs: '\t'.repeat(N),
      'a + spaces': 'a' + ' '.repeat(N),
      'valor repeated': 'Valor '.repeat(N / 6),
      'valor + spaces': ('Valor' + ' '.repeat(50)).repeat(N / 55),
      'valor + newlines': 'Valor\n'.repeat(N / 6),
      'valor, blank lines, digits': ('Valor\n\n' + '1'.repeat(40)).repeat(N / 47),
      digits: '1'.repeat(N),
      'valor digits': 'Valor ' + '1'.repeat(N),
      'valor thousands': 'Valor ' + '1.111'.repeat(N / 5),
      'valor thousands comma': 'Valor ' + '1.111'.repeat(N / 5) + ',',
      'spaces then valor': (' '.repeat(100) + 'valor ').repeat(N / 106),
      combining: 'Valor' + '\u0301'.repeat(N),
      'newline spaces': '\n '.repeat(N / 2),
      'valor R$ spaces': 'Valor R$' + ' '.repeat(N),
      'valor colons': 'Valor ' + ':'.repeat(N),
      'many candidates': 'Valor R$ 1,00 '.repeat(N / 15),
      'many candidates with context': 'Saldo\nValor R$ 1,00\n'.repeat(N / 21),
      'one huge line with context': ('Tarifa Total R$ 1,00 ').repeat(N / 21),
      'many suffixes': 'Valor R$ 1,00 kg '.repeat(N / 17),
    };

    it.each(Object.entries(hostile))('%s stays fast', (_name, text) => {
      const started = Date.now();
      amountFromText(text, 'native');
      expect(Date.now() - started).toBeLessThan(500);
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
