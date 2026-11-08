import { ValidationError } from '../errors';
import { requireNonBlank } from '../validation';

export const MAX_CATEGORY_NAME = 60;

export interface CategoryProps {
  id: string;
  name: string;
  ownerId: string | null;
}

export class Category {
  private constructor(private readonly props: CategoryProps) {}

  static create(input: CategoryProps): Category {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.name, 'Category name');
    if (input.ownerId !== null) requireNonBlank(input.ownerId, 'ownerId');
    // Stored form: NFC, inner whitespace runs collapsed to one space, trimmed. The limit counts
    // code points (not UTF-16 units) so emoji are not penalized.
    const name = input.name.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (Array.from(name).length > MAX_CATEGORY_NAME) {
      throw new ValidationError(`Category name must have at most ${MAX_CATEGORY_NAME} characters`);
    }
    return new Category({ ...input, name });
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get ownerId(): string | null {
    return this.props.ownerId;
  }

  /** Unicode-normalized, lowercase name: two names with the same key are duplicates in a scope. */
  get nameKey(): string {
    return this.props.name.normalize('NFC').toLowerCase();
  }

  isGlobal(): boolean {
    return this.props.ownerId === null;
  }
}
