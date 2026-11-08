import { requireMonth } from '../../../domain/entities/monthly-income';
import { Actor } from '../../actor';
import { ReportRepository } from '../../ports/report-repository';

export interface DayReportItem {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  totalCents: number;
}

export interface DayReport {
  month: string;
  /** Only days with spending, by date ascending. */
  days: DayReportItem[];
  /** The day with the largest total (earliest date on a tie); `null` for an empty month. */
  topDay: DayReportItem | null;
}

/** What the actor spent on each day of a month. Always scoped to `actor.id`. */
export class ByDay {
  constructor(private readonly reports: ReportRepository) {}

  async execute(actor: Actor, month: string): Promise<DayReport> {
    requireMonth(month);
    const rows = await this.reports.totalsByDay(actor.id, month);
    const days = rows
      .map((r) => ({ date: r.date, totalCents: r.total.cents }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Days are ascending, so keeping the first maximum is the earliest-date tie break.
    let topDay: DayReportItem | null = null;
    for (const day of days) {
      if (topDay === null || day.totalCents > topDay.totalCents) topDay = { ...day };
    }
    return { month, days, topDay };
  }
}
