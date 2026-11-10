import { computeCardBalance } from '../../../domain/card-balance';
import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { ReportRepository } from '../../ports/report-repository';

export interface CardBalanceReport {
  month: string;
  /** Owed at the start of the month. */
  openingCents: number;
  chargedCents: number;
  paidCents: number;
  /** Owed at the end of the month; negative when the bill was overpaid. */
  balanceCents: number;
}

/** What the actor owes on their credit card at the end of a month. Always scoped to `actor.id`. */
export class GetCardBalance {
  constructor(private readonly reports: ReportRepository) {}

  async execute(actor: Actor, month: string): Promise<CardBalanceReport> {
    requireMonth(month);
    const [charges, payments] = await Promise.all([
      this.reports.cardCharges(actor.id, month),
      this.reports.cardPayments(actor.id, month),
    ]);
    return {
      month,
      ...computeCardBalance({
        chargesBefore: [charges.beforeMonth],
        paymentsBefore: [payments.beforeMonth],
        chargesInMonth: [charges.inMonth],
        paymentsInMonth: [payments.inMonth],
      }),
    };
  }
}
