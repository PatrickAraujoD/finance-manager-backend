import { Money } from '../../domain/money';

/**
 * All `month` arguments are `YYYY-MM`; `date` is `YYYY-MM-DD`. Only user-owned expenses count.
 * `Expense.spentAt` is a calendar date stored as `Date` at 00:00 UTC, so grouping by day/month
 * is always done in UTC (CTO decision).
 */
export interface CategoryTotal {
  categoryId: string;
  categoryName: string;
  total: Money;
}

export interface DayTotal {
  date: string;
  total: Money;
}

export interface MonthTotal {
  month: string;
  total: Money;
}

/** A sum split at the first day of a month: strictly before it, and inside it. */
export interface SplitTotal {
  beforeMonth: Money;
  inMonth: Money;
}

export interface ReportRepository {
  /** Only categories with spending in the month. */
  totalsByCategory(userId: string, month: string): Promise<CategoryTotal[]>;
  /** Only days with spending, ordered by date ascending. */
  totalsByDay(userId: string, month: string): Promise<DayTotal[]>;
  /** Inclusive range; only months with spending, ordered ascending. */
  totalsByMonth(userId: string, fromMonth: string, toMonth: string): Promise<MonthTotal[]>;
  /** Zero when there is no spending. */
  totalSpent(userId: string, month: string): Promise<Money>;
  /**
   * Balance aggregates, each ONE query scoped to `userId`; all return zero without data.
   * Money that left the account in the month: expenses NOT paid with CREDIT, card bill payments
   * included.
   */
  accountOutflow(userId: string, month: string): Promise<Money>;
  /** Expenses paid with CREDIT dated in the month. */
  creditSpent(userId: string, month: string): Promise<Money>;
  /** Loan payments received (CASH or PIX) with `paidAt` in the month. */
  loanPaymentsReceived(userId: string, month: string): Promise<Money>;
  /** Credit charges up to the end of the month, split at its first day. */
  cardCharges(userId: string, month: string): Promise<SplitTotal>;
  /** Card bill payments (`isCardPayment`) up to the end of the month, split at its first day. */
  cardPayments(userId: string, month: string): Promise<SplitTotal>;
}
