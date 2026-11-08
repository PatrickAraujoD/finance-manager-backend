import { Category } from '../../../domain/entities/category';
import { ConflictError, ForbiddenError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { IdGenerator } from '../../ports/id-generator';

/**
 * Ceiling of PERSONAL categories per user (global ones are not counted). Keeps `GET /categories`
 * bounded. The check is count-then-insert, so concurrent creations may overshoot by a few; that
 * is acceptable for a soft safety limit.
 */
export const MAX_OWNED_CATEGORIES = 100;

export interface CreateCategoryInput {
  name: string;
  global?: boolean;
}

export class CreateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(actor: Actor, input: CreateCategoryInput): Promise<{ id: string }> {
    const global = input.global === true;
    if (global && actor.role !== 'A') throw new ForbiddenError('Forbidden');
    if (!global && (await this.categories.countOwnedBy(actor.id)) >= MAX_OWNED_CATEGORIES) {
      throw new ConflictError(`You can have at most ${MAX_OWNED_CATEGORIES} personal categories`);
    }
    const category = Category.create({
      id: this.ids.next(),
      name: input.name,
      ownerId: global ? null : actor.id,
    });
    // Duplicate names in the same scope surface as ConflictError from the repository.
    await this.categories.save(category);
    return { id: category.id };
  }
}
