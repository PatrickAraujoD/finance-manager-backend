import { Loan } from '../../../domain/entities/loan';
import { NotFoundError, ValidationError } from '../../../domain/errors';
import { Money } from '../../../domain/money';
import { PaymentMethod } from '../../../domain/payment-method';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { ExpenseRepository } from '../../ports/expense-repository';
import { IdGenerator } from '../../ports/id-generator';
import { LoanRepository } from '../../ports/loan-repository';
import { toAmount, toPaymentMethod } from '../expenses/expense-input';
import { toBorrowerName, toDueDate, toLentAt, todayUtc } from './loan-input';

/**
 * Exactly one of `expenseId` (the amount, the payment method and the date come from the expense)
 * or `amountCents` (money lent directly, which then needs `paymentMethod`).
 */
export interface CreateLoanInput {
  borrowerName: string;
  /** `YYYY-MM-DD`, a real calendar date from 2000-01-01 on; the past is allowed. */
  dueDate: string;
  expenseId?: string;
  amountCents?: number;
  /** Required with `amountCents`, forbidden with `expenseId`. */
  paymentMethod?: PaymentMethod;
  /** `YYYY-MM-DD`, with `amountCents` only; defaults to today, at most tomorrow, from 2000 on. */
  lentAt?: string;
}

export class CreateLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly expenses: ExpenseRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: CreateLoanInput): Promise<{ id: string }> {
    // Pure input checks first (400), then the expense lookup (404), then the write (409).
    const borrowerName = toBorrowerName(input.borrowerName);
    const dueDate = toDueDate(input.dueDate);
    const { expenseId, amountCents } = input;
    if ((expenseId === undefined) === (amountCents === undefined)) {
      throw new ValidationError('Send exactly one of expenseId or amountCents');
    }
    let amount: Money;
    let paymentMethod: PaymentMethod | null = null;
    let lentAt: Date | null = null;
    if (expenseId === undefined) {
      amount = toAmount(amountCents);
      paymentMethod = toPaymentMethod(input.paymentMethod);
      lentAt = input.lentAt === undefined ? todayUtc(this.clock) : toLentAt(input.lentAt, this.clock);
    } else {
      // The expense already says how and when the money left: a second answer would count twice.
      if (input.paymentMethod !== undefined || input.lentAt !== undefined) {
        throw new ValidationError('paymentMethod and lentAt only go with amountCents');
      }
      if (typeof expenseId !== 'string' || expenseId.trim() === '') {
        throw new ValidationError('expenseId must be a non blank text');
      }
      // Scoped to the actor: someone else's expense looks exactly like a missing one.
      const expense = await this.expenses.findById(actor.id, expenseId);
      if (!expense) throw new NotFoundError('Expense not found');
      // A bill payment moves money to the card; it did not lend anything to anyone.
      if (expense.isCardPayment) {
        throw new ValidationError('An expense that pays the card bill cannot back a loan');
      }
      amount = expense.amount;
    }
    const loan = Loan.create({
      id: this.ids.next(),
      userId: actor.id,
      borrowerName,
      amount,
      dueDate,
      expenseId: expenseId ?? null,
      paymentMethod,
      lentAt,
    });
    // UNIQUE(expenseId) in the repository: two requests racing for one expense, one wins.
    await this.loans.save(loan);
    return { id: loan.id };
  }
}
