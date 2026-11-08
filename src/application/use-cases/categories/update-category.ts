import { Category } from '../../../domain/entities/category';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { findEditableCategory } from './find-editable-category';

export class UpdateCategory {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(actor: Actor, id: string, input: { name: string }): Promise<Category> {
    const current = await findEditableCategory(this.categories, actor, id);
    const updated = Category.create({
      id: current.id,
      name: input.name,
      ownerId: current.ownerId,
    });
    await this.categories.save(updated);
    return updated;
  }
}
