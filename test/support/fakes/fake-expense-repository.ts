import { Expense } from '../../../src/domain/entities/expense';
import {
  ExpenseFilter,
  ExpenseRepository,
} from '../../../src/application/ports/expense-repository';

export class FakeExpenseRepository implements ExpenseRepository {
  private readonly items = new Map<string, Expense>();

  async save(expense: Expense): Promise<void> {
    this.items.set(expense.id, expense);
  }
  async findById(id: string): Promise<Expense | null> {
    return this.items.get(id) ?? null;
  }
  async listByUser(userId: string, filter: ExpenseFilter): Promise<Expense[]> {
    return [...this.items.values()].filter(
      (e) =>
        e.userId === userId &&
        (!filter.from || e.spentAt >= filter.from) &&
        (!filter.to || e.spentAt <= filter.to) &&
        (!filter.categoryId || e.categoryId === filter.categoryId),
    );
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
  /** Test helper, not part of the port. */
  all(): Expense[] {
    return [...this.items.values()];
  }
}
