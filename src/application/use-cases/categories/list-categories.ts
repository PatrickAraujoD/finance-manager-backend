import { Category } from '../../../domain/entities/category';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';

export class ListCategories {
  constructor(private readonly categories: CategoryRepository) {}

  /** Global categories plus the actor's own. */
  execute(actor: Actor): Promise<Category[]> {
    return this.categories.listVisibleTo(actor.id);
  }
}
