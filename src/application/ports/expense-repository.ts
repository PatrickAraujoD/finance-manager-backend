import { Expense } from '../../domain/entities/expense';

/** `from` and `to` are inclusive bounds on `spentAt`. */
export interface ExpenseFilter {
  from?: Date;
  to?: Date;
  categoryId?: string;
}

export interface ExpenseRepository {
  save(expense: Expense): Promise<void>;
  findById(id: string): Promise<Expense | null>;
  listByUser(userId: string, filter: ExpenseFilter): Promise<Expense[]>;
  delete(id: string): Promise<void>;
}
