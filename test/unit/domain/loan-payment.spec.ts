import { MAX_EXPENSE_CENTS } from '../../../src/domain/entities/expense';
import { LoanPayment } from '../../../src/domain/entities/loan-payment';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';

const cash = {
  id: 'p1',
  loanId: 'l1',
  userId: 'u1',
  amount: Money.fromCents(2500),
  method: 'CASH' as const,
  receiptId: null,
  paidAt: new Date('2026-11-08T00:00:00Z'),
};
const pix = { ...cash, method: 'PIX' as const, receiptId: 'r1' };

describe('LoanPayment', () => {
  it('creates a cash payment and exposes every field', () => {
    const p = LoanPayment.create({ ...cash, createdAt: new Date('2026-11-09T10:00:00Z') });
    expect(p.id).toBe('p1');
    expect(p.loanId).toBe('l1');
    expect(p.userId).toBe('u1');
    expect(p.amount.cents).toBe(2500);
    expect(p.method).toBe('CASH');
    expect(p.receiptId).toBeNull();
    expect(p.paidAt.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(p.createdAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('creates a pix payment with its receipt', () => {
    expect(LoanPayment.create(pix).receiptId).toBe('r1');
  });

  it('has no createdAt until persisted', () => {
    expect(LoanPayment.create(cash).createdAt).toBeNull();
  });

  it('requires a receipt for pix', () => {
    expect(() => LoanPayment.create({ ...pix, receiptId: null })).toThrow(ValidationError);
    expect(() => LoanPayment.create({ ...pix, receiptId: '  ' })).toThrow(ValidationError);
  });

  it('does not accept a receipt for cash', () => {
    expect(() => LoanPayment.create({ ...cash, receiptId: 'r1' })).toThrow(ValidationError);
  });

  it('rejects an unknown method', () => {
    expect(() => LoanPayment.create({ ...cash, method: 'CREDIT' as never })).toThrow(ValidationError);
  });

  it.each([0, -1])('rejects the amount %d', (cents) => {
    expect(() => LoanPayment.create({ ...cash, amount: Money.fromCents(cents) })).toThrow(ValidationError);
  });

  it('accepts the ceiling and rejects one cent above it', () => {
    expect(LoanPayment.create({ ...cash, amount: Money.fromCents(MAX_EXPENSE_CENTS) }).amount.cents).toBe(
      MAX_EXPENSE_CENTS,
    );
    expect(() =>
      LoanPayment.create({ ...cash, amount: Money.fromCents(MAX_EXPENSE_CENTS + 1) }),
    ).toThrow(ValidationError);
  });

  it('rejects blank ids and an invalid date', () => {
    for (const over of [{ id: ' ' }, { loanId: '' }, { userId: ' ' }, { paidAt: new Date('x') }]) {
      expect(() => LoanPayment.create({ ...cash, ...over })).toThrow(ValidationError);
    }
  });

  it('normalizes paidAt to 00:00 UTC and returns copies of the dates', () => {
    const p = LoanPayment.create({ ...cash, paidAt: new Date('2026-11-08T18:30:00Z') });
    expect(p.paidAt.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    p.paidAt.setUTCFullYear(1999);
    expect(p.paidAt.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });
});
