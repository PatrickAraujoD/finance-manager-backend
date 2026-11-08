import { formatCalendarDate } from '../../domain/calendar-date';
import { Category } from '../../domain/entities/category';
import { Expense } from '../../domain/entities/expense';
import { User } from '../../domain/entities/user';
import { Role } from '../../domain/role';

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Date | null;
}

/** Explicit field list: the password hash (or anything added to User later) never reaches a response. */
export function toUserView(user: User): UserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email.value,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export interface CategoryView {
  id: string;
  name: string;
  global: boolean;
}

export function toCategoryView(category: Category): CategoryView {
  return { id: category.id, name: category.name, global: category.isGlobal() };
}

export interface ExpenseView {
  id: string;
  categoryId: string;
  receiptId: string | null;
  amountCents: number;
  paidAlone: boolean;
  /** Calendar date, `YYYY-MM-DD`. */
  spentAt: string;
  description: string | null;
  createdAt: Date | null;
}

/** Explicit field list: `userId` and anything added to Expense later never reach a response. */
export function toExpenseView(expense: Expense): ExpenseView {
  return {
    id: expense.id,
    categoryId: expense.categoryId,
    receiptId: expense.receiptId,
    amountCents: expense.amount.cents,
    paidAlone: expense.paidAlone,
    spentAt: formatCalendarDate(expense.spentAt),
    description: expense.description ?? null,
    createdAt: expense.createdAt,
  };
}
