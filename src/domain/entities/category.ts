import { ValidationError } from '../errors';

export interface CategoryProps {
  id: string;
  name: string;
  ownerId: string | null;
}

export class Category {
  private constructor(private readonly props: CategoryProps) {}

  static create(input: CategoryProps): Category {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Category name is required');
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

  isGlobal(): boolean {
    return this.props.ownerId === null;
  }
}
