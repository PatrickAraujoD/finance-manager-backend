import { MonthlyIncome } from '../../../domain/entities/monthly-income';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { IncomeRepository } from '../../ports/income-repository';

export interface MonthlyIncomeView {
  month: string;
  amountCents: number;
}

/** Sets (upsert) the actor's own income for a month. There is no way to target another user. */
export class SetMonthlyIncome {
  constructor(private readonly incomes: IncomeRepository) {}

  async execute(
    actor: Actor,
    input: { month: string; amountCents: number },
  ): Promise<MonthlyIncomeView> {
    const income = MonthlyIncome.create({
      userId: actor.id,
      month: input.month,
      amount: Money.fromCents(input.amountCents),
    });
    await this.incomes.upsert(income);
    return { month: income.month, amountCents: income.amount.cents };
  }
}
