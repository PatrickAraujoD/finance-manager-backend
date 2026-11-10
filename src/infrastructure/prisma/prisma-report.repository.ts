import { Prisma } from '@prisma/client';
import {
  CategoryTotal,
  DayTotal,
  MonthTotal,
  ReportRepository,
  SplitTotal,
} from '../../application/ports/report-repository';
import { Money } from '../../domain/money';
import { PrismaService } from './prisma.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `[first day of the month, first day of the next month)` as `YYYY-MM-DD` strings, computed with
 * integer arithmetic (no `Date`, which maps years 0 to 99 to 1900 to 1999). They are bound as parameters and cast to DATE by the database: `spentAt` is a calendar
 * date, so no time zone is involved. Inputs are validated by the use cases.
 */
function monthWindow(fromMonth: string, toMonth: string): { start: string; end: string } {
  const [toYear, toMon] = [Number(toMonth.slice(0, 4)), Number(toMonth.slice(5, 7))];
  const [nextYear, nextMon] = toMon === 12 ? [toYear + 1, 1] : [toYear, toMon + 1];
  const end = `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}-01`;
  return { start: `${fromMonth}-01`, end };
}

// Never round or wrap: an unsafe sum is an error, not a wrong number on a chart.
function toMoney(total: bigint, what: string): Money {
  if (total > MAX_SAFE) throw new Error(`Sum of ${what} is not a safe integer amount of cents`);
  return Money.fromCents(Number(total));
}

function sum(rows: { total: bigint }[], what: string): Money[] {
  return rows.map((r) => toMoney(r.total, what));
}

// Every query filters by "userId" first and then by the half-open date range, so it uses the
// (userId, spentAt) index; aggregation (GROUP BY / SUM) happens in the database. Values are
// always bound parameters (Prisma.sql), never concatenated.
//
// The grouped reports skip card bill payments ("isCardPayment"): the credit purchases they pay
// were already counted when made, so counting the payment too would count the money twice.

export function categoryTotalsSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT c."id" AS "categoryId", c."name" AS "categoryName", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    JOIN "Category" c ON c."id" = e."categoryId"
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
      AND NOT e."isCardPayment"
    GROUP BY c."id", c."name"
    ORDER BY "total" DESC, c."name" ASC, c."id" ASC`;
}

export function dayTotalsSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT to_char(e."spentAt"::timestamp, 'YYYY-MM-DD') AS "date", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
      AND NOT e."isCardPayment"
    GROUP BY e."spentAt"
    ORDER BY e."spentAt" ASC`;
}

export function monthTotalsSql(userId: string, fromMonth: string, toMonth: string): Prisma.Sql {
  const { start, end } = monthWindow(fromMonth, toMonth);
  return Prisma.sql`
    SELECT to_char(e."spentAt"::timestamp, 'YYYY-MM') AS "month", SUM(e."amountCents")::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
      AND NOT e."isCardPayment"
    GROUP BY to_char(e."spentAt"::timestamp, 'YYYY-MM')
    ORDER BY "month" ASC`;
}

// Balance aggregates: one query each, never joined to categories. A credit purchase is an expense
// whose "paymentMethod" is CREDIT; a card bill payment is one flagged "isCardPayment" (and, by
// the domain rule, never paid with CREDIT).

export function accountOutflowSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(e."amountCents"), 0)::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
      AND e."paymentMethod" <> 'CREDIT'`;
}

export function creditSpentSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(e."amountCents"), 0)::bigint AS "total"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" >= ${start}::date AND e."spentAt" < ${end}::date
      AND e."paymentMethod" = 'CREDIT'`;
}

export function loanPaymentsReceivedSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(p."amountCents"), 0)::bigint AS "total"
    FROM "LoanPayment" p
    WHERE p."userId" = ${userId} AND p."paidAt" >= ${start}::date AND p."paidAt" < ${end}::date`;
}

// Everything up to the end of the month in one pass, split by FILTER at the month start.
export function cardChargesSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(e."amountCents") FILTER (WHERE e."spentAt" < ${start}::date), 0)::bigint AS "beforeMonth",
           COALESCE(SUM(e."amountCents") FILTER (WHERE e."spentAt" >= ${start}::date), 0)::bigint AS "inMonth"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" < ${end}::date AND e."paymentMethod" = 'CREDIT'`;
}

export function cardPaymentsSql(userId: string, month: string): Prisma.Sql {
  const { start, end } = monthWindow(month, month);
  return Prisma.sql`
    SELECT COALESCE(SUM(e."amountCents") FILTER (WHERE e."spentAt" < ${start}::date), 0)::bigint AS "beforeMonth",
           COALESCE(SUM(e."amountCents") FILTER (WHERE e."spentAt" >= ${start}::date), 0)::bigint AS "inMonth"
    FROM "Expense" e
    WHERE e."userId" = ${userId} AND e."spentAt" < ${end}::date AND e."isCardPayment"`;
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

  private async single(query: Prisma.Sql, what: string): Promise<Money> {
    const rows = await this.prisma.client.$queryRaw<{ total: bigint }[]>(query);
    return sum(rows, what)[0];
  }

  private async split(query: Prisma.Sql, what: string): Promise<SplitTotal> {
    const [row] = await this.prisma.client.$queryRaw<{ beforeMonth: bigint; inMonth: bigint }[]>(
      query,
    );
    return { beforeMonth: toMoney(row.beforeMonth, what), inMonth: toMoney(row.inMonth, what) };
  }

  accountOutflow(userId: string, month: string): Promise<Money> {
    return this.single(accountOutflowSql(userId, month), 'the account outflow');
  }

  creditSpent(userId: string, month: string): Promise<Money> {
    return this.single(creditSpentSql(userId, month), 'the credit purchases');
  }

  loanPaymentsReceived(userId: string, month: string): Promise<Money> {
    return this.single(loanPaymentsReceivedSql(userId, month), 'the loan payments');
  }

  cardCharges(userId: string, month: string): Promise<SplitTotal> {
    return this.split(cardChargesSql(userId, month), 'the card charges');
  }

  cardPayments(userId: string, month: string): Promise<SplitTotal> {
    return this.split(cardPaymentsSql(userId, month), 'the card payments');
  }
}
