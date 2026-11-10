import { NotFoundError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { ExpenseRepository } from '../../ports/expense-repository';

/**
 * Deletes an expense of the actor. The receipt row and its stored file are NOT deleted: the
 * receipt only becomes free to back another expense. Someone else's expense is a NotFoundError;
 * an expense that already has a loan cannot be deleted (ConflictError from the repository).
 */
export class DeleteExpense {
  constructor(private readonly expenses: ExpenseRepository) {}

  async execute(actor: Actor, id: string): Promise<void> {
    if (!(await this.expenses.delete(actor.id, id))) throw new NotFoundError('Expense not found');
  }
}
