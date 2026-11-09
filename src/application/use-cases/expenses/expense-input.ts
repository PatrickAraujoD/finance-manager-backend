import { parseCalendarDate } from '../../../domain/calendar-date';
import { Category } from '../../../domain/entities/category';
import { MAX_EXPENSE_CENTS } from '../../../domain/entities/expense';
import { NotFoundError, ValidationError } from '../../../domain/errors';
import { Money } from '../../../domain/money';
import { PaymentMethod, parsePaymentMethod } from '../../../domain/payment-method';
import { requireCleanText } from '../../../domain/validation';
import { Actor } from '../../actor';
import { CategoryRepository } from '../../ports/category-repository';
import { Clock } from '../../ports/clock';

/**
 * Newest accepted `spentAt`: today (UTC, from the Clock) plus this many days. One day of slack
 * covers users ahead of UTC (for example UTC+13) entering "today" before UTC reaches that date;
 * anything later is a typo, not a purchase.
 */
export const MAX_FUTURE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_EXPENSE_DESCRIPTION = 500;

/** The amount the USER confirmed: a safe integer number of cents in 1..MAX_EXPENSE_CENTS. */
export function toAmount(value: unknown): Money {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationError('amountCents must be an integer number of cents');
  }
  if (value < 1 || value > MAX_EXPENSE_CENTS) {
    throw new ValidationError(`amountCents must be between 1 and ${MAX_EXPENSE_CENTS}`);
  }
  return Money.fromCents(value);
}

export function toSpentAt(value: unknown, clock: Clock): Date {
  const date = parseCalendarDate(value as string, 'spentAt');
  const now = clock.now();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > today + MAX_FUTURE_DAYS * DAY_MS) {
    throw new ValidationError('spentAt cannot be in the future');
  }
  return date;
}

/** Trimmed text of at most 500 characters; blank means "no description" (undefined). */
export function toDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') throw new ValidationError('description must be text');
  requireCleanText(value, 'description', { kind: 'description' });
  const text = value.trim();
  if (text.length > MAX_EXPENSE_DESCRIPTION) {
    throw new ValidationError(
      `description must have at most ${MAX_EXPENSE_DESCRIPTION} characters`,
    );
  }
  return text === '' ? undefined : text;
}

export function toPaidAlone(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('paidAlone must be true or false');
  return value;
}

/** CREDIT, DEBIT or PIX; anything else, including a missing value, is a 400. */
export function toPaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== 'string') throw new ValidationError('paymentMethod must be CREDIT, DEBIT or PIX');
  return parsePaymentMethod(value);
}

/** A category the actor may use: global or their own. Anything else looks like a missing one. */
export async function requireVisibleCategory(
  categories: CategoryRepository,
  actor: Actor,
  id: unknown,
): Promise<Category> {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('categoryId is required');
  }
  const category = await categories.findById(id);
  if (!category || (!category.isGlobal() && category.ownerId !== actor.id)) {
    throw new NotFoundError('Category not found');
  }
  return category;
}
