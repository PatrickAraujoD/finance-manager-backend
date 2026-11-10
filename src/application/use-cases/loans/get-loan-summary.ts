import { LoanSummary, summarizeLoansByBorrower } from '../../../domain/loan-summary';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';
import { loadLoanDetails, toLoanFilter } from './load-loan-details';

export interface GetLoanSummaryInput {
  /** Case insensitive, ignoring spaces at the ends; the same match as the loan list. */
  borrower?: string;
}

/**
 * How much each person of the actor's own loans owes, what is upcoming or overdue and what was
 * paid (admins see no one else's). It only orchestrates: the loans and their balances are loaded
 * like in `ListLoans` (ONE aggregated query for the payments) and the grouping is the pure
 * `summarizeLoansByBorrower`. Known debt, shared with the list: it works in memory over every
 * loan of the user; see docs/status.md.
 */
export class GetLoanSummary {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: GetLoanSummaryInput): Promise<LoanSummary> {
    const filter = toLoanFilter(input.borrower);
    const details = await loadLoanDetails(
      this.loans,
      this.payments,
      actor,
      filter,
      this.clock.now(),
    );
    return summarizeLoansByBorrower(details);
  }
}
