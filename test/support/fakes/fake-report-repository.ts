import {
  CategoryTotal,
  DayTotal,
  MonthTotal,
  ReportRepository,
  SplitTotal,
} from '../../../src/application/ports/report-repository';
import { Money } from '../../../src/domain/money';
import { FakeCategoryRepository } from './fake-category-repository';
import { FakeExpenseRepository } from './fake-expense-repository';
import { FakeLoanPaymentRepository } from './fake-loan-payment-repository';
import { FakeLoanRepository } from './fake-loan-repository';

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export class FakeReportRepository implements ReportRepository {
  constructor(
    private readonly expenses: FakeExpenseRepository,
    private readonly categories: FakeCategoryRepository,
    private readonly loanPayments: FakeLoanPaymentRepository,
    private readonly loans: FakeLoanRepository,
  ) {}

  private async sumBy<K extends string>(
    userId: string,
    keyOf: (spentAt: Date, categoryId: string) => K,
    include: (spentAt: Date) => boolean,
  ): Promise<Map<K, number>> {
    const totals = new Map<K, number>();
    for (const e of await this.expenses.listByUser(userId, {})) {
      if (!include(e.spentAt) || e.isCardPayment) continue;
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

  // Balance aggregates: same month boundaries as the SQL (UTC calendar dates, `YYYY-MM` strings
  // compare in chronological order).
  private async expenseTotal(
    userId: string,
    keep: (e: { paymentMethod: string; isCardPayment: boolean }) => boolean,
    inWindow: (month: string) => boolean,
  ): Promise<Money> {
    let total = 0;
    for (const e of await this.expenses.listByUser(userId, {})) {
      if (keep(e) && inWindow(monthOf(e.spentAt))) total += e.amount.cents;
    }
    return Money.fromCents(total);
  }

  private async split(
    userId: string,
    month: string,
    keep: (e: { paymentMethod: string; isCardPayment: boolean }) => boolean,
  ): Promise<SplitTotal> {
    return {
      beforeMonth: await this.expenseTotal(userId, keep, (m) => m < month),
      inMonth: await this.expenseTotal(userId, keep, (m) => m === month),
    };
  }

  accountOutflow(userId: string, month: string): Promise<Money> {
    return this.expenseTotal(userId, (e) => e.paymentMethod !== 'CREDIT', (m) => m === month);
  }

  creditSpent(userId: string, month: string): Promise<Money> {
    return this.expenseTotal(userId, (e) => e.paymentMethod === 'CREDIT', (m) => m === month);
  }

  async loanPaymentsReceived(userId: string, month: string): Promise<Money> {
    let total = 0;
    for (const p of await this.loanPayments.listByUser(userId)) {
      if (monthOf(p.paidAt) === month) total += p.amount.cents;
    }
    return Money.fromCents(total);
  }

  cardCharges(userId: string, month: string): Promise<SplitTotal> {
    return this.split(userId, month, (e) => e.paymentMethod === 'CREDIT');
  }

  cardPayments(userId: string, month: string): Promise<SplitTotal> {
    return this.split(userId, month, (e) => e.isCardPayment);
  }

  // Direct loans only (no expense); the others are counted through their expense.
  private async directLoanTotal(
    userId: string,
    keep: (paymentMethod: string) => boolean,
    inWindow: (month: string) => boolean,
  ): Promise<Money> {
    let total = 0;
    for (const l of await this.loans.listByUser(userId, {})) {
      if (l.expenseId !== null || !l.paymentMethod || !l.lentAt) continue;
      if (keep(l.paymentMethod) && inWindow(monthOf(l.lentAt))) total += l.amount.cents;
    }
    return Money.fromCents(total);
  }

  directLoansOutflow(userId: string, month: string): Promise<Money> {
    return this.directLoanTotal(userId, (m) => m !== 'CREDIT', (m) => m === month);
  }

  async directLoansOnCredit(userId: string, month: string): Promise<SplitTotal> {
    const credit = (m: string) => m === 'CREDIT';
    return {
      beforeMonth: await this.directLoanTotal(userId, credit, (m) => m < month),
      inMonth: await this.directLoanTotal(userId, credit, (m) => m === month),
    };
  }
}
