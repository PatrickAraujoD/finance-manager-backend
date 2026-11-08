import { ValidationError } from '../errors';
import { Money } from '../money';
import { requireNonBlank } from '../validation';

const MAX_DESCRIPTION = 500;

export interface ExpenseProps {
  id: string;
  userId: string;
  categoryId: string;
  receiptId: string | null;
  amount: Money;
  paidAlone: boolean;
  spentAt: Date;
  description?: string;
}

export class Expense {
  private constructor(private readonly props: ExpenseProps) {}

  static create(input: ExpenseProps): Expense {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.userId, 'userId');
    requireNonBlank(input.categoryId, 'categoryId');
    if (input.amount.cents <= 0) throw new ValidationError('Expense amount must be positive');
    if (Number.isNaN(input.spentAt.getTime())) throw new ValidationError('Invalid spentAt date');
    if (input.description !== undefined && input.description.length > MAX_DESCRIPTION) {
      throw new ValidationError(`Description must have at most ${MAX_DESCRIPTION} characters`);
    }
    return new Expense({ ...input, spentAt: new Date(input.spentAt.getTime()) });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get categoryId(): string {
    return this.props.categoryId;
  }
  get receiptId(): string | null {
    return this.props.receiptId;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get paidAlone(): boolean {
    return this.props.paidAlone;
  }
  get spentAt(): Date {
    return new Date(this.props.spentAt.getTime());
  }
  get description(): string | undefined {
    return this.props.description;
  }
}
