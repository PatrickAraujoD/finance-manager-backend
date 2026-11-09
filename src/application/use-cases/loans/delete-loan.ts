import { NotFoundError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { LoanRepository } from '../../ports/loan-repository';

/** Deletes a loan of the actor; its expense is untouched. Someone else's is a NotFoundError. */
export class DeleteLoan {
  constructor(private readonly loans: LoanRepository) {}

  async execute(actor: Actor, id: string): Promise<void> {
    if (!(await this.loans.delete(actor.id, id))) throw new NotFoundError('Loan not found');
  }
}
