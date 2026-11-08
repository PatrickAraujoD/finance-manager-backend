import { Money } from '../../domain/money';

/** All `month` arguments are `YYYY-MM`; `date` is `YYYY-MM-DD`. Only user-owned expenses count. */
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

export interface ReportRepository {
  /** Only categories with spending in the month. */
  totalsByCategory(userId: string, month: string): Promise<CategoryTotal[]>;
  /** Only days with spending, ordered by date ascending. */
  totalsByDay(userId: string, month: string): Promise<DayTotal[]>;
  /** Inclusive range; only months with spending, ordered ascending. */
  totalsByMonth(userId: string, fromMonth: string, toMonth: string): Promise<MonthTotal[]>;
  /** Zero when there is no spending. */
  totalSpent(userId: string, month: string): Promise<Money>;
}
