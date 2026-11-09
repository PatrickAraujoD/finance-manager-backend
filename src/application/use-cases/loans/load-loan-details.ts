import { ValidationError } from '../../../domain/errors';
import { Money } from '../../../domain/money';
import { requireCleanText } from '../../../domain/validation';
import { Actor } from '../../actor';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanFilter, LoanRepository } from '../../ports/loan-repository';
import { LoanDetails, withBalance } from './get-loan';

/** Validates the optional `borrower` text shared by the list and the summary. */
export function toLoanFilter(borrower: string | undefined): LoanFilter {
  if (borrower === undefined) return {};
  if (typeof borrower !== 'string' || borrower.trim() === '') {
    throw new ValidationError('borrower must be a non blank text');
  }
  requireCleanText(borrower, 'borrower', { kind: 'name' });
  return { borrower: borrower.trim() };
}

/**
 * Every loan of the actor matching `filter`, each with its balance. The paid amounts come from
 * ONE aggregated query for all the loans (no query per loan).
 */
export async function loadLoanDetails(
  loans: LoanRepository,
  payments: LoanPaymentRepository,
  actor: Actor,
  filter: LoanFilter,
  now: Date,
): Promise<LoanDetails[]> {
  const found = await loans.listByUser(actor.id, filter);
  const paid = await payments.sumPaidByLoans(
    actor.id,
    found.map((loan) => loan.id),
  );
  return found.map((loan) => withBalance(loan, Money.fromCents(paid.get(loan.id) ?? 0), now));
}
