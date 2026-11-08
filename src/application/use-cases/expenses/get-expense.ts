import { Expense } from '../../../domain/entities/expense';
import { NotFoundError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { ExpenseRepository } from '../../ports/expense-repository';

/** Loads an expense of the actor. Someone else's (admins included) looks exactly like a missing one. */
export async function findOwnExpense(
  expenses: ExpenseRepository,
  actor: Actor,
  id: string,
): Promise<Expense> {
  const expense = await expenses.findById(actor.id, id);
  if (!expense) throw new NotFoundError('Expense not found');
  return expense;
}

export class GetExpense {
  constructor(private readonly expenses: ExpenseRepository) {}

  execute(actor: Actor, id: string): Promise<Expense> {
    return findOwnExpense(this.expenses, actor, id);
  }
}
