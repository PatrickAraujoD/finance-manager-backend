import { Expense } from '../../domain/entities/expense';
import { PaymentMethod } from '../../domain/payment-method';

/**
 * `spentAt` is a CALENDAR DATE stored as a `Date` at 00:00 UTC (CTO decision: avoids shifting
 * purchases across time zones). Day/month grouping and range bounds are interpreted in UTC.
 * `from` and `to` are inclusive bounds on `spentAt`.
 */
export interface ExpenseFilter {
  from?: Date;
  to?: Date;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
}

export interface ExpensePage {
  limit: number;
  offset: number;
}

export interface ExpenseRepository {
  /**
   * Inserts a new expense. Throws `ConflictError` when the id exists or when the receipt is
   * already used by another expense (one receipt backs at most one expense), and `NotFoundError`
   * when the category or receipt does not exist (foreign key).
   */
  save(expense: Expense): Promise<void>;
  /**
   * Updates category, amount, paidAlone, paymentMethod, spentAt and description of the expense
   * with this id AND this owner. `userId` and `receiptId` are never changed. Returns false when
   * there is no such row. Throws `NotFoundError` when the new category does not exist.
   */
  update(expense: Expense): Promise<boolean>;
  /** Only returns the expense when it belongs to `userId`. */
  findById(userId: string, id: string): Promise<Expense | null>;
  /**
   * Ordered by `spentAt` descending, ties broken by `id` descending. Without `page` returns every
   * match (internal callers such as reports); the HTTP layer always pages.
   */
  listByUser(userId: string, filter: ExpenseFilter, page?: ExpensePage): Promise<Expense[]>;
  /** Number of expenses of `userId` matching `filter` (ignores paging). */
  countByUser(userId: string, filter: ExpenseFilter): Promise<number>;
  /**
   * Deletes the expense only when it belongs to `userId`; false when nothing was deleted. Throws
   * `ConflictError` while a loan created from the expense exists.
   */
  delete(userId: string, id: string): Promise<boolean>;
}
