import { ValidationError } from '../../../domain/errors';
import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { ReportRepository } from '../../ports/report-repository';

/** Longest range (inclusive) one evolution report may cover. */
export const MAX_EVOLUTION_MONTHS = 24;

export interface MonthReportItem {
  month: string;
  totalCents: number;
}

export interface EvolutionReport {
  from: string;
  to: string;
  /** Every month from `from` to `to`; months without spending are zero. */
  months: MonthReportItem[];
}

function index(month: string): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function label(i: number): string {
  const year = String(Math.floor(i / 12)).padStart(4, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Month-by-month spending of the actor over a range. Always scoped to `actor.id`. */
export class MonthlyEvolution {
  constructor(private readonly reports: ReportRepository) {}

  async execute(actor: Actor, range: { from: string; to: string }): Promise<EvolutionReport> {
    const { from, to } = range;
    requireMonth(from);
    requireMonth(to);
    const first = index(from);
    const last = index(to);
    if (first > last) throw new ValidationError('from must not be after to');
    if (last - first + 1 > MAX_EVOLUTION_MONTHS) {
      throw new ValidationError(`The range must cover at most ${MAX_EVOLUTION_MONTHS} months`);
    }
    const totals = new Map<string, number>();
    for (const row of await this.reports.totalsByMonth(actor.id, from, to)) {
      totals.set(row.month, row.total.cents);
    }
    const months: MonthReportItem[] = [];
    for (let i = first; i <= last; i++) {
      months.push({ month: label(i), totalCents: totals.get(label(i)) ?? 0 });
    }
    return { from, to, months };
  }
}
