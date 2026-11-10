import { ValidationError } from '../errors';
import { Money } from '../money';
import { PaymentMethod } from '../payment-method';
import { requireNonBlank } from '../validation';
import { MAX_EXPENSE_CENTS } from './expense';

export const MAX_BORROWER_NAME = 100;

export interface LoanProps {
  id: string;
  userId: string;
  borrowerName: string;
  amount: Money;
  /** A calendar date; normalized to 00:00 UTC. */
  dueDate: Date;
  /** The expense this loan was created from; null for money lent directly. Never changes. */
  expenseId: string | null;
  /** How the money left, for money lent directly; null for a loan born from an expense. */
  paymentMethod?: PaymentMethod | null;
  /** A calendar date (normalized to 00:00 UTC): when the money left; null like paymentMethod. */
  lentAt?: Date | null;
  /** Set by the database; null until the loan is persisted. */
  createdAt?: Date | null;
}

function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export class Loan {
  private constructor(private readonly props: Required<LoanProps>) {}

  static create(input: LoanProps): Loan {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.userId, 'userId');
    if (input.expenseId !== null) requireNonBlank(input.expenseId, 'expenseId');
    requireNonBlank(input.borrowerName, 'borrowerName', { kind: 'name' });
    const borrowerName = input.borrowerName.trim();
    if (Array.from(borrowerName).length > MAX_BORROWER_NAME) {
      throw new ValidationError(`borrowerName must have at most ${MAX_BORROWER_NAME} characters`);
    }
    if (input.amount.cents <= 0) throw new ValidationError('Loan amount must be positive');
    if (input.amount.cents > MAX_EXPENSE_CENTS) {
      throw new ValidationError(`Loan amount must be at most ${MAX_EXPENSE_CENTS} cents`);
    }
    if (Number.isNaN(input.dueDate.getTime())) throw new ValidationError('Invalid dueDate');
    return new Loan({
      id: input.id,
      userId: input.userId,
      borrowerName,
      amount: input.amount,
      dueDate: toUtcDay(input.dueDate),
      expenseId: input.expenseId,
      paymentMethod: input.paymentMethod ?? null,
      lentAt: input.lentAt ? toUtcDay(input.lentAt) : null,
      createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : null,
    });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get borrowerName(): string {
    return this.props.borrowerName;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get dueDate(): Date {
    return new Date(this.props.dueDate.getTime());
  }
  get expenseId(): string | null {
    return this.props.expenseId;
  }
  get paymentMethod(): PaymentMethod | null {
    return this.props.paymentMethod;
  }
  get lentAt(): Date | null {
    return this.props.lentAt ? new Date(this.props.lentAt.getTime()) : null;
  }
  get createdAt(): Date | null {
    return this.props.createdAt ? new Date(this.props.createdAt.getTime()) : null;
  }
}
