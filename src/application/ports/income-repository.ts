import { MonthlyIncome } from '../../domain/entities/monthly-income';

export interface IncomeRepository {
  upsert(income: MonthlyIncome): Promise<void>;
  /** `month` is `YYYY-MM`. */
  find(userId: string, month: string): Promise<MonthlyIncome | null>;
}
