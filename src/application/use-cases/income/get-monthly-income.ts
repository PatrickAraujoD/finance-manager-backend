import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { IncomeRepository } from '../../ports/income-repository';
import { MonthlyIncomeView } from './set-monthly-income';

/** Reads the actor's own income for a month; `null` when none is registered. */
export class GetMonthlyIncome {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(actor: Actor, month: string): Promise<MonthlyIncomeView | null> {
    requireMonth(month);
    const income = await this.incomes.find(actor.id, month);
    return income ? { month: income.month, amountCents: income.amount.cents } : null;
  }
}
