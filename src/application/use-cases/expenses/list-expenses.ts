import { parseCalendarDate } from '../../../domain/calendar-date';
import { Expense } from '../../../domain/entities/expense';
import { ValidationError } from '../../../domain/errors';
import { PaymentMethod } from '../../../domain/payment-method';
import { Actor } from '../../actor';
import { ExpenseFilter, ExpenseRepository } from '../../ports/expense-repository';
import { toPaymentMethod } from './expense-input';

export const DEFAULT_EXPENSE_PAGE = 100;
export const MAX_EXPENSE_PAGE = 200;
/** Deep offsets are slow in SQL; a hard ceiling keeps one request cheap. Filter by date instead. */
export const MAX_EXPENSE_OFFSET = 100_000;

export interface ListExpensesInput {
  /** Inclusive `YYYY-MM-DD` bounds on `spentAt`. */
  from?: string;
  to?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  limit?: number;
  offset?: number;
}

export interface ExpensePageResult {
  items: Expense[];
  /** Count of ALL matches of the filter, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
}

export function toInt(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Lists the actor's own expenses (admins see no one else's), newest first. */
export class ListExpenses {
  constructor(private readonly expenses: ExpenseRepository) {}

  async execute(actor: Actor, input: ListExpensesInput): Promise<ExpensePageResult> {
    const filter: ExpenseFilter = {};
    if (input.from !== undefined) filter.from = parseCalendarDate(input.from, 'from');
    if (input.to !== undefined) filter.to = parseCalendarDate(input.to, 'to');
    if (filter.from && filter.to && filter.from.getTime() > filter.to.getTime()) {
      throw new ValidationError('from must not be after to');
    }
    if (input.categoryId !== undefined) {
      if (typeof input.categoryId !== 'string' || input.categoryId.trim() === '') {
        throw new ValidationError('categoryId must be a non blank text');
      }
      filter.categoryId = input.categoryId;
    }
    if (input.paymentMethod !== undefined) filter.paymentMethod = toPaymentMethod(input.paymentMethod);
    const limit = toInt(input.limit, 'limit', 1, MAX_EXPENSE_PAGE, DEFAULT_EXPENSE_PAGE);
    const offset = toInt(input.offset, 'offset', 0, MAX_EXPENSE_OFFSET, 0);
    const [items, total] = await Promise.all([
      this.expenses.listByUser(actor.id, filter, { limit, offset }),
      this.expenses.countByUser(actor.id, filter),
    ]);
    return { items, total, limit, offset };
  }
}
