import { Category } from '../../domain/entities/category';

export interface CategoryRepository {
  /**
   * Upsert: inserts or replaces the category with the same id. A different category with the same
   * `nameKey` in the same scope (same owner, or both global) MUST throw `ConflictError`
   * (implementations translate the unique-constraint violation).
   */
  save(category: Category): Promise<void>;
  findById(id: string): Promise<Category | null>;
  /** Global categories plus the ones owned by `userId`. */
  listVisibleTo(userId: string): Promise<Category[]>;
  /** Throws `ConflictError` when expenses still reference the category (never deletes them). */
  delete(id: string): Promise<void>;
  /** True when at least one expense references the category. */
  isInUse(id: string): Promise<boolean>;
}
