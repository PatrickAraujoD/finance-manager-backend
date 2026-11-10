import { computeAccountBalance } from '../../../domain/account-balance';
import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { IncomeRepository } from '../../ports/income-repository';
import { ReportRepository } from '../../ports/report-repository';

export interface IncomeVsSpentReport {
  month: string;
  /** `null` when no income is registered for the month. */
  incomeCents: number | null;
  /** What left the ACCOUNT: everything not paid with credit, card bill payments included. */
  spentCents: number;
  /** Loan payments received in the month. */
  receivedCents: number;
  /** Credit card purchases of the month; informative, they do not leave the account. */
  creditSpentCents: number;
  /** Income minus spent plus received; negative when more left than came in. */
  remainingCents: number | null;
  /** Spent over income with two decimals (may pass 100); `null` without income. */
  percentSpent: number | null;
}

/** The actor's own income against what left their account in a month. */
export class IncomeVsSpent {
  constructor(
    private readonly reports: ReportRepository,
    private readonly incomes: IncomeRepository,
  ) {}

  async execute(actor: Actor, month: string): Promise<IncomeVsSpentReport> {
    requireMonth(month);
    const [outflow, received, creditSpent, income] = await Promise.all([
      this.reports.accountOutflow(actor.id, month),
      this.reports.loanPaymentsReceived(actor.id, month),
      this.reports.creditSpent(actor.id, month),
      this.incomes.find(actor.id, month),
    ]);
    return {
      month,
      ...computeAccountBalance({
        income: income?.amount ?? null,
        outflows: [outflow],
        inflows: [received],
        creditPurchases: [creditSpent],
      }),
    };
  }
}
