import { ValidationError } from '../errors';
import { Money } from '../money';

import { requireNonBlank } from '../validation';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Same lower bound as `parseCalendarDate`; 9999 is excluded so "the next month" still exists. */
export const MIN_MONTH_YEAR = 1900;
export const MAX_MONTH_YEAR = 9998;

/** True for a strict `YYYY-MM` (month 01 to 12) with a year in 1900..9998. */
export function isValidMonth(month: unknown): month is string {
  if (typeof month !== 'string') return false;
  const match = MONTH_PATTERN.exec(month);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_MONTH_YEAR && year <= MAX_MONTH_YEAR;
}

/**
 * Largest accepted monthly income: R$ 1,000,000,000.00 (100,000,000,000 cents). Far above any real
 * salary yet far below Number.MAX_SAFE_INTEGER, so sums in reports can never overflow.
 */
export const MAX_INCOME_CENTS = 100_000_000_000;

/** Throws `ValidationError` unless `month` is a strict `YYYY-MM` (month 01 to 12, year 1900 to 9998). */
export function requireMonth(month: string): void {
  if (!isValidMonth(month)) {
    throw new ValidationError(
      `Month must be in YYYY-MM format with a year from ${MIN_MONTH_YEAR} to ${MAX_MONTH_YEAR}`,
    );
  }
}

export interface MonthlyIncomeProps {
  userId: string;
  month: string;
  amount: Money;
}

export class MonthlyIncome {
  private constructor(private readonly props: MonthlyIncomeProps) {}

  static create(input: MonthlyIncomeProps): MonthlyIncome {
    requireNonBlank(input.userId, 'userId');
    requireMonth(input.month);
    if (input.amount.cents <= 0) throw new ValidationError('Income must be positive');
    if (input.amount.cents > MAX_INCOME_CENTS) {
      throw new ValidationError(`Income must be at most ${MAX_INCOME_CENTS} cents`);
    }
    return new MonthlyIncome({ ...input });
  }

  get userId(): string {
    return this.props.userId;
  }
  get month(): string {
    return this.props.month;
  }
  get amount(): Money {
    return this.props.amount;
  }
}
