import { Loan } from '../../../domain/entities/loan';
import { NotFoundError, ValidationError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { Clock } from '../../ports/clock';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';
import { detailsOf, findOwnLoan, LoanDetails } from './get-loan';
import { toBorrowerName, toDueDate } from './loan-input';

/** Editable fields only: the amount, `expenseId` and `userId` are immutable and never read. */
export interface UpdateLoanInput {
  borrowerName?: string;
  dueDate?: string;
}

export class UpdateLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: UpdateLoanInput): Promise<LoanDetails> {
    const { borrowerName, dueDate } = input;
    if (borrowerName === undefined && dueDate === undefined) {
      throw new ValidationError('At least one field is required');
    }
    const name = borrowerName === undefined ? undefined : toBorrowerName(borrowerName);
    const date = dueDate === undefined ? undefined : toDueDate(dueDate);
    const current = await findOwnLoan(this.loans, actor, id);

    const updated = Loan.create({
      id: current.id,
      userId: current.userId,
      borrowerName: name ?? current.borrowerName,
      amount: current.amount,
      dueDate: date ?? current.dueDate,
      expenseId: current.expenseId,
      createdAt: current.createdAt,
    });
    // False means the loan vanished between the read and the write (concurrent delete).
    if (!(await this.loans.update(updated))) throw new NotFoundError('Loan not found');
    return detailsOf(this.payments, actor, updated, this.clock.now());
  }
}
