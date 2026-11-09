import { Loan } from './entities/loan';
import { ValidationError } from './errors';
import { Money } from './money';

export type LoanStatus = 'OPEN' | 'PAID' | 'OVERDUE';

export interface LoanBalance {
  paid: Money;
  remaining: Money;
  status: LoanStatus;
}

/**
 * Pure calculation of what is left on a loan. `paid` is the sum of its payments (zero while there
 * are none) and `now` any instant of "today": only its UTC day counts, matching the calendar
 * dates stored in the loan. A loan due today is still OPEN; it is OVERDUE from the next day on,
 * and only while there is a balance (a settled loan is PAID no matter how old).
 */
export function computeLoanBalance(loan: Loan, paid: Money, now: Date): LoanBalance {
  if (paid.isNegative()) throw new ValidationError('Paid amount cannot be negative');
  const remaining = loan.amount.subtract(paid);
  if (remaining.isNegative()) throw new ValidationError('Paid amount exceeds the loan amount');
  if (remaining.cents === 0) return { paid, remaining, status: 'PAID' };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { paid, remaining, status: loan.dueDate.getTime() < today ? 'OVERDUE' : 'OPEN' };
}
