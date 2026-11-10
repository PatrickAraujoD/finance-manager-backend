import {
  CategoryTotal,
  DayTotal,
  MonthTotal,
  ReportRepository,
} from '../../../src/application/ports/report-repository';
import { Money } from '../../../src/domain/money';
import { FakeCategoryRepository } from './fake-category-repository';
import { FakeExpenseRepository } from './fake-expense-repository';

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export class FakeReportRepository implements ReportRepository {
  constructor(
    private readonly expenses: FakeExpenseRepository,
    private readonly categories: FakeCategoryRepository,
  ) {}

  private async sumBy<K extends string>(
    userId: string,
    keyOf: (spentAt: Date, categoryId: string) => K,
    include: (spentAt: Date) => boolean,
    // Same rule as the SQL of the grouped reports; totalSpent still counts bill payments.
    skipCardPayments = true,
  ): Promise<Map<K, number>> {
    const totals = new Map<K, number>();
    for (const e of await this.expenses.listByUser(userId, {})) {
      if (!include(e.spentAt) || (skipCardPayments && e.isCardPayment)) continue;
      const key = keyOf(e.spentAt, e.categoryId);
      totals.set(key, (totals.get(key) ?? 0) + e.amount.cents);
    }
    return totals;
  }

  async totalsByCategory(userId: string, month: string): Promise<CategoryTotal[]> {
    const totals = await this.sumBy(
      userId,
      (_d, categoryId) => categoryId,
      (d) => monthOf(d) === month,
    );
    const rows: CategoryTotal[] = [];
    for (const [categoryId, cents] of totals) {
      const category = await this.categories.findById(categoryId);
      rows.push({
        categoryId,
        categoryName: category?.name ?? categoryId,
        total: Money.fromCents(cents),
      });
    }
    return rows.sort((a, b) => b.total.cents - a.total.cents);
  }

  async totalsByDay(userId: string, month: string): Promise<DayTotal[]> {
    const totals = await this.sumBy(
      userId,
      (d) => dayOf(d),
      (d) => monthOf(d) === month,
    );
    return [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cents]) => ({ date, total: Money.fromCents(cents) }));
  }

  async totalsByMonth(userId: string, fromMonth: string, toMonth: string): Promise<MonthTotal[]> {
    const totals = await this.sumBy(
      userId,
      (d) => monthOf(d),
      (d) => monthOf(d) >= fromMonth && monthOf(d) <= toMonth,
    );
    return [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cents]) => ({ month, total: Money.fromCents(cents) }));
  }

  async totalSpent(userId: string, month: string): Promise<Money> {
    const totals = await this.sumBy(
      userId,
      () => 'all',
      (d) => monthOf(d) === month,
      false,
    );
    return Money.fromCents(totals.get('all') ?? 0);
  }
}
