import { Expense } from '../../domain/entities/expense';

/**
 * `spentAt` is a CALENDAR DATE stored as a `Date` at 00:00 UTC (CTO decision: avoids shifting
 * purchases across time zones). Day/month grouping and range bounds are interpreted in UTC.
 * `from` and `to` are inclusive bounds on `spentAt`.
 */
export interface ExpenseFilter {
  from?: Date;
  to?: Date;
  categoryId?: string;
}

export interface ExpenseRepository {
  /** Upsert: inserts or replaces the expense with the same id. */
  save(expense: Expense): Promise<void>;
  findById(id: string): Promise<Expense | null>;
  /** Ordered by `spentAt` descending, ties broken by `id` descending. */
  listByUser(userId: string, filter: ExpenseFilter): Promise<Expense[]>;
  delete(id: string): Promise<void>;
}
