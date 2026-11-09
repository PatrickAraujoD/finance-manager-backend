import { Loan } from '../../domain/entities/loan';

export interface LoanFilter {
  /**
   * Exact name match ignoring letter case; the caller passes it already trimmed (stored names
   * are always trimmed). Case folding is the database's `lower()` in Postgres.
   */
  borrower?: string;
}

export interface LoanRepository {
  /**
   * Inserts a new loan. Throws `ConflictError` when the id exists or when the expense already
   * has a loan (one expense backs at most one loan), and `NotFoundError` when the user or the
   * expense does not exist (foreign key).
   */
  save(loan: Loan): Promise<void>;
  /**
   * Updates only `borrowerName` and `dueDate` of the loan with this id AND this owner; the
   * amount, `expenseId` and `userId` never change. Returns false when there is no such row.
   */
  update(loan: Loan): Promise<boolean>;
  /** Only returns the loan when it belongs to `userId`. */
  findById(userId: string, id: string): Promise<Loan | null>;
  /**
   * Every loan of `userId` matching `filter`, ordered by `dueDate` ascending, ties broken by
   * `id` ascending. Not paged: the status (open, paid, overdue) depends on payments and on
   * today's date, so the use case filters and pages after computing the balances.
   */
  listByUser(userId: string, filter: LoanFilter): Promise<Loan[]>;
  /** Deletes the loan only when it belongs to `userId`; false when nothing was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
}
