import { ValidationError } from '../../../src/domain/errors';
import { parseLoanPaymentMethod } from '../../../src/domain/loan-payment-method';

describe('parseLoanPaymentMethod', () => {
  it.each(['CASH', 'PIX'])('accepts %s', (v) => {
    expect(parseLoanPaymentMethod(v)).toBe(v);
  });

  it.each(['', 'cash', 'Pix', 'CREDIT', 'DEBIT', ' PIX'])('rejects %p', (v) => {
    expect(() => parseLoanPaymentMethod(v)).toThrow(ValidationError);
  });

  it.each([undefined, null, 1, true, {}])('rejects the non text value %p', (v) => {
    expect(() => parseLoanPaymentMethod(v as never)).toThrow(ValidationError);
  });
});
