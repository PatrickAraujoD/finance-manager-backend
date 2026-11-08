import { Category } from '../../../domain/entities/category';
import { ForbiddenError, NotFoundError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';

/**
 * Loads a category the actor may change: their own, or a global one when they are admin.
 * Someone else's personal category is reported as missing so its existence does not leak.
 */
export async function findEditableCategory(
  categories: CategoryRepository,
  actor: Actor,
  id: string,
): Promise<Category> {
  const category = await categories.findById(id);
  if (!category || (!category.isGlobal() && category.ownerId !== actor.id)) {
    throw new NotFoundError('Category not found');
  }
  if (category.isGlobal() && actor.role !== 'A') throw new ForbiddenError('Forbidden');
  return category;
}
