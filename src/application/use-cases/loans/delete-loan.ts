import { ConflictError, NotFoundError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { LoanPaymentRepository } from '../../ports/loan-payment-repository';
import { LoanRepository } from '../../ports/loan-repository';

/**
 * Deletes a loan of the actor; its expense is untouched. Someone else's is a NotFoundError. A
 * loan with payments is a ConflictError: the payments are the user's financial history. The
 * database foreign key (Restrict) backs this up if a payment lands right after the check.
 */
export class DeleteLoan {
  constructor(
    private readonly loans: LoanRepository,
    private readonly payments: LoanPaymentRepository,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    // Scoped to the actor, so a foreign id has no payments and falls through to the NotFound.
    const paid = await this.payments.sumPaidByLoans(actor.id, [id]);
    if (paid.has(id)) throw new ConflictError('Loan has payments');
    if (!(await this.loans.delete(actor.id, id))) throw new NotFoundError('Loan not found');
  }
}
