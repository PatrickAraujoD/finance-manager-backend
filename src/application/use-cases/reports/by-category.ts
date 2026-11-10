import { requireMonth } from '../../../domain/entities/monthly-income';
import { Money } from '../../../domain/money';
import { Actor } from '../../actor';
import { ReportRepository } from '../../ports/report-repository';
import { shareBasisPoints, toPercentage } from '../../../domain/basis-points';

export interface CategoryReportItem {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  /** Two decimals; the items always sum to exactly 100. */
  percentage: number;
}

export interface CategoryReport {
  month: string;
  totalCents: number;
  items: CategoryReportItem[];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Where the actor's money went in a month. Always scoped to `actor.id`. */
export class ByCategory {
  constructor(private readonly reports: ReportRepository) {}

  async execute(actor: Actor, month: string): Promise<CategoryReport> {
    requireMonth(month);
    const rows = (await this.reports.totalsByCategory(actor.id, month)).sort(
      (a, b) =>
        b.total.cents - a.total.cents ||
        compare(a.categoryName, b.categoryName) ||
        compare(a.categoryId, b.categoryId),
    );
    const total = rows.reduce((sum, r) => sum.add(r.total), Money.fromCents(0));
    const shares = shareBasisPoints(rows.map((r) => r.total.cents));
    return {
      month,
      totalCents: total.cents,
      items: rows.map((r, i) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        totalCents: r.total.cents,
        percentage: toPercentage(shares[i]),
      })),
    };
  }
}
