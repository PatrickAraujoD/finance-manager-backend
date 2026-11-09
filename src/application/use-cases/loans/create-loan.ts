import { Loan } from '../../../domain/entities/loan';
import { NotFoundError, ValidationError } from '../../../domain/errors';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { ExpenseRepository } from '../../ports/expense-repository';
import { IdGenerator } from '../../ports/id-generator';
import { LoanRepository } from '../../ports/loan-repository';
import { toAmount } from '../expenses/expense-input';
import { toBorrowerName, toDueDate } from './loan-input';

/** Exactly one of `expenseId` (the amount comes from the expense) or `amountCents`. */
export interface CreateLoanInput {
  borrowerName: string;
  /** `YYYY-MM-DD`, a real calendar date from 2000-01-01 on; the past is allowed. */
  dueDate: string;
  expenseId?: string;
  amountCents?: number;
}

export class CreateLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly expenses: ExpenseRepository,
    private readonly ids: IdGenerator,
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
    if (expenseId === undefined) {
      amount = toAmount(amountCents);
    } else {
      if (typeof expenseId !== 'string' || expenseId.trim() === '') {
        throw new ValidationError('expenseId must be a non blank text');
      }
      // Scoped to the actor: someone else's expense looks exactly like a missing one.
      const expense = await this.expenses.findById(actor.id, expenseId);
      if (!expense) throw new NotFoundError('Expense not found');
      amount = expense.amount;
    }
    const loan = Loan.create({
      id: this.ids.next(),
      userId: actor.id,
      borrowerName,
      amount,
      dueDate,
      expenseId: expenseId ?? null,
    });
    // UNIQUE(expenseId) in the repository: two requests racing for one expense, one wins.
    await this.loans.save(loan);
    return { id: loan.id };
  }
}
