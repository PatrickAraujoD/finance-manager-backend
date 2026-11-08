import { Category } from '../../../src/domain/entities/category';
import { ConflictError } from '../../../src/domain/errors';
import { CategoryRepository } from '../../../src/application/ports/category-repository';
import { FakeExpenseRepository } from './fake-expense-repository';

export class FakeCategoryRepository implements CategoryRepository {
  private readonly items = new Map<string, Category>();

  constructor(private readonly expenses: FakeExpenseRepository = new FakeExpenseRepository()) {}

  async save(category: Category): Promise<void> {
    for (const other of this.items.values()) {
      if (
        other.id !== category.id &&
        other.ownerId === category.ownerId &&
        other.nameKey === category.nameKey
      ) {
        throw new ConflictError('Category name already in use');
      }
    }
    this.items.set(category.id, category);
  }
  async findById(id: string): Promise<Category | null> {
    return this.items.get(id) ?? null;
  }
  async listVisibleTo(userId: string): Promise<Category[]> {
    return [...this.items.values()].filter((c) => c.isGlobal() || c.ownerId === userId);
  }
  async delete(id: string): Promise<void> {
    if (await this.isInUse(id)) throw new ConflictError('Category is in use');
    this.items.delete(id);
  }
  async isInUse(id: string): Promise<boolean> {
    return this.expenses.all().some((e) => e.categoryId === id);
  }
}
