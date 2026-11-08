import { ValidationError } from '../errors';
import { Money } from '../money';

import { requireNonBlank } from '../validation';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Largest accepted monthly income: R$ 1,000,000,000.00 (100,000,000,000 cents). Far above any real
 * salary yet far below Number.MAX_SAFE_INTEGER, so sums in reports can never overflow.
 */
export const MAX_INCOME_CENTS = 100_000_000_000;

/** Throws `ValidationError` unless `month` is a strict `YYYY-MM` (month 01 to 12). */
export function requireMonth(month: string): void {
  if (!MONTH_PATTERN.test(month)) throw new ValidationError('Month must be in YYYY-MM format');
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
