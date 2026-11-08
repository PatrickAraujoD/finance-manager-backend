import { Category } from '../../domain/entities/category';

export interface CategoryRepository {
  /** Upsert: inserts or replaces the category with the same id. */
  save(category: Category): Promise<void>;
  findById(id: string): Promise<Category | null>;
  /** Global categories plus the ones owned by `userId`. */
  listVisibleTo(userId: string): Promise<Category[]>;
  delete(id: string): Promise<void>;
  /** True when at least one expense references the category. */
  isInUse(id: string): Promise<boolean>;
}
