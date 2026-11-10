import { ValidationError } from '../errors';
import { Money } from '../money';
import { PaymentMethod, parsePaymentMethod } from '../payment-method';
import { requireCleanText, requireNonBlank } from '../validation';

const MAX_DESCRIPTION = 500;

/**
 * Largest accepted expense: R$ 10,000,000.00 (1,000,000,000 cents). A sanity ceiling against
 * typos and abuse, far below Number.MAX_SAFE_INTEGER so report sums can never overflow.
 */
export const MAX_EXPENSE_CENTS = 1_000_000_000;

export interface ExpenseProps {
  id: string;
  userId: string;
  categoryId: string;
  receiptId: string | null;
  amount: Money;
  paidAlone: boolean;
  paymentMethod: PaymentMethod;
  /** True when the expense pays the credit card bill (the purchases were counted when made). */
  isCardPayment: boolean;
  spentAt: Date;
  description?: string;
  /** Set by the database; null until the expense is persisted. */
  createdAt?: Date | null;
}

function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export class Expense {
  private constructor(private readonly props: ExpenseProps) {}

  static create(input: ExpenseProps): Expense {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.userId, 'userId');
    requireNonBlank(input.categoryId, 'categoryId');
    if (input.receiptId !== null) requireNonBlank(input.receiptId, 'receiptId');
    parsePaymentMethod(input.paymentMethod);
    if (typeof input.isCardPayment !== 'boolean') {
      throw new ValidationError('isCardPayment must be true or false');
    }
    // The card is paid with money from the account, never with the card itself.
    if (input.isCardPayment && input.paymentMethod === 'CREDIT') {
      throw new ValidationError('A card bill payment cannot be paid with CREDIT');
    }
    if (input.description !== undefined) requireCleanText(input.description, 'description', { kind: 'description' });
    if (input.amount.cents <= 0) throw new ValidationError('Expense amount must be positive');
    if (input.amount.cents > MAX_EXPENSE_CENTS) {
      throw new ValidationError(`Expense amount must be at most ${MAX_EXPENSE_CENTS} cents`);
    }
    if (Number.isNaN(input.spentAt.getTime())) throw new ValidationError('Invalid spentAt date');
    if (input.description !== undefined && input.description.length > MAX_DESCRIPTION) {
      throw new ValidationError(`Description must have at most ${MAX_DESCRIPTION} characters`);
    }
    return new Expense({
      ...input,
      spentAt: toUtcDay(input.spentAt),
      createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : null,
    });
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
  get paymentMethod(): PaymentMethod {
    return this.props.paymentMethod;
  }
  get isCardPayment(): boolean {
    return this.props.isCardPayment;
  }
  get spentAt(): Date {
    return new Date(this.props.spentAt.getTime());
  }
  get description(): string | undefined {
    return this.props.description;
  }
  get createdAt(): Date | null {
    return this.props.createdAt ? new Date(this.props.createdAt.getTime()) : null;
  }
}
