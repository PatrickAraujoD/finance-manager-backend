import { Category } from '../../../src/domain/entities/category';
import { CategoryRepository } from '../../../src/application/ports/category-repository';
import { FakeExpenseRepository } from './fake-expense-repository';

export class FakeCategoryRepository implements CategoryRepository {
  private readonly items = new Map<string, Category>();

  constructor(private readonly expenses: FakeExpenseRepository = new FakeExpenseRepository()) {}

  async save(category: Category): Promise<void> {
    this.items.set(category.id, category);
  }
  async findById(id: string): Promise<Category | null> {
    return this.items.get(id) ?? null;
  }
  async listVisibleTo(userId: string): Promise<Category[]> {
    return [...this.items.values()].filter((c) => c.isGlobal() || c.ownerId === userId);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
  async isInUse(id: string): Promise<boolean> {
    return this.expenses.all().some((e) => e.categoryId === id);
  }
}
