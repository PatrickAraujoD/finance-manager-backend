import { Category } from '../../../domain/entities/category';
import { ForbiddenError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { IdGenerator } from '../../ports/id-generator';

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
