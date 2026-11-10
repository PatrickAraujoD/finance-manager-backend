import { Loan, MAX_BORROWER_NAME } from '../../../src/domain/entities/loan';
import { MAX_EXPENSE_CENTS } from '../../../src/domain/entities/expense';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';

const base = {
  id: 'l1',
  userId: 'u1',
  borrowerName: 'Carlos',
  amount: Money.fromCents(5000),
  dueDate: new Date('2026-12-10T00:00:00Z'),
  expenseId: null,
  paymentMethod: 'PIX' as const,
  lentAt: new Date('2026-11-08T00:00:00Z'),
};

describe('Loan', () => {
  it('creates a loan and exposes every field', () => {
    const loan = Loan.create({
      ...base,
      expenseId: 'e1',
      paymentMethod: null,
      lentAt: null,
      createdAt: new Date('2026-11-09T10:00:00Z'),
    });
    expect(loan.id).toBe('l1');
    expect(loan.userId).toBe('u1');
    expect(loan.borrowerName).toBe('Carlos');
    expect(loan.amount.cents).toBe(5000);
    expect(loan.dueDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(loan.expenseId).toBe('e1');
    expect(loan.createdAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('keeps the payment method and the lent date of money lent directly', () => {
    const loan = Loan.create({
      ...base,
      paymentMethod: 'CREDIT',
      lentAt: new Date('2026-11-08T18:30:00Z'),
    });
    expect(loan.paymentMethod).toBe('CREDIT');
    expect(loan.lentAt?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('has no createdAt until persisted', () => {
    expect(Loan.create(base).createdAt).toBeNull();
  });

  it('trims the borrower name', () => {
    expect(Loan.create({ ...base, borrowerName: '  Carlos  ' }).borrowerName).toBe('Carlos');
  });

  it('normalizes the due date to 00:00 UTC', () => {
    const loan = Loan.create({ ...base, dueDate: new Date('2026-12-10T18:30:00Z') });
    expect(loan.dueDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
  });

  it('returns copies of the dates, so callers cannot mutate the loan', () => {
    const loan = Loan.create({ ...base, createdAt: new Date('2026-11-09T10:00:00Z') });
    loan.dueDate.setUTCFullYear(1999);
    loan.createdAt?.setUTCFullYear(1999);
    expect(loan.dueDate.getUTCFullYear()).toBe(2026);
    expect(loan.createdAt?.getUTCFullYear()).toBe(2026);
  });

  it.each(['id', 'userId'] as const)('rejects a blank %s', (field) => {
    expect(() => Loan.create({ ...base, [field]: ' ' })).toThrow(ValidationError);
  });

  it('rejects a blank expenseId (null is the way to say "none")', () => {
    expect(() => Loan.create({ ...base, expenseId: ' ' })).toThrow(ValidationError);
  });

  it.each(['', '   ', 'Car\u0000los', 'Car‮los'])('rejects the borrower name %j', (name) => {
    expect(() => Loan.create({ ...base, borrowerName: name })).toThrow(ValidationError);
  });

  it('accepts a name of exactly the maximum length and rejects one more', () => {
    expect(() => Loan.create({ ...base, borrowerName: 'a'.repeat(MAX_BORROWER_NAME) })).not.toThrow();
    expect(() => Loan.create({ ...base, borrowerName: 'a'.repeat(MAX_BORROWER_NAME + 1) })).toThrow(
      ValidationError,
    );
  });

  it('keeps the name limit at 100 characters', () => {
    expect(MAX_BORROWER_NAME).toBe(100);
  });

  it.each([0, -1])('rejects the amount %d', (cents) => {
    expect(() => Loan.create({ ...base, amount: Money.fromCents(cents) })).toThrow(ValidationError);
  });

  it('accepts the ceiling and rejects one cent above it', () => {
    expect(() => Loan.create({ ...base, amount: Money.fromCents(MAX_EXPENSE_CENTS) })).not.toThrow();
    expect(() => Loan.create({ ...base, amount: Money.fromCents(MAX_EXPENSE_CENTS + 1) })).toThrow(
      ValidationError,
    );
  });

  it('rejects an invalid due date', () => {
    expect(() => Loan.create({ ...base, dueDate: new Date('nope') })).toThrow(ValidationError);
  });

  describe('payment method and lent date', () => {
    const lentAt = new Date('2026-11-08T00:00:00Z');
    const direct = { ...base, paymentMethod: 'PIX' as const, lentAt };

    it.each(['CREDIT', 'DEBIT', 'PIX', 'CASH'] as const)(
      'accepts money lent directly with %s',
      (paymentMethod) => {
        expect(Loan.create({ ...direct, paymentMethod }).paymentMethod).toBe(paymentMethod);
      },
    );

    it('requires both for money lent directly', () => {
      expect(() => Loan.create({ ...direct, paymentMethod: null })).toThrow(ValidationError);
      expect(() => Loan.create({ ...direct, lentAt: null })).toThrow(ValidationError);
      expect(() => Loan.create({ ...base, paymentMethod: null, lentAt: null })).toThrow(
        ValidationError,
      );
    });

    it('accepts a loan born from an expense with neither', () => {
      const loan = Loan.create({ ...base, expenseId: 'e1', paymentMethod: null, lentAt: null });
      expect(loan.paymentMethod).toBeNull();
      expect(loan.lentAt).toBeNull();
    });

    it('refuses either one on a loan born from an expense', () => {
      const fromExpense = { ...base, expenseId: 'e1' };
      expect(() => Loan.create({ ...fromExpense, paymentMethod: 'PIX', lentAt: null })).toThrow(
        ValidationError,
      );
      expect(() => Loan.create({ ...fromExpense, paymentMethod: null, lentAt })).toThrow(
        ValidationError,
      );
      expect(() => Loan.create({ ...fromExpense, paymentMethod: 'PIX', lentAt })).toThrow(
        ValidationError,
      );
    });

    it('refuses an unknown payment method', () => {
      expect(() => Loan.create({ ...direct, paymentMethod: 'BOLETO' as never })).toThrow(
        ValidationError,
      );
    });

    it('refuses an invalid lent date and one before 2000-01-01', () => {
      expect(() => Loan.create({ ...direct, lentAt: new Date('nope') })).toThrow(ValidationError);
      expect(() => Loan.create({ ...direct, lentAt: new Date('1999-12-31T00:00:00Z') })).toThrow(
        ValidationError,
      );
      expect(() => Loan.create({ ...direct, lentAt: new Date('2000-01-01T00:00:00Z') })).not.toThrow();
    });
  });
});
