import {
  categoryTotalsSql,
  dayTotalsSql,
  monthTotalsSql,
  PrismaReportRepository,
  totalSpentSql,
} from '../../src/infrastructure/prisma/prisma-report.repository';
import { ByCategory } from '../../src/application/use-cases/reports/by-category';
import { ByDay } from '../../src/application/use-cases/reports/by-day';
import { MonthlyEvolution } from '../../src/application/use-cases/reports/monthly-evolution';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

let seq = 0;

describe('PrismaReportRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaReportRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaReportRepository(prisma);
  });
  afterAll(() => prisma.disconnect());
  beforeEach(async () => {
    seq = 0;
    await cleanDatabase(prisma);
    for (const id of ['ana', 'bob', 'admin']) {
      await prisma.client.user.create({
        data: {
          id,
          name: id,
          email: `${id}@x.com`,
          passwordHash: 'h',
          role: id === 'admin' ? 'A' : 'N',
        },
      });
    }
    await prisma.client.category.create({ data: { id: 'c-food', name: 'Food', nameKey: 'food' } });
    await prisma.client.category.create({ data: { id: 'c-bus', name: 'Bus', nameKey: 'bus' } });
    await prisma.client.category.create({
      data: { id: 'c-ana', name: 'Casa', nameKey: 'casa', ownerId: 'ana' },
    });
    await prisma.client.category.create({
      data: { id: 'c-bob', name: 'Lazer', nameKey: 'lazer', ownerId: 'bob' },
    });
  });

  async function spend(userId: string, categoryId: string, cents: number, date: string) {
    await prisma.client.$executeRaw`
      INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","spentAt")
      VALUES (${`e${++seq}`}, ${userId}, ${categoryId}, ${cents}, true, 'PIX', ${date}::date)`;
  }

  const cents = (rows: { total: { cents: number } }[]) => rows.map((r) => r.total.cents);

  describe('empty data', () => {
    it('returns empty lists and zero for a month without spending', async () => {
      expect(await repo.totalsByCategory('ana', '2026-11')).toEqual([]);
      expect(await repo.totalsByDay('ana', '2026-11')).toEqual([]);
      expect(await repo.totalsByMonth('ana', '2026-01', '2026-12')).toEqual([]);
      expect((await repo.totalSpent('ana', '2026-11')).cents).toBe(0);
    });
  });

  describe('grouping', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 1000, '2026-11-01');
      await spend('ana', 'c-food', 500, '2026-11-01');
      await spend('ana', 'c-bus', 250, '2026-11-02');
      await spend('ana', 'c-ana', 4000, '2026-11-15');
      await spend('ana', 'c-food', 70, '2026-10-20');
    });

    it('sums by category with the right names (global and own)', async () => {
      const rows = await repo.totalsByCategory('ana', '2026-11');
      expect(rows.map((r) => [r.categoryId, r.categoryName, r.total.cents])).toEqual([
        ['c-ana', 'Casa', 4000],
        ['c-food', 'Food', 1500],
        ['c-bus', 'Bus', 250],
      ]);
    });

    it('sums by day, only days with spending, ascending', async () => {
      const rows = await repo.totalsByDay('ana', '2026-11');
      expect(rows.map((r) => [r.date, r.total.cents])).toEqual([
        ['2026-11-01', 1500],
        ['2026-11-02', 250],
        ['2026-11-15', 4000],
      ]);
    });

    it('sums by month, only months with spending, ascending', async () => {
      const rows = await repo.totalsByMonth('ana', '2026-10', '2026-11');
      expect(rows.map((r) => [r.month, r.total.cents])).toEqual([
        ['2026-10', 70],
        ['2026-11', 5750],
      ]);
    });

    it('the total spent equals the sum of days, of categories and of the month row', async () => {
      const total = (await repo.totalSpent('ana', '2026-11')).cents;
      expect(total).toBe(5750);
      expect(cents(await repo.totalsByDay('ana', '2026-11')).reduce((a, b) => a + b)).toBe(total);
      expect(cents(await repo.totalsByCategory('ana', '2026-11')).reduce((a, b) => a + b)).toBe(
        total,
      );
      expect((await repo.totalsByMonth('ana', '2026-11', '2026-11'))[0].total.cents).toBe(total);
    });
  });

  describe('month boundaries (UTC calendar dates)', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 1, '2026-02-28');
      await spend('ana', 'c-food', 2, '2026-03-01');
      await spend('ana', 'c-food', 4, '2026-03-31');
      await spend('ana', 'c-food', 8, '2026-04-01');
      await spend('ana', 'c-food', 16, '2026-04-30');
      await spend('ana', 'c-food', 32, '2026-05-01');
    });

    it('counts 03-31 in March and not in April, and 04-01 in April and not in March', async () => {
      expect((await repo.totalSpent('ana', '2026-03')).cents).toBe(6);
      expect((await repo.totalSpent('ana', '2026-04')).cents).toBe(24);
      const march = await repo.totalsByDay('ana', '2026-03');
      expect(march.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-31']);
      const april = await repo.totalsByDay('ana', '2026-04');
      expect(april.map((d) => d.date)).toEqual(['2026-04-01', '2026-04-30']);
      expect((await repo.totalsByCategory('ana', '2026-04'))[0].total.cents).toBe(24);
    });

    it('monthly totals are inclusive on both ends and exclude the neighbours', async () => {
      const rows = await repo.totalsByMonth('ana', '2026-03', '2026-04');
      expect(rows.map((r) => [r.month, r.total.cents])).toEqual([
        ['2026-03', 6],
        ['2026-04', 24],
      ]);
    });

    it('handles a leap February (2028-02-29) and a non leap one', async () => {
      await spend('ana', 'c-food', 100, '2028-02-29');
      await spend('ana', 'c-food', 200, '2028-03-01');
      await spend('ana', 'c-food', 300, '2028-01-31');
      expect((await repo.totalsByDay('ana', '2028-02')).map((d) => [d.date, d.total.cents])).toEqual(
        [['2028-02-29', 100]],
      );
      expect((await repo.totalSpent('ana', '2028-02')).cents).toBe(100);
      expect((await repo.totalSpent('ana', '2028-03')).cents).toBe(200);
      await spend('ana', 'c-food', 7, '2026-02-28');
      expect((await repo.totalSpent('ana', '2026-02')).cents).toBe(8);
    });

    it('crosses the year boundary (2025-11 to 2026-02)', async () => {
      await spend('ana', 'c-food', 10, '2025-11-30');
      await spend('ana', 'c-food', 20, '2025-12-31');
      await spend('ana', 'c-food', 40, '2026-01-01');
      await spend('ana', 'c-food', 80, '2025-10-31');
      const rows = await repo.totalsByMonth('ana', '2025-11', '2026-02');
      expect(rows.map((r) => [r.month, r.total.cents])).toEqual([
        ['2025-11', 10],
        ['2025-12', 20],
        ['2026-01', 40],
        ['2026-02', 1],
      ]);
      const evolution = await new MonthlyEvolution(repo).execute(
        { id: 'ana', role: 'N' },
        { from: '2025-11', to: '2026-02' },
      );
      expect(evolution.months.map((m) => m.totalCents)).toEqual([10, 20, 40, 1]);
    });

    it('handles December to January in the by-day and total queries', async () => {
      await spend('ana', 'c-food', 5, '2026-12-31');
      await spend('ana', 'c-food', 9, '2027-01-01');
      expect((await repo.totalSpent('ana', '2026-12')).cents).toBe(5);
      expect((await repo.totalSpent('ana', '2027-01')).cents).toBe(9);
    });
  });

  describe('month window at the edges of the supported years', () => {
    it('month 0050-01 is year 50, not 1950: a 1949 expense is not included', async () => {
      await spend('ana', 'c-food', 7, '1949-05-05');
      expect((await repo.totalSpent('ana', '0050-01')).cents).toBe(0);
      expect(await repo.totalsByCategory('ana', '0050-01')).toEqual([]);
      expect(await repo.totalsByDay('ana', '0050-01')).toEqual([]);
      expect(await repo.totalsByMonth('ana', '0050-01', '0050-01')).toEqual([]);
      expect((await repo.totalSpent('ana', '1949-05')).cents).toBe(7);
    });

    it('works at the first and last accepted months (no 500)', async () => {
      await spend('ana', 'c-food', 3, '1900-01-01');
      await spend('ana', 'c-food', 4, '9998-12-31');
      expect((await repo.totalSpent('ana', '1900-01')).cents).toBe(3);
      expect((await repo.totalSpent('ana', '9998-12')).cents).toBe(4);
      expect(cents(await repo.totalsByDay('ana', '9998-12'))).toEqual([4]);
      expect(cents(await repo.totalsByCategory('ana', '1900-01'))).toEqual([3]);
      expect(cents(await repo.totalsByMonth('ana', '1900-01', '9998-12'))).toEqual([3, 4]);
    });
  });

  describe('session time zone', () => {
    it('gives the same dates and months under a far-east session time zone', async () => {
      await spend('ana', 'c-food', 1, '2026-03-31');
      await spend('ana', 'c-food', 2, '2026-04-01');
      const run = (zone: string) =>
        prisma.client.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
          const days = await tx.$queryRaw<{ date: string }[]>(dayTotalsSql('ana', '2026-04'));
          const months = await tx.$queryRaw<{ month: string }[]>(
            monthTotalsSql('ana', '2026-03', '2026-04'),
          );
          return [days.map((d) => d.date), months.map((m) => m.month)];
        });
      const baseline = await run('UTC');
      expect(baseline).toEqual([['2026-04-01'], ['2026-03', '2026-04']]);
      expect(await run('Pacific/Apia')).toEqual(baseline);
      expect(await run('Pacific/Pago_Pago')).toEqual(baseline);
    });
  });

  describe('isolation between users', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 100, '2026-11-05');
      await spend('ana', 'c-ana', 200, '2026-11-06');
      await spend('bob', 'c-food', 900, '2026-11-05');
      await spend('bob', 'c-bob', 800, '2026-11-07');
    });

    it('never mixes the totals of other users, in any of the four reports', async () => {
      expect((await repo.totalSpent('ana', '2026-11')).cents).toBe(300);
      expect((await repo.totalSpent('bob', '2026-11')).cents).toBe(1700);
      expect(cents(await repo.totalsByDay('ana', '2026-11'))).toEqual([100, 200]);
      expect((await repo.totalsByCategory('ana', '2026-11')).map((r) => r.categoryId)).toEqual([
        'c-ana',
        'c-food',
      ]);
      expect(cents(await repo.totalsByMonth('ana', '2026-01', '2026-12'))).toEqual([300]);
    });

    it('an admin with no spending of their own sees nothing of others', async () => {
      expect((await repo.totalSpent('admin', '2026-11')).cents).toBe(0);
      expect(await repo.totalsByCategory('admin', '2026-11')).toEqual([]);
      expect(await repo.totalsByDay('admin', '2026-11')).toEqual([]);
      expect(await repo.totalsByMonth('admin', '2026-01', '2026-12')).toEqual([]);
    });

    it('an unknown user id gets empty reports', async () => {
      expect((await repo.totalSpent('nobody', '2026-11')).cents).toBe(0);
    });

    it('treats a hostile user id as a plain value, never as SQL', async () => {
      const evil = `ana' OR '1'='1`;
      expect((await repo.totalSpent(evil, '2026-11')).cents).toBe(0);
      expect(await repo.totalsByDay(`x'; DROP TABLE "Expense"; --`, '2026-11')).toEqual([]);
      expect((await repo.totalSpent('ana', '2026-11')).cents).toBe(300);
    });
  });

  describe('the four reports agree for the same month', () => {
    it('days = categories = spent = total, through the use cases', async () => {
      for (let day = 1; day <= 28; day++) {
        await spend('ana', day % 2 ? 'c-food' : 'c-bus', 100 + day * 7, `2026-02-${String(day).padStart(2, '0')}`);
      }
      const actor = { id: 'ana', role: 'N' as const };
      const days = await new ByDay(repo).execute(actor, '2026-02');
      const cats = await new ByCategory(repo).execute(actor, '2026-02');
      const spent = (await repo.totalSpent('ana', '2026-02')).cents;
      const daySum = days.days.reduce((s, d) => s + d.totalCents, 0);
      const catSum = cats.items.reduce((s, c) => s + c.totalCents, 0);
      expect(daySum).toBe(spent);
      expect(catSum).toBe(spent);
      expect(cats.totalCents).toBe(spent);
      expect(cats.items.reduce((s, c) => s + Math.round(c.percentage * 100), 0)).toBe(10000);
    });
  });

  describe('money precision', () => {
    it('adds many maximum expenses exactly', async () => {
      await prisma.client.$executeRaw`
        INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","spentAt")
        SELECT 'max' || g, 'ana', 'c-food', 1000000000, true, 'PIX', '2026-11-01'::date
        FROM generate_series(1, 5000) g`;
      expect((await repo.totalSpent('ana', '2026-11')).cents).toBe(5_000_000_000_000);
      expect((await repo.totalsByDay('ana', '2026-11'))[0].total.cents).toBe(5_000_000_000_000);
      expect((await repo.totalsByCategory('ana', '2026-11'))[0].total.cents).toBe(
        5_000_000_000_000,
      );
      expect((await repo.totalsByMonth('ana', '2026-11', '2026-11'))[0].total.cents).toBe(
        5_000_000_000_000,
      );
    });

    it('fails loudly, never silently, when a sum passes the safe integer range', async () => {
      // Only reachable behind the domain and the CHECK: lift the ceiling for these rows.
      await prisma.client.$executeRawUnsafe(
        'ALTER TABLE "Expense" DROP CONSTRAINT "Expense_amountCents_max"',
      );
      try {
        await spend('ana', 'c-food', Number.MAX_SAFE_INTEGER, '2026-11-01');
        await spend('ana', 'c-food', Number.MAX_SAFE_INTEGER, '2026-11-01');
        await expect(repo.totalSpent('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByDay('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByCategory('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByMonth('ana', '2026-11', '2026-11')).rejects.toThrow(
          /safe integer/,
        );
        // Another user's reports keep working.
        expect((await repo.totalSpent('bob', '2026-11')).cents).toBe(0);
      } finally {
        await prisma.client.$executeRawUnsafe(`DELETE FROM "Expense"`);
        await prisma.client.$executeRawUnsafe(
          'ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amountCents_max" CHECK ("amountCents" <= 1000000000)',
        );
      }
    });
  });

  describe('performance with 3 users and 10,000 expenses', () => {
    beforeEach(async () => {
      await prisma.client.$executeRaw`
        INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","spentAt")
        SELECT 'p' || g,
               (ARRAY['ana','bob','admin'])[1 + (g % 3)],
               (ARRAY['c-food','c-bus'])[1 + (g % 2)],
               100 + (g % 5000),
               true,
               'PIX',
               DATE '2025-01-01' + (g % 700)
        FROM generate_series(1, 10000) g`;
      await prisma.client.$executeRawUnsafe('ANALYZE "Expense"');
    });

    it('answers every report quickly and consistently', async () => {
      const started = Date.now();
      const month = '2025-06';
      const [byCat, byDay, byMonth, total] = await Promise.all([
        repo.totalsByCategory('ana', month),
        repo.totalsByDay('ana', month),
        repo.totalsByMonth('ana', '2025-01', '2026-12'),
        repo.totalSpent('ana', month),
      ]);
      expect(Date.now() - started).toBeLessThan(2000);
      const expected = await prisma.client.$queryRaw<{ sum: bigint }[]>`
        SELECT SUM("amountCents")::bigint AS sum FROM "Expense"
        WHERE "userId" = 'ana' AND to_char("spentAt",'YYYY-MM') = ${month}`;
      expect(total.cents).toBe(Number(expected[0].sum));
      expect(cents(byCat).reduce((a, b) => a + b)).toBe(total.cents);
      expect(cents(byDay).reduce((a, b) => a + b)).toBe(total.cents);
      expect(byMonth.find((m) => m.month === month)?.total.cents).toBe(total.cents);
    });

    it.each([
      ['category', () => categoryTotalsSql('ana', '2025-06')],
      ['day', () => dayTotalsSql('ana', '2025-06')],
      ['month', () => monthTotalsSql('ana', '2025-01', '2025-06')],
      ['total', () => totalSpentSql('ana', '2025-06')],
    ])('the %s query can use the (userId, spentAt) index', async (_name, build) => {
      const sql = build();
      const plan = await prisma.client.$transaction(async (tx) => {
        // Tiny tables favour a sequential scan; disable it to prove the index is usable.
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRawUnsafe<Record<string, string>[]>(
          `EXPLAIN ${sql.text}`,
          ...sql.values,
        );
        return rows.map((r) => Object.values(r)[0]).join('\n');
      });
      expect(plan).toContain('Expense_userId_spentAt_idx');
    });
  });
});
