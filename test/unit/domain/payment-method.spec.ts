import { ValidationError } from '../../../src/domain/errors';
import { parsePaymentMethod } from '../../../src/domain/payment-method';

describe('parsePaymentMethod', () => {
  it.each(['CREDIT', 'DEBIT', 'PIX'])('accepts %s', (v) => {
    expect(parsePaymentMethod(v)).toBe(v);
  });

  it.each(['', 'credit', 'Pix', 'CASH', 'cartao', ' PIX'])('rejects %p', (v) => {
    expect(() => parsePaymentMethod(v)).toThrow(ValidationError);
  });

  it.each([undefined, null, 1, true, {}])('rejects the non text value %p', (v) => {
    expect(() => parsePaymentMethod(v as never)).toThrow(ValidationError);
  });
});
