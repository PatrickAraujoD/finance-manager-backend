import { Loan } from '../../../src/domain/entities/loan';
import { ValidationError } from '../../../src/domain/errors';
import { computeLoanBalance } from '../../../src/domain/loan-balance';
import { Money } from '../../../src/domain/money';

const loan = (dueDate: string, cents = 10_000) =>
  Loan.create({
    id: 'l1',
    userId: 'u1',
    borrowerName: 'Carlos',
    amount: Money.fromCents(cents),
    dueDate: new Date(`${dueDate}T00:00:00Z`),
    expenseId: null,
  });

// "Today" is a UTC day; the time of day inside it must not matter.
const TODAY = new Date('2026-11-09T00:00:00Z');
const cents = (n: number) => Money.fromCents(n);

describe('computeLoanBalance', () => {
  it('is OPEN with nothing paid and a due date in the future', () => {
    const b = computeLoanBalance(loan('2026-12-01'), cents(0), TODAY);
    expect(b.paid.cents).toBe(0);
    expect(b.remaining.cents).toBe(10_000);
    expect(b.status).toBe('OPEN');
  });

  it('is OPEN on the due date itself', () => {
    expect(computeLoanBalance(loan('2026-11-09'), cents(0), TODAY).status).toBe('OPEN');
  });

  it('is OVERDUE the day after the due date when there is a balance', () => {
    expect(computeLoanBalance(loan('2026-11-08'), cents(0), TODAY).status).toBe('OVERDUE');
  });

  it('stays OVERDUE with a partial payment, and the remaining is the difference', () => {
    const b = computeLoanBalance(loan('2026-11-08'), cents(2_500), TODAY);
    expect(b.status).toBe('OVERDUE');
    expect(b.paid.cents).toBe(2_500);
    expect(b.remaining.cents).toBe(7_500);
  });

  it('is OPEN with a partial payment before the due date', () => {
    const b = computeLoanBalance(loan('2026-11-20'), cents(1), TODAY);
    expect(b.status).toBe('OPEN');
    expect(b.remaining.cents).toBe(9_999);
  });

  it('is PAID when fully paid, even after the due date', () => {
    const b = computeLoanBalance(loan('2020-01-01'), cents(10_000), TODAY);
    expect(b.status).toBe('PAID');
    expect(b.remaining.cents).toBe(0);
  });

  it('is PAID when fully paid before the due date', () => {
    expect(computeLoanBalance(loan('2026-12-01'), cents(10_000), TODAY).status).toBe('PAID');
  });

  it('ignores the time of day of "today"', () => {
    const lateToday = new Date('2026-11-09T23:59:59.999Z');
    expect(computeLoanBalance(loan('2026-11-09'), cents(0), lateToday).status).toBe('OPEN');
    const earlyTomorrow = new Date('2026-11-10T00:00:00.000Z');
    expect(computeLoanBalance(loan('2026-11-09'), cents(0), earlyTomorrow).status).toBe('OVERDUE');
  });

  it('rejects a paid sum above the loan amount', () => {
    expect(() => computeLoanBalance(loan('2026-12-01'), cents(10_001), TODAY)).toThrow(
      ValidationError,
    );
  });

  it('rejects a negative paid sum', () => {
    expect(() => computeLoanBalance(loan('2026-12-01'), cents(-1), TODAY)).toThrow(ValidationError);
  });
});
