import { Prisma } from '@prisma/client';
import {
  CategoryTotal,
  DayTotal,
  MonthTotal,
  ReportRepository,
} from '../../application/ports/report-repository';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `[first day of the month, first day of the next month)` as `YYYY-MM-DD` strings, computed in
 * UTC. They are bound as parameters and cast to DATE by the database: `spentAt` is a calendar
 * date, so no time zone is involved. Inputs are validated by the use cases.
 */
function monthWindow(fromMonth: string, toMonth: string): { start: string; end: string } {
  const [toYear, toMon] = [Number(toMonth.slice(0, 4)), Number(toMonth.slice(5, 7))];
  const next = new Date(Date.UTC(toYear, toMon, 1));
  return { start: `${fromMonth}-01`, end: next.toISOString().slice(0, 10) };
}

function sum(rows: { total: bigint }[], what: string): Money[] {
  return rows.map((r) => {
    // Never round or wrap: an unsafe sum is an error, not a wrong number on a chart.
    if (r.total > MAX_SAFE) throw new Error(`Sum of ${what} is not a safe integer amount of cents`);
    return Money.fromCents(Number(r.total));
  });
}

// Every query filters by "userId" first and then by the half-open date range, so it uses the
// (userId, spentAt) index; aggregation (GROUP BY / SUM) happens in the database. Values are
// always bound parameters (Prisma.sql), never concatenated.

export function categoryTotalsSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT c."id" AS "categoryId", c."name" AS "categoryName", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    JOIN "Category" c ON c."id" = e."categoryId"
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
    GROUP BY c."id", c."name"
    ORDER BY "total" DESC, c."name" ASC, c."id" ASC`;
}

export function dayTotalsSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT to_char(e."spentAt", 'YYYY-MM-DD') AS "date", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
    GROUP BY e."spentAt"
    ORDER BY e."spentAt" ASC`;
}

export function monthTotalsSql(userId: string, fromMonth: string, toMonth: string): Prisma.Sql {
  const { start, end } = monthWindow(fromMonth, toMonth);
  return Prisma.sql`
    SELECT to_char(e."spentAt", 'YYYY-MM') AS "month", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
    GROUP BY to_char(e."spentAt", 'YYYY-MM')
    ORDER BY "month" ASC`;
}

export function totalSpentSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(e."amountCents"), 0)::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date`;
}

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async totalsByCategory(userId: string, month: string): Promise<CategoryTotal[]> {
    const rows = await this.prisma.client.$queryRaw<
      { categoryId: string; categoryName: string; total: bigint }[]
    >(categoryTotalsSql(userId, month));
    const totals = sum(rows, 'a category');
    return rows.map((r, i) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      total: totals[i],
    }));
  }

  async totalsByDay(userId: string, month: string): Promise<DayTotal[]> {
    const rows = await this.prisma.client.$queryRaw<{ date: string; total: bigint }[]>(
      dayTotalsSql(userId, month),
    );
    const totals = sum(rows, 'a day');
    return rows.map((r, i) => ({ date: r.date, total: totals[i] }));
  }

  async totalsByMonth(userId: string, fromMonth: string, toMonth: string): Promise<MonthTotal[]> {
    const rows = await this.prisma.client.$queryRaw<{ month: string; total: bigint }[]>(
      monthTotalsSql(userId, fromMonth, toMonth),
    );
    const totals = sum(rows, 'a month');
    return rows.map((r, i) => ({ month: r.month, total: totals[i] }));
  }

  async totalSpent(userId: string, month: string): Promise<Money> {
    const rows = await this.prisma.client.$queryRaw<{ total: bigint }[]>(
      totalSpentSql(userId, month),
    );
    return sum(rows, 'the month')[0];
  }
}
