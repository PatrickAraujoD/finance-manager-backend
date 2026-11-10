import { Expense } from '../../../src/domain/entities/expense';
import { ConflictError } from '../../../src/domain/errors';
import {
  ExpenseFilter,
  ExpensePage,
  ExpenseRepository,
} from '../../../src/application/ports/expense-repository';

export class FakeExpenseRepository implements ExpenseRepository {
  private readonly items = new Map<string, Expense>();

  async save(expense: Expense): Promise<void> {
    if (this.items.has(expense.id)) throw new ConflictError('Expense id already exists');
    if (
      expense.receiptId !== null &&
      [...this.items.values()].some((e) => e.receiptId === expense.receiptId)
    ) {
      throw new ConflictError('Receipt already used by an expense');
    }
    this.items.set(expense.id, expense);
  }
  async update(expense: Expense): Promise<boolean> {
    const current = this.items.get(expense.id);
    if (!current || current.userId !== expense.userId) return false;
    this.items.set(
      expense.id,
      Expense.create({
        id: current.id,
        userId: current.userId,
        receiptId: current.receiptId,
        categoryId: expense.categoryId,
        amount: expense.amount,
        paidAlone: expense.paidAlone,
        paymentMethod: expense.paymentMethod,
        isCardPayment: expense.isCardPayment,
        spentAt: expense.spentAt,
        description: expense.description,
        createdAt: current.createdAt,
      }),
    );
    return true;
  }
  async findById(userId: string, id: string): Promise<Expense | null> {
    const e = this.items.get(id);
    return e && e.userId === userId ? e : null;
  }
  private matching(userId: string, filter: ExpenseFilter): Expense[] {
    return [...this.items.values()]
      .filter(
        (e) =>
          e.userId === userId &&
          (!filter.from || e.spentAt >= filter.from) &&
          (!filter.to || e.spentAt <= filter.to) &&
          (!filter.categoryId || e.categoryId === filter.categoryId) &&
          (!filter.paymentMethod || e.paymentMethod === filter.paymentMethod) &&
          (filter.isCardPayment === undefined || e.isCardPayment === filter.isCardPayment),
      )
      .sort((x, y) => y.spentAt.getTime() - x.spentAt.getTime() || (x.id < y.id ? 1 : -1));
  }
  async listByUser(userId: string, filter: ExpenseFilter, page?: ExpensePage): Promise<Expense[]> {
    const all = this.matching(userId, filter);
    return page ? all.slice(page.offset, page.offset + page.limit) : all;
  }
  async countByUser(userId: string, filter: ExpenseFilter): Promise<number> {
    return this.matching(userId, filter).length;
  }
  async isReceiptUsed(receiptId: string): Promise<boolean> {
    return [...this.items.values()].some((e) => e.receiptId === receiptId);
  }
  async delete(userId: string, id: string): Promise<boolean> {
    const e = this.items.get(id);
    if (!e || e.userId !== userId) return false;
    this.items.delete(id);
    return true;
  }
  /** Test helper, not part of the port. */
  all(): Expense[] {
    return [...this.items.values()];
  }
}
