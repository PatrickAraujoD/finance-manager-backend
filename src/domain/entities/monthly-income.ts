import { ValidationError } from '../errors';
import { Money } from '../money';

import { requireNonBlank } from '../validation';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthlyIncomeProps {
  userId: string;
  month: string;
  amount: Money;
}

export class MonthlyIncome {
  private constructor(private readonly props: MonthlyIncomeProps) {}

  static create(input: MonthlyIncomeProps): MonthlyIncome {
    requireNonBlank(input.userId, 'userId');
    if (!MONTH_PATTERN.test(input.month)) {
      throw new ValidationError('Month must be in YYYY-MM format');
    }
    if (input.amount.cents <= 0) throw new ValidationError('Income must be positive');
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
