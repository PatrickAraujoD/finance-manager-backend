import { MonthlyIncome } from '../../../src/domain/entities/monthly-income';
import { IncomeRepository } from '../../../src/application/ports/income-repository';

export class FakeIncomeRepository implements IncomeRepository {
  private readonly items = new Map<string, MonthlyIncome>();

  async upsert(income: MonthlyIncome): Promise<void> {
    this.items.set(`${income.userId}|${income.month}`, income);
  }
  async find(userId: string, month: string): Promise<MonthlyIncome | null> {
    return this.items.get(`${userId}|${month}`) ?? null;
  }
}
