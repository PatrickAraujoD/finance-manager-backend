import { parseCalendarDate } from '../../../domain/calendar-date';
import { ValidationError } from '../../../domain/errors';
import { Clock } from '../../ports/clock';
import { toSpentAt } from '../expenses/expense-input';

/**
 * Oldest accepted `dueDate`. Past dates are allowed on purpose (the user may register an old
 * debt), but a year like 1901 is a typo, not a loan. 2000-01-01 is generous for a personal
 * finance app and keeps the date well inside every database and JS date range.
 */
export const MIN_DUE_DATE = '2000-01-01';

export function toBorrowerName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('borrowerName must be text');
  return value;
}

export function toDueDate(value: unknown): Date {
  const date = parseCalendarDate(value as string, 'dueDate');
  if (date.getTime() < Date.parse(`${MIN_DUE_DATE}T00:00:00Z`)) {
    throw new ValidationError(`dueDate cannot be before ${MIN_DUE_DATE}`);
  }
  return date;
}

/**
 * When the money changed hands: the same ceiling as an expense date (today + 1 day, UTC, from the
 * Clock) and the same floor as a due date. Past dates are fine, a late registration is normal.
 */
export function toPaidAt(value: unknown, clock: Clock): Date {
  const date = toSpentAt(value, clock, 'paidAt');
  if (date.getTime() < Date.parse(`${MIN_DUE_DATE}T00:00:00Z`)) {
    throw new ValidationError(`paidAt cannot be before ${MIN_DUE_DATE}`);
  }
  return date;
}
