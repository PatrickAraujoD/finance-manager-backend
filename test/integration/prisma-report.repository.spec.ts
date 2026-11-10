import {
  accountOutflowSql,
  cardChargesSql,
  cardPaymentsSql,
  categoryTotalsSql,
  creditSpentSql,
  dayTotalsSql,
  monthTotalsSql,
  PrismaReportRepository,
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

  async function spend(
    userId: string,
    categoryId: string,
    cents: number,
    date: string,
    how: { method?: 'CREDIT' | 'DEBIT' | 'PIX' | 'CASH'; isCardPayment?: boolean } = {},
  ) {
    await prisma.client.$executeRaw`
      INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","isCardPayment","spentAt")
      VALUES (${`e${++seq}`}, ${userId}, ${categoryId}, ${cents}, true, ${how.method ?? 'PIX'}::"PaymentMethod",
        ${how.isCardPayment ?? false}, ${date}::date)`;
  }

  /** Money lent directly (no expense); or, with `fromExpense`, a loan born from that expense. */
  async function lendDirect(
    userId: string,
    cents: number,
    how: { method: 'CREDIT' | 'DEBIT' | 'PIX' | 'CASH'; lentAt: string } | { fromExpense: string },
  ) {
    const id = `l${++seq}`;
    if ('fromExpense' in how) {
      await prisma.client.$executeRaw`
        INSERT INTO "Loan" ("id","userId","borrowerName","amountCents","dueDate","expenseId")
        VALUES (${id}, ${userId}, 'Carlos', ${cents}, '2099-01-01'::date, ${how.fromExpense})`;
      return;
    }
    await prisma.client.$executeRaw`
      INSERT INTO "Loan" ("id","userId","borrowerName","amountCents","dueDate","paymentMethod","lentAt")
      VALUES (${id}, ${userId}, 'Carlos', ${cents}, '2099-01-01'::date, ${how.method}::"PaymentMethod",
        ${how.lentAt}::date)`;
  }

  const cents = (rows: { total: { cents: number } }[]) => rows.map((r) => r.total.cents);

  describe('empty data', () => {
    it('returns empty lists and zero for a month without spending', async () => {
      expect(await repo.totalsByCategory('ana', '2026-11')).toEqual([]);
      expect(await repo.totalsByDay('ana', '2026-11')).toEqual([]);
      expect(await repo.totalsByMonth('ana', '2026-01', '2026-12')).toEqual([]);
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(0);
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
      const total = (await repo.accountOutflow('ana', '2026-11')).cents;
      expect(total).toBe(5750);
      expect(cents(await repo.totalsByDay('ana', '2026-11')).reduce((a, b) => a + b)).toBe(total);
      expect(cents(await repo.totalsByCategory('ana', '2026-11')).reduce((a, b) => a + b)).toBe(
        total,
      );
      expect((await repo.totalsByMonth('ana', '2026-11', '2026-11'))[0].total.cents).toBe(total);
    });
  });

  describe('card bill payments', () => {
    // A 1000 credit purchase is counted when it is made; paying the bill (Pix, 1000) must not
    // count it again in the grouped reports.
    beforeEach(async () => {
      await spend('ana', 'c-food', 1000, '2026-11-02', { method: 'CREDIT' });
      await spend('ana', 'c-bus', 1000, '2026-11-10', { isCardPayment: true });
      await spend('ana', 'c-bus', 300, '2026-11-11', { method: 'CASH' });
      await spend('ana', 'c-food', 1000, '2026-10-10', { isCardPayment: true });
      await spend('bob', 'c-food', 1000, '2026-11-10', { isCardPayment: true });
    });

    it('by category counts the credit purchase and ignores the bill payment', async () => {
      const rows = await repo.totalsByCategory('ana', '2026-11');
      expect(rows.map((r) => [r.categoryId, r.total.cents])).toEqual([
        ['c-food', 1000],
        ['c-bus', 300],
      ]);
    });

    it('by day ignores the day that only has a bill payment', async () => {
      const rows = await repo.totalsByDay('ana', '2026-11');
      expect(rows.map((r) => [r.date, r.total.cents])).toEqual([
        ['2026-11-02', 1000],
        ['2026-11-11', 300],
      ]);
    });

    it('monthly evolution ignores the bill payments of every month', async () => {
      const rows = await repo.totalsByMonth('ana', '2026-10', '2026-11');
      expect(rows.map((r) => [r.month, r.total.cents])).toEqual([['2026-11', 1300]]);
      expect(await repo.totalsByMonth('bob', '2026-10', '2026-11')).toEqual([]);
    });

    it('the three grouped reports agree on the month total', async () => {
      const byCategory = cents(await repo.totalsByCategory('ana', '2026-11')).reduce((a, b) => a + b);
      const byDay = cents(await repo.totalsByDay('ana', '2026-11')).reduce((a, b) => a + b);
      const byMonth = (await repo.totalsByMonth('ana', '2026-11', '2026-11'))[0].total.cents;
      expect([byCategory, byDay, byMonth]).toEqual([1300, 1300, 1300]);
    });

    it('the account outflow counts the bill payment and leaves the credit purchase out', async () => {
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(1300);
      expect((await repo.creditSpent('ana', '2026-11')).cents).toBe(1000);
    });
  });

  async function lend(id: string, userId: string) {
    await prisma.client.loan.create({
      data: {
        id,
        userId,
        borrowerName: 'Devedor',
        amountCents: BigInt(1_000_000),
        dueDate: new Date('2027-12-31T00:00:00Z'),
      },
    });
  }

  async function receive(id: string, loanId: string, userId: string, cents: number, date: string) {
    await prisma.client.loanPayment.create({
      data: {
        id,
        loanId,
        userId,
        amountCents: BigInt(cents),
        method: 'CASH',
        paidAt: new Date(`${date}T00:00:00Z`),
      },
    });
  }

  describe('account outflow (everything but credit, bill payments included)', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 10, '2026-11-01', { method: 'PIX' });
      await spend('ana', 'c-food', 20, '2026-11-30', { method: 'DEBIT' });
      await spend('ana', 'c-food', 40, '2026-11-15', { method: 'CASH' });
      await spend('ana', 'c-bus', 100, '2026-11-10', { method: 'PIX', isCardPayment: true });
      await spend('ana', 'c-food', 1000, '2026-11-05', { method: 'CREDIT' });
      await spend('ana', 'c-food', 5, '2026-10-31');
      await spend('ana', 'c-food', 7, '2026-12-01');
      await spend('bob', 'c-food', 999, '2026-11-10');
    });

    it('sums debit, Pix, cash and the bill payment, and leaves the credit purchase out', async () => {
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(170);
    });

    it('counts the first and last day and leaves the neighbouring months out', async () => {
      expect((await repo.accountOutflow('ana', '2026-10')).cents).toBe(5);
      expect((await repo.accountOutflow('ana', '2026-12')).cents).toBe(7);
    });

    it('is scoped to the user and is zero for a month without spending', async () => {
      expect((await repo.accountOutflow('bob', '2026-11')).cents).toBe(999);
      expect((await repo.accountOutflow('admin', '2026-11')).cents).toBe(0);
      expect((await repo.accountOutflow('ana', '2026-01')).cents).toBe(0);
    });
  });

  describe('credit purchases of the month', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 1000, '2026-11-01', { method: 'CREDIT' });
      await spend('ana', 'c-food', 200, '2026-11-30', { method: 'CREDIT' });
      await spend('ana', 'c-food', 50, '2026-11-15', { method: 'PIX' });
      await spend('ana', 'c-food', 3, '2026-10-31', { method: 'CREDIT' });
      await spend('ana', 'c-food', 9, '2026-12-01', { method: 'CREDIT' });
      await spend('bob', 'c-food', 999, '2026-11-10', { method: 'CREDIT' });
    });

    it('sums only credit purchases dated inside the month', async () => {
      expect((await repo.creditSpent('ana', '2026-11')).cents).toBe(1200);
      expect((await repo.creditSpent('ana', '2026-10')).cents).toBe(3);
      expect((await repo.creditSpent('ana', '2026-12')).cents).toBe(9);
    });

    it('is scoped to the user and is zero without credit purchases', async () => {
      expect((await repo.creditSpent('admin', '2026-11')).cents).toBe(0);
      expect((await repo.creditSpent('ana', '2026-01')).cents).toBe(0);
    });
  });

  describe('loan payments received', () => {
    beforeEach(async () => {
      await lend('l-ana', 'ana');
      await lend('l-bob', 'bob');
      await receive('p1', 'l-ana', 'ana', 100, '2026-11-01');
      await receive('p2', 'l-ana', 'ana', 200, '2026-11-30');
      await receive('p3', 'l-ana', 'ana', 400, '2026-10-31');
      await receive('p4', 'l-ana', 'ana', 800, '2026-12-01');
      await receive('p5', 'l-bob', 'bob', 999, '2026-11-10');
    });

    it('sums the payments by the day they were received, edges included', async () => {
      expect((await repo.loanPaymentsReceived('ana', '2026-11')).cents).toBe(300);
      expect((await repo.loanPaymentsReceived('ana', '2026-10')).cents).toBe(400);
      expect((await repo.loanPaymentsReceived('ana', '2026-12')).cents).toBe(800);
    });

    it('is scoped to the user and is zero without payments', async () => {
      expect((await repo.loanPaymentsReceived('bob', '2026-11')).cents).toBe(999);
      expect((await repo.loanPaymentsReceived('admin', '2026-11')).cents).toBe(0);
      expect((await repo.loanPaymentsReceived('ana', '2026-01')).cents).toBe(0);
    });
  });

  describe('card charges and bill payments', () => {
    beforeEach(async () => {
      await spend('ana', 'c-food', 500, '2026-09-30', { method: 'CREDIT' });
      await spend('ana', 'c-food', 300, '2026-10-31', { method: 'CREDIT' });
      await spend('ana', 'c-food', 1000, '2026-11-01', { method: 'CREDIT' });
      await spend('ana', 'c-food', 200, '2026-11-30', { method: 'CREDIT' });
      await spend('ana', 'c-food', 99, '2026-12-01', { method: 'CREDIT' });
      await spend('ana', 'c-bus', 400, '2026-10-15', { isCardPayment: true });
      await spend('ana', 'c-bus', 100, '2026-11-30', { isCardPayment: true });
      await spend('ana', 'c-bus', 77, '2026-12-01', { isCardPayment: true });
      await spend('ana', 'c-food', 50, '2026-11-15', { method: 'PIX' });
      await spend('bob', 'c-food', 9999, '2026-11-10', { method: 'CREDIT' });
      await spend('bob', 'c-bus', 8888, '2026-10-10', { isCardPayment: true });
    });

    it('splits credit charges into before the month and in the month, ignoring the next one', async () => {
      const charges = await repo.cardCharges('ana', '2026-11');
      expect([charges.beforeMonth.cents, charges.inMonth.cents]).toEqual([800, 1200]);
    });

    it('splits bill payments the same way, and a plain Pix expense is neither', async () => {
      const payments = await repo.cardPayments('ana', '2026-11');
      expect([payments.beforeMonth.cents, payments.inMonth.cents]).toEqual([400, 100]);
    });

    it('the first month of the data has nothing before it', async () => {
      const charges = await repo.cardCharges('ana', '2026-09');
      expect([charges.beforeMonth.cents, charges.inMonth.cents]).toEqual([0, 500]);
    });

    it('never mixes users and gives zeros without data', async () => {
      const charges = await repo.cardCharges('bob', '2026-11');
      const payments = await repo.cardPayments('bob', '2026-11');
      expect([charges.beforeMonth.cents, charges.inMonth.cents]).toEqual([0, 9999]);
      expect([payments.beforeMonth.cents, payments.inMonth.cents]).toEqual([8888, 0]);
      const none = await repo.cardCharges('admin', '2026-11');
      expect([none.beforeMonth.cents, none.inMonth.cents]).toEqual([0, 0]);
    });
  });

  describe('money lent directly', () => {
    beforeEach(async () => {
      await lendDirect('ana', 10, { method: 'PIX', lentAt: '2026-11-01' });
      await lendDirect('ana', 20, { method: 'CASH', lentAt: '2026-11-30' });
      await lendDirect('ana', 40, { method: 'DEBIT', lentAt: '2026-11-15' });
      await lendDirect('ana', 1000, { method: 'CREDIT', lentAt: '2026-11-05' });
      await lendDirect('ana', 300, { method: 'CREDIT', lentAt: '2026-10-31' });
      await lendDirect('ana', 500, { method: 'CREDIT', lentAt: '2025-12-31' });
      await lendDirect('ana', 7, { method: 'PIX', lentAt: '2026-12-01' });
      await lendDirect('ana', 90, { method: 'CREDIT', lentAt: '2026-12-01' });
      await lendDirect('bob', 999, { method: 'PIX', lentAt: '2026-11-10' });
      await lendDirect('bob', 888, { method: 'CREDIT', lentAt: '2026-11-10' });
      // A loan born from an expense is already counted through the expense: never twice.
      await spend('ana', 'c-food', 4000, '2026-11-10', { method: 'PIX' });
      await spend('ana', 'c-food', 6000, '2026-11-11', { method: 'CREDIT' });
      await lendDirect('ana', 4000, { fromExpense: 'e1' });
      await lendDirect('ana', 6000, { fromExpense: 'e2' });
    });

    const split = (s: { beforeMonth: { cents: number }; inMonth: { cents: number } }) => [
      s.beforeMonth.cents,
      s.inMonth.cents,
    ];

    it('the outflow sums the non credit loans lent in the month, edges included', async () => {
      expect((await repo.directLoansOutflow('ana', '2026-11')).cents).toBe(70);
      expect((await repo.directLoansOutflow('ana', '2026-12')).cents).toBe(7);
      expect((await repo.directLoansOutflow('ana', '2026-10')).cents).toBe(0);
    });

    it('the credit loans split at the first day of the month', async () => {
      expect(split(await repo.directLoansOnCredit('ana', '2026-11'))).toEqual([800, 1000]);
      expect(split(await repo.directLoansOnCredit('ana', '2026-12'))).toEqual([1800, 90]);
      expect(split(await repo.directLoansOnCredit('ana', '2026-01'))).toEqual([500, 0]);
    });

    it('crosses the year boundary (December to January)', async () => {
      expect(split(await repo.directLoansOnCredit('ana', '2026-01'))).toEqual([500, 0]);
      expect(split(await repo.directLoansOnCredit('ana', '2025-12'))).toEqual([0, 500]);
      await lendDirect('ana', 11, { method: 'PIX', lentAt: '2026-01-01' });
      await lendDirect('ana', 13, { method: 'PIX', lentAt: '2025-12-31' });
      expect((await repo.directLoansOutflow('ana', '2025-12')).cents).toBe(13);
      expect((await repo.directLoansOutflow('ana', '2026-01')).cents).toBe(11);
    });

    it('is scoped to the user and is zero without loans', async () => {
      expect((await repo.directLoansOutflow('bob', '2026-11')).cents).toBe(999);
      expect(split(await repo.directLoansOnCredit('bob', '2026-11'))).toEqual([0, 888]);
      expect((await repo.directLoansOutflow('admin', '2026-11')).cents).toBe(0);
      expect(split(await repo.directLoansOnCredit('admin', '2026-11'))).toEqual([0, 0]);
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
      expect((await repo.accountOutflow('ana', '2026-03')).cents).toBe(6);
      expect((await repo.accountOutflow('ana', '2026-04')).cents).toBe(24);
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
      expect((await repo.accountOutflow('ana', '2028-02')).cents).toBe(100);
      expect((await repo.accountOutflow('ana', '2028-03')).cents).toBe(200);
      await spend('ana', 'c-food', 7, '2026-02-28');
      expect((await repo.accountOutflow('ana', '2026-02')).cents).toBe(8);
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
      expect((await repo.accountOutflow('ana', '2026-12')).cents).toBe(5);
      expect((await repo.accountOutflow('ana', '2027-01')).cents).toBe(9);
    });
  });

  describe('month window at the edges of the supported years', () => {
    it('month 0050-01 is year 50, not 1950: a 1949 expense is not included', async () => {
      await spend('ana', 'c-food', 7, '1949-05-05');
      expect((await repo.accountOutflow('ana', '0050-01')).cents).toBe(0);
      expect(await repo.totalsByCategory('ana', '0050-01')).toEqual([]);
      expect(await repo.totalsByDay('ana', '0050-01')).toEqual([]);
      expect(await repo.totalsByMonth('ana', '0050-01', '0050-01')).toEqual([]);
      expect((await repo.accountOutflow('ana', '1949-05')).cents).toBe(7);
    });

    it('works at the first and last accepted months (no 500)', async () => {
      await spend('ana', 'c-food', 3, '1900-01-01');
      await spend('ana', 'c-food', 4, '9998-12-31');
      expect((await repo.accountOutflow('ana', '1900-01')).cents).toBe(3);
      expect((await repo.accountOutflow('ana', '9998-12')).cents).toBe(4);
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
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(300);
      expect((await repo.accountOutflow('bob', '2026-11')).cents).toBe(1700);
      expect(cents(await repo.totalsByDay('ana', '2026-11'))).toEqual([100, 200]);
      expect((await repo.totalsByCategory('ana', '2026-11')).map((r) => r.categoryId)).toEqual([
        'c-ana',
        'c-food',
      ]);
      expect(cents(await repo.totalsByMonth('ana', '2026-01', '2026-12'))).toEqual([300]);
    });

    it('an admin with no spending of their own sees nothing of others', async () => {
      expect((await repo.accountOutflow('admin', '2026-11')).cents).toBe(0);
      expect(await repo.totalsByCategory('admin', '2026-11')).toEqual([]);
      expect(await repo.totalsByDay('admin', '2026-11')).toEqual([]);
      expect(await repo.totalsByMonth('admin', '2026-01', '2026-12')).toEqual([]);
    });

    it('an unknown user id gets empty reports', async () => {
      expect((await repo.accountOutflow('nobody', '2026-11')).cents).toBe(0);
    });

    it('treats a hostile user id as a plain value, never as SQL', async () => {
      const evil = `ana' OR '1'='1`;
      expect((await repo.accountOutflow(evil, '2026-11')).cents).toBe(0);
      expect(await repo.totalsByDay(`x'; DROP TABLE "Expense"; --`, '2026-11')).toEqual([]);
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(300);
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
      const spent = (await repo.accountOutflow('ana', '2026-02')).cents;
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
      expect((await repo.accountOutflow('ana', '2026-11')).cents).toBe(5_000_000_000_000);
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
        await expect(repo.accountOutflow('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByDay('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByCategory('ana', '2026-11')).rejects.toThrow(/safe integer/);
        await expect(repo.totalsByMonth('ana', '2026-11', '2026-11')).rejects.toThrow(
          /safe integer/,
        );
        // Another user's reports keep working.
        expect((await repo.accountOutflow('bob', '2026-11')).cents).toBe(0);
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
        repo.accountOutflow('ana', month),
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
      ['account outflow', () => accountOutflowSql('ana', '2025-06')],
      ['credit', () => creditSpentSql('ana', '2025-06')],
      ['card charges', () => cardChargesSql('ana', '2025-06')],
      ['card payments', () => cardPaymentsSql('ana', '2025-06')],
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
