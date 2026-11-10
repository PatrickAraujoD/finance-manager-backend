import { ValidationError } from '../errors';
import { Money } from '../money';
import { parsePaymentMethod, PaymentMethod } from '../payment-method';
import { requireNonBlank } from '../validation';
import { MAX_EXPENSE_CENTS } from './expense';

export const MAX_BORROWER_NAME = 100;
/** Oldest accepted `lentAt`: older than this is a typo, and it keeps the date in every range. */
export const MIN_LENT_AT = '2000-01-01';

export interface LoanProps {
  id: string;
  userId: string;
  borrowerName: string;
  amount: Money;
  /** A calendar date; normalized to 00:00 UTC. */
  dueDate: Date;
  /** The expense this loan was created from; null for money lent directly. Never changes. */
  expenseId: string | null;
  /**
   * How the money left. Required for money lent directly (expenseId null); null for a loan born
   * from an expense, which inherits it from the expense so nothing is counted twice.
   */
  paymentMethod: PaymentMethod | null;
  /** A calendar date (normalized to 00:00 UTC): when the money left; null like paymentMethod. */
  lentAt: Date | null;
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
    const { paymentMethod, lentAt } = Loan.validatedLending(input);
    return new Loan({
      id: input.id,
      userId: input.userId,
      borrowerName,
      amount: input.amount,
      dueDate: toUtcDay(input.dueDate),
      expenseId: input.expenseId,
      paymentMethod,
      lentAt,
      createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : null,
    });
  }

  /** Both fields or neither, decided by whether the loan comes from an expense. */
  private static validatedLending(input: LoanProps): {
    paymentMethod: PaymentMethod | null;
    lentAt: Date | null;
  } {
    if (input.expenseId !== null) {
      if (input.paymentMethod !== null || input.lentAt !== null) {
        throw new ValidationError('A loan from an expense takes no paymentMethod or lentAt');
      }
      return { paymentMethod: null, lentAt: null };
    }
    if (input.paymentMethod === null || input.lentAt === null) {
      throw new ValidationError('Money lent directly needs a paymentMethod and a lentAt');
    }
    const paymentMethod = parsePaymentMethod(input.paymentMethod);
    if (Number.isNaN(input.lentAt.getTime())) throw new ValidationError('Invalid lentAt');
    const lentAt = toUtcDay(input.lentAt);
    if (lentAt.getTime() < Date.parse(`${MIN_LENT_AT}T00:00:00Z`)) {
      throw new ValidationError(`lentAt cannot be before ${MIN_LENT_AT}`);
    }
    return { paymentMethod, lentAt };
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
