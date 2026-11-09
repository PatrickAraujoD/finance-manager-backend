import { ValidationError } from '../errors';
import { LoanPaymentMethod, parseLoanPaymentMethod } from '../loan-payment-method';
import { Money } from '../money';
import { requireNonBlank } from '../validation';
import { MAX_EXPENSE_CENTS } from './expense';

export interface LoanPaymentProps {
  id: string;
  loanId: string;
  userId: string;
  amount: Money;
  method: LoanPaymentMethod;
  /** Required for PIX, forbidden for CASH. */
  receiptId: string | null;
  /** A calendar date; normalized to 00:00 UTC. */
  paidAt: Date;
  /** Set by the database; null until the payment is persisted. */
  createdAt?: Date | null;
}

function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export class LoanPayment {
  private constructor(private readonly props: Required<LoanPaymentProps>) {}

  static create(input: LoanPaymentProps): LoanPayment {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.loanId, 'loanId');
    requireNonBlank(input.userId, 'userId');
    const method = parseLoanPaymentMethod(input.method);
    // A PIX payment without proof, or cash with a proof, is a contradiction the domain refuses.
    if (method === 'PIX') {
      if (input.receiptId === null) throw new ValidationError('A PIX payment requires a receipt');
      requireNonBlank(input.receiptId, 'receiptId');
    } else if (input.receiptId !== null) {
      throw new ValidationError('A CASH payment cannot have a receipt');
    }
    if (input.amount.cents <= 0) throw new ValidationError('Payment amount must be positive');
    if (input.amount.cents > MAX_EXPENSE_CENTS) {
      throw new ValidationError(`Payment amount must be at most ${MAX_EXPENSE_CENTS} cents`);
    }
    if (Number.isNaN(input.paidAt.getTime())) throw new ValidationError('Invalid paidAt');
    return new LoanPayment({
      id: input.id,
      loanId: input.loanId,
      userId: input.userId,
      amount: input.amount,
      method,
      receiptId: input.receiptId,
      paidAt: toUtcDay(input.paidAt),
      createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : null,
    });
  }

  get id(): string {
    return this.props.id;
  }
  get loanId(): string {
    return this.props.loanId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get method(): LoanPaymentMethod {
    return this.props.method;
  }
  get receiptId(): string | null {
    return this.props.receiptId;
  }
  get paidAt(): Date {
    return new Date(this.props.paidAt.getTime());
  }
  get createdAt(): Date | null {
    return this.props.createdAt ? new Date(this.props.createdAt.getTime()) : null;
  }
}
