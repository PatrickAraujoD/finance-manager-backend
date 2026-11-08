import { Category } from '../../src/domain/entities/category';
import { Expense } from '../../src/domain/entities/expense';
import { MonthlyIncome } from '../../src/domain/entities/monthly-income';
import { Money } from '../../src/domain/money';
import { Role } from '../../src/domain/role';
import { FakeCategoryRepository } from './fakes/fake-category-repository';
import { FakeExpenseRepository } from './fakes/fake-expense-repository';
import { FakeIncomeRepository } from './fakes/fake-income-repository';
import { FakeReportRepository } from './fakes/fake-report-repository';

export const ana = { id: 'ana', role: 'N' as Role };
export const bob = { id: 'bob', role: 'N' as Role };
export const admin = { id: 'admin', role: 'A' as Role };

/** In-memory data for the report use cases: fakes plus tiny helpers to seed them. */
export function reportsWorld() {
  const expenses = new FakeExpenseRepository();
  const categories = new FakeCategoryRepository(expenses);
  const incomes = new FakeIncomeRepository();
  const reports = new FakeReportRepository(expenses, categories);
  let counter = 0;

  return {
    expenses,
    categories,
    incomes,
    reports,
    async category(id: string, name: string, ownerId: string | null = null): Promise<void> {
      await categories.save(Category.create({ id, name, ownerId }));
    },
    async spend(userId: string, categoryId: string, cents: number, date: string): Promise<void> {
      await expenses.save(
        Expense.create({
          id: `e${++counter}`,
          userId,
          categoryId,
          receiptId: null,
          amount: Money.fromCents(cents),
          paidAlone: true,
          spentAt: new Date(`${date}T00:00:00Z`),
        }),
      );
    },
    async earn(userId: string, month: string, cents: number): Promise<void> {
      await incomes.upsert(MonthlyIncome.create({ userId, month, amount: Money.fromCents(cents) }));
    },
  };
}
