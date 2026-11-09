import { ValidationError } from '../../../domain/errors';
import { LoanStatus } from '../../../domain/loan-balance';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';
import { toInt } from '../paging';
import { LoanDetails } from './get-loan';
import { loadLoanDetails, toLoanFilter } from './load-loan-details';

export const DEFAULT_LOAN_PAGE = 100;
export const MAX_LOAN_PAGE = 200;
export const MAX_LOAN_OFFSET = 100_000;

/** The same words the response uses for `status`, so a client filters by what it reads. */
export type LoanStatusFilter = LoanStatus;
const STATUSES: readonly LoanStatusFilter[] = ['OPEN', 'PAID', 'OVERDUE'];

export interface ListLoansInput {
  /** Case insensitive, ignoring spaces at the ends. */
  borrower?: string;
  status?: LoanStatusFilter;
  limit?: number;
  offset?: number;
}

export interface LoanPageResult {
  items: LoanDetails[];
  /** Count of ALL matches of the filters, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
}

/**
 * Lists the actor's own loans (admins see no one else's) by due date, soonest first.
 *
 * The status depends on payments and on today's date, and the rule lives in the domain, not in
 * SQL. So the repository returns every loan that matches the borrower and the balances are
 * computed here before filtering and paging. The paid amounts come from ONE aggregated query for
 * all the loans (no query per loan). Known debt: the filter and the paging run in memory over
 * every loan of the user; see docs/status.md.
 */
export class ListLoans {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: ListLoansInput): Promise<LoanPageResult> {
    const filter = toLoanFilter(input.borrower);
    let status: LoanStatus | undefined;
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status)) {
        throw new ValidationError('status must be OPEN, PAID or OVERDUE');
      }
      status = input.status;
    }
    const limit = toInt(input.limit, 'limit', 1, MAX_LOAN_PAGE, DEFAULT_LOAN_PAGE);
    const offset = toInt(input.offset, 'offset', 0, MAX_LOAN_OFFSET, 0);

    const now = this.clock.now();
    const all = (await loadLoanDetails(this.loans, this.payments, actor, filter, now)).filter(
      (details) => status === undefined || details.balance.status === status,
    );
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
    };
  }
}
