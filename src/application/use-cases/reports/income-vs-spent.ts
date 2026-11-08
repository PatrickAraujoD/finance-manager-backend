import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { IncomeRepository } from '../../ports/income-repository';
import { ReportRepository } from '../../ports/report-repository';
import { ratioBasisPoints, toPercentage } from './basis-points';

export interface IncomeVsSpentReport {
  month: string;
  /** `null` when no income is registered for the month. */
  incomeCents: number | null;
  spentCents: number;
  /** Income minus spent; negative when the actor spent more than they earned. */
  remainingCents: number | null;
  /** Spent over income with two decimals (may pass 100); `null` without income. */
  percentSpent: number | null;
}

/** The actor's own income against what they spent in a month. */
export class IncomeVsSpent {
  constructor(
    private readonly reports: ReportRepository,
    private readonly incomes: IncomeRepository,
  ) {}

  async execute(actor: Actor, month: string): Promise<IncomeVsSpentReport> {
    requireMonth(month);
    const [spent, income] = await Promise.all([
      this.reports.totalSpent(actor.id, month),
      this.incomes.find(actor.id, month),
    ]);
    if (!income) {
      return {
        month,
        incomeCents: null,
        spentCents: spent.cents,
        remainingCents: null,
        percentSpent: null,
      };
    }
    return {
      month,
      incomeCents: income.amount.cents,
      spentCents: spent.cents,
      remainingCents: income.amount.subtract(spent).cents,
      percentSpent: toPercentage(ratioBasisPoints(spent.cents, income.amount.cents)),
    };
  }
}
