import { ValidationError } from '../errors';
import { Money } from '../money';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthlyIncomeProps {
  userId: string;
  month: string;
  amount: Money;
}

export class MonthlyIncome {
  private constructor(private readonly props: MonthlyIncomeProps) {}

  static create(input: MonthlyIncomeProps): MonthlyIncome {
    if (!MONTH_PATTERN.test(input.month)) {
      throw new ValidationError('Month must be in YYYY-MM format');
    }
    if (input.amount.isNegative()) throw new ValidationError('Income cannot be negative');
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
