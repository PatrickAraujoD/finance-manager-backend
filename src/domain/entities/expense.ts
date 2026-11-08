import { ValidationError } from '../errors';
import { Money } from '../money';

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
    if (input.amount.cents <= 0) throw new ValidationError('Expense amount must be positive');
    if (Number.isNaN(input.spentAt.getTime())) throw new ValidationError('Invalid spentAt date');
    return new Expense({ ...input });
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
    return this.props.spentAt;
  }
  get description(): string | undefined {
    return this.props.description;
  }
}
