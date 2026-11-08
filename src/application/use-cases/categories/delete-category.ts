import { ConflictError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { findEditableCategory } from './find-editable-category';

export class DeleteCategory {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(actor: Actor, id: string): Promise<void> {
    await findEditableCategory(this.categories, actor, id);
    if (await this.categories.isInUse(id)) throw new ConflictError('Category is in use');
    // The repository also refuses (ConflictError) if an expense appears in between.
    await this.categories.delete(id);
  }
}
