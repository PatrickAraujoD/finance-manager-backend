import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

describe('reports endpoints', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;
  let bob: Session;
  let global: string;
  let anaCat: string;
  let bobCat: string;
  let seq = 0;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    seq = 0;
    await cleanTables(t.prisma);
    admin = await signUp(t, 'admin@example.com', 'A');
    ana = await signUp(t, 'ana@example.com');
    bob = await signUp(t, 'bob@example.com');
    global = (await category(admin, 'Alimentacao', true)).body.id;
    anaCat = (await category(ana, 'Casa')).body.id;
    bobCat = (await category(bob, 'Lazer')).body.id;
  });

  const http = () => request(t.app.getHttpServer());
  const category = (s: Session, name: string, isGlobal = false) =>
    http().post('/categories').set(...bearer(s)).send({ name, global: isGlobal });
  const report = (s: Session, path: string) => http().get(`/reports/${path}`).set(...bearer(s));

  /** Inserted directly so dates in the far future or past (leap years) are possible. */
  async function spend(
    s: Session,
    categoryId: string,
    cents: number,
    date: string,
    how: { method?: 'CREDIT' | 'DEBIT' | 'PIX' | 'CASH'; isCardPayment?: boolean } = {},
  ) {
    await t.prisma.client.$executeRaw`
      INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","isCardPayment","spentAt")
      VALUES (${`e${++seq}`}, ${s.id}, ${categoryId}, ${cents}, true, ${how.method ?? 'PIX'}::"PaymentMethod",
        ${how.isCardPayment ?? false}, ${date}::date)`;
  }

  const PATHS = [
    'by-category?month=2026-11',
    'by-day?month=2026-11',
    'monthly-evolution?from=2026-01&to=2026-03',
    'income-vs-spent?month=2026-11',
    'card?month=2026-11',
  ];

  describe('authentication', () => {
    it.each(PATHS)('GET /reports/%s without a token is 401', async (path) => {
      expect((await http().get(`/reports/${path}`)).status).toBe(401);
    });

    it.each(PATHS)('GET /reports/%s with an invalid token is 401', async (path) => {
      const res = await http().get(`/reports/${path}`).set('Authorization', 'Bearer nope');
      expect(res.status).toBe(401);
    });
  });

  describe('strict query validation', () => {
    const bad = [
      'by-category',
      'by-category?month=',
      'by-category?month=2026-13',
      'by-category?month=2026-00',
      'by-category?month=2026-1',
      'by-category?month=2026-11-01',
      'by-category?month=%202026-11',
      'by-category?month=2026-11&month=2026-10',
      'by-category?month[]=2026-11',
      'by-category?month[a]=2026-11',
      'by-category?month=2026-11&extra=1',
      'by-category?mes=2026-11',
      'by-day',
      'by-day?month=nope',
      'by-day?month=2026-11&month=2026-11',
      'by-day?month=2026-11&limit=5',
      'income-vs-spent',
      'income-vs-spent?month=2026-13',
      'income-vs-spent?month=2026-11&month=2026-12',
      'card',
      'card?month=',
      'card?month=2026-13',
      'card?month=2026-1',
      'card?month=2026-11&month=2026-12',
      'card?month[]=2026-11',
      'card?month=2026-11&extra=1',
      'monthly-evolution',
      'monthly-evolution?from=2026-01',
      'monthly-evolution?to=2026-03',
      'monthly-evolution?from=2026-01&to=2026-13',
      'monthly-evolution?from=2026-04&to=2026-03',
      'monthly-evolution?from=2026-01&to=2026-03&to=2026-04',
      'monthly-evolution?from=2026-01&from=2026-02&to=2026-03',
      'monthly-evolution?from=2026-01&to=2026-03&month=2026-01',
      'monthly-evolution?from=2024-01&to=2026-01',
    ];
    it.each(bad)('GET /reports/%s is 400 and never 500', async (path) => {
      const res = await report(ana, path);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: expect.anything(),
      });
    });

    const OUT_OF_RANGE = ['0050-01', '0000-01', '1899-12', '9999-12'];
    it.each(OUT_OF_RANGE)('rejects the year range edge %s in the four reports (400)', async (m) => {
      for (const path of [
        `by-category?month=${m}`,
        `by-day?month=${m}`,
        `income-vs-spent?month=${m}`,
        `card?month=${m}`,
        `monthly-evolution?from=${m}&to=${m}`,
        `monthly-evolution?from=2026-01&to=${m}`,
      ]) {
        expect((await report(ana, path)).status).toBe(400);
      }
    });

    it.each(['1900-01', '9998-12'])('accepts the boundary month %s (200)', async (m) => {
      for (const path of [
        `by-category?month=${m}`,
        `by-day?month=${m}`,
        `income-vs-spent?month=${m}`,
        `card?month=${m}`,
        `monthly-evolution?from=${m}&to=${m}`,
      ]) {
        expect((await report(ana, path)).status).toBe(200);
      }
    });

    it('year 0050 never returns 1949 spending, while 1949-05 does', async () => {
      await spend(ana, global, 700, '1949-05-05');
      expect((await report(ana, 'by-category?month=0050-01')).status).toBe(400);
      const res = await report(ana, 'by-category?month=1949-05');
      expect(res.status).toBe(200);
      expect(res.body.totalCents).toBe(700);
    });

    it('accepts exactly 24 months and rejects 25', async () => {
      expect((await report(ana, 'monthly-evolution?from=2025-01&to=2026-12')).status).toBe(200);
      expect((await report(ana, 'monthly-evolution?from=2025-01&to=2027-01')).status).toBe(400);
    });

    it('does not accept the month in the path or the body', async () => {
      expect((await http().get('/reports/by-category/2026-11').set(...bearer(ana))).status).toBe(
        404,
      );
      expect((await http().post('/reports/by-category').set(...bearer(ana))).status).toBe(404);
    });
  });

  describe('GET /reports/by-category', () => {
    it('empty month: no items and zero, 200', async () => {
      const res = await report(ana, 'by-category?month=2026-11');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ month: '2026-11', totalCents: 0, items: [] });
    });

    it('lists categories (global and own) with exact percentages and explicit fields', async () => {
      await spend(ana, global, 100, '2026-11-01');
      await spend(ana, anaCat, 100, '2026-11-02');
      await spend(ana, global, 100, '2026-11-03');
      await spend(ana, anaCat, 100, '2026-12-01');
      const res = await report(ana, 'by-category?month=2026-11');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        month: '2026-11',
        totalCents: 300,
        items: [
          { categoryId: global, categoryName: 'Alimentacao', totalCents: 200, percentage: 66.67 },
          { categoryId: anaCat, categoryName: 'Casa', totalCents: 100, percentage: 33.33 },
        ],
      });
      for (const item of res.body.items) {
        expect(Object.keys(item).sort()).toEqual(
          ['categoryId', 'categoryName', 'percentage', 'totalCents'].sort(),
        );
        expect(Number.isInteger(item.totalCents)).toBe(true);
      }
    });

    it('1/3 + 1/3 + 1/3 sums to exactly 100.00', async () => {
      const third = (await category(ana, 'Terceira')).body.id;
      await spend(ana, global, 100, '2026-11-01');
      await spend(ana, anaCat, 100, '2026-11-01');
      await spend(ana, third, 100, '2026-11-01');
      const { items } = (await report(ana, 'by-category?month=2026-11')).body;
      expect(items.map((i: { percentage: number }) => i.percentage)).toEqual([33.34, 33.33, 33.33]);
      const total = items.reduce(
        (s: number, i: { percentage: number }) => s + Math.round(i.percentage * 100),
        0,
      );
      expect(total).toBe(10000);
    });
  });

  describe('GET /reports/by-day', () => {
    it('empty month: no days and a null top day, 200', async () => {
      const res = await report(ana, 'by-day?month=2026-11');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ month: '2026-11', days: [], topDay: null });
    });

    it('lists the days with spending and the top day', async () => {
      await spend(ana, global, 300, '2026-11-10');
      await spend(ana, anaCat, 200, '2026-11-02');
      await spend(ana, global, 150, '2026-11-10');
      const res = await report(ana, 'by-day?month=2026-11');
      expect(res.body).toEqual({
        month: '2026-11',
        days: [
          { date: '2026-11-02', totalCents: 200 },
          { date: '2026-11-10', totalCents: 450 },
        ],
        topDay: { date: '2026-11-10', totalCents: 450 },
      });
    });

    it('ties for the top day go to the earliest date', async () => {
      await spend(ana, global, 500, '2026-11-20');
      await spend(ana, global, 500, '2026-11-05');
      const res = await report(ana, 'by-day?month=2026-11');
      expect(res.body.topDay).toEqual({ date: '2026-11-05', totalCents: 500 });
    });

    it('keeps the month boundaries and the leap day', async () => {
      await spend(ana, global, 1, '2026-03-31');
      await spend(ana, global, 2, '2026-04-01');
      await spend(ana, global, 4, '2028-02-29');
      await spend(ana, global, 8, '2028-03-01');
      expect((await report(ana, 'by-day?month=2026-03')).body.days).toEqual([
        { date: '2026-03-31', totalCents: 1 },
      ]);
      expect((await report(ana, 'by-day?month=2026-04')).body.days).toEqual([
        { date: '2026-04-01', totalCents: 2 },
      ]);
      expect((await report(ana, 'by-day?month=2028-02')).body.days).toEqual([
        { date: '2028-02-29', totalCents: 4 },
      ]);
    });
  });

  describe('GET /reports/monthly-evolution', () => {
    it('fills months without spending with zero', async () => {
      await spend(ana, global, 100, '2026-01-15');
      await spend(ana, global, 300, '2026-03-02');
      const res = await report(ana, 'monthly-evolution?from=2026-01&to=2026-04');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        from: '2026-01',
        to: '2026-04',
        months: [
          { month: '2026-01', totalCents: 100 },
          { month: '2026-02', totalCents: 0 },
          { month: '2026-03', totalCents: 300 },
          { month: '2026-04', totalCents: 0 },
        ],
      });
    });

    it('crosses the year boundary (2025-11 to 2026-02)', async () => {
      await spend(ana, global, 10, '2025-11-30');
      await spend(ana, global, 20, '2025-12-31');
      await spend(ana, global, 40, '2026-01-01');
      await spend(ana, global, 80, '2026-03-01');
      const res = await report(ana, 'monthly-evolution?from=2025-11&to=2026-02');
      expect(res.body.months).toEqual([
        { month: '2025-11', totalCents: 10 },
        { month: '2025-12', totalCents: 20 },
        { month: '2026-01', totalCents: 40 },
        { month: '2026-02', totalCents: 0 },
      ]);
    });
  });

  describe('GET /reports/income-vs-spent', () => {
    it('no income and no spending: nulls and zero, 200', async () => {
      const res = await report(ana, 'income-vs-spent?month=2026-11');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        month: '2026-11',
        incomeCents: null,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 0,
        remainingCents: null,
        percentSpent: null,
      });
    });

    it('with income: remaining and percent spent', async () => {
      await http().put('/income/2026-11').set(...bearer(ana)).send({ amountCents: 500000 });
      await spend(ana, global, 125000, '2026-11-03');
      const res = await report(ana, 'income-vs-spent?month=2026-11');
      expect(res.body).toEqual({
        month: '2026-11',
        incomeCents: 500000,
        spentCents: 125000,
        receivedCents: 0,
        creditSpentCents: 0,
        remainingCents: 375000,
        percentSpent: 25,
      });
    });

    it('spending above the income gives a negative remainder and more than 100 percent', async () => {
      await http().put('/income/2026-11').set(...bearer(ana)).send({ amountCents: 100000 });
      await spend(ana, global, 150000, '2026-11-03');
      const res = await report(ana, 'income-vs-spent?month=2026-11');
      expect(res.body).toMatchObject({ remainingCents: -50000, percentSpent: 150 });
    });
  });

  describe('the account and the credit card (acceptance scenario)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const earn = (s: Session, amountCents: number) =>
      http().put(`/income/${month}`).set(...bearer(s)).send({ amountCents });
    const buy = (s: Session, amountCents: number, paymentMethod: string, extra: object = {}) =>
      http()
        .post('/expenses')
        .set(...bearer(s))
        .send({ categoryId: global, amountCents, paidAlone: true, paymentMethod, spentAt: today, ...extra });
    const account = async (s: Session) => (await report(s, `income-vs-spent?month=${month}`)).body;
    const card = async (s: Session) => (await report(s, `card?month=${month}`)).body;

    it('credit purchase, Pix, bill payment and a loan payment move the two balances as expected', async () => {
      expect((await earn(ana, 500000)).status).toBe(200);

      // A 1000.00 credit purchase raises the card and leaves the salary alone.
      const credit = await buy(ana, 100000, 'CREDIT');
      expect(credit.status).toBe(201);
      expect(await account(ana)).toEqual({
        month,
        incomeCents: 500000,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 100000,
        remainingCents: 500000,
        percentSpent: 0,
      });
      expect(await card(ana)).toEqual({
        month,
        openingCents: 0,
        chargedCents: 100000,
        paidCents: 0,
        balanceCents: 100000,
      });

      // A 200.00 Pix expense comes out of the salary.
      const pix = await buy(ana, 20000, 'PIX');
      expect(pix.status).toBe(201);
      expect(await account(ana)).toMatchObject({ spentCents: 20000, remainingCents: 480000 });
      expect((await card(ana)).balanceCents).toBe(100000);

      // Paying the bill by Pix leaves the account and brings the card to zero.
      const bill = await buy(ana, 100000, 'PIX', { isCardPayment: true });
      expect(bill.status).toBe(201);
      expect(await account(ana)).toMatchObject({
        spentCents: 120000,
        creditSpentCents: 100000,
        remainingCents: 380000,
        percentSpent: 24,
      });
      expect(await card(ana)).toEqual({
        month,
        openingCents: 0,
        chargedCents: 100000,
        paidCents: 100000,
        balanceCents: 0,
      });

      // Lending the Pix expense and receiving 100.00 in cash brings money back into the account.
      const lent = await http()
        .post('/loans')
        .set(...bearer(ana))
        .send({ borrowerName: 'Carlos', dueDate: '2099-01-01', expenseId: pix.body.id });
      expect(lent.status).toBe(201);
      const received = await http()
        .post(`/loans/${lent.body.id}/payments`)
        .set(...bearer(ana))
        .send({ amountCents: 10000, method: 'CASH', paidAt: today });
      expect(received.status).toBe(201);
      expect(await account(ana)).toEqual({
        month,
        incomeCents: 500000,
        spentCents: 120000,
        receivedCents: 10000,
        creditSpentCents: 100000,
        remainingCents: 390000,
        percentSpent: 24,
      });
      expect((await card(ana)).balanceCents).toBe(0);
    });

    it('a credit-card purchase that is lent still counts only once (credit, never the salary)', async () => {
      await earn(ana, 500000);
      const credit = await buy(ana, 30000, 'CREDIT');
      const lent = await http()
        .post('/loans')
        .set(...bearer(ana))
        .send({ borrowerName: 'Carlos', dueDate: '2099-01-01', expenseId: credit.body.id });
      expect(lent.status).toBe(201);
      expect(await account(ana)).toMatchObject({ spentCents: 0, remainingCents: 500000 });
      expect((await card(ana)).balanceCents).toBe(30000);
    });

    it('paying the card bill with the card itself is refused (400) and changes nothing', async () => {
      const res = await buy(ana, 40000, 'CREDIT', { isCardPayment: true });
      expect(res.status).toBe(400);
      expect(await card(ana)).toMatchObject({ chargedCents: 0, paidCents: 0, balanceCents: 0 });
    });

    it('the previous months feed the opening balance and later months are ignored', async () => {
      await spend(ana, global, 5000, '2026-09-30', { method: 'CREDIT' });
      await spend(ana, global, 2000, '2026-10-31', { isCardPayment: true });
      await spend(ana, global, 700, '2026-11-01', { method: 'CREDIT' });
      await spend(ana, global, 999, '2026-12-01', { method: 'CREDIT' });
      expect((await report(ana, 'card?month=2026-11')).body).toEqual({
        month: '2026-11',
        openingCents: 3000,
        chargedCents: 700,
        paidCents: 0,
        balanceCents: 3700,
      });
      expect((await report(ana, 'card?month=2026-12')).body).toMatchObject({
        openingCents: 3700,
        balanceCents: 4699,
      });
    });

    it('overpaying the bill gives a negative balance instead of an error', async () => {
      await spend(ana, global, 1000, '2026-11-01', { method: 'CREDIT' });
      await spend(ana, global, 1500, '2026-11-02', { isCardPayment: true });
      expect((await report(ana, 'card?month=2026-11')).body.balanceCents).toBe(-500);
    });

    it("never shows another user's purchases, payments or loan receipts, admin included", async () => {
      await spend(bob, bobCat, 8000, '2026-11-02', { method: 'CREDIT' });
      await spend(bob, bobCat, 3000, '2026-11-03', { isCardPayment: true });
      await spend(ana, anaCat, 100, '2026-11-04', { method: 'CREDIT' });
      expect((await report(ana, 'card?month=2026-11')).body).toMatchObject({
        chargedCents: 100,
        paidCents: 0,
        balanceCents: 100,
      });
      expect((await report(bob, 'card?month=2026-11')).body.balanceCents).toBe(5000);
      for (const path of ['card?month=2026-11', 'income-vs-spent?month=2026-11']) {
        const res = await report(admin, path);
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/8000|3000|5000|\b100\b/);
      }
      expect((await report(admin, 'card?month=2026-11')).body).toEqual({
        month: '2026-11',
        openingCents: 0,
        chargedCents: 0,
        paidCents: 0,
        balanceCents: 0,
      });
    });
  });

  describe('money lent directly (loans without an expense)', () => {
    const MONTH = '2026-03';
    const lendDirect = (s: Session, amountCents: number, paymentMethod: string, lentAt: string) =>
      http()
        .post('/loans')
        .set(...bearer(s))
        .send({ borrowerName: 'Carlos', dueDate: '2099-01-01', amountCents, paymentMethod, lentAt });
    const account = async (s: Session, month = MONTH) =>
      (await report(s, `income-vs-spent?month=${month}`)).body;
    const card = async (s: Session, month = MONTH) => (await report(s, `card?month=${month}`)).body;
    const earn = (s: Session, month: string, amountCents: number) =>
      http().put(`/income/${month}`).set(...bearer(s)).send({ amountCents });

    it('a loan on credit raises the card and does not come out of the salary', async () => {
      await earn(ana, MONTH, 500000);
      expect((await lendDirect(ana, 30000, 'CREDIT', '2026-03-10')).status).toBe(201);
      expect(await account(ana)).toEqual({
        month: MONTH,
        incomeCents: 500000,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 30000,
        remainingCents: 500000,
        percentSpent: 0,
      });
      expect(await card(ana)).toEqual({
        month: MONTH,
        openingCents: 0,
        chargedCents: 30000,
        paidCents: 0,
        balanceCents: 30000,
      });
    });

    it.each(['PIX', 'CASH', 'DEBIT'])(
      'a %s loan comes out of the salary in the month it was lent, and only in that one',
      async (method) => {
        await earn(ana, '2026-03', 500000);
        await earn(ana, '2026-04', 500000);
        expect((await lendDirect(ana, 20000, method, '2026-03-31')).status).toBe(201);
        expect(await account(ana, '2026-03')).toMatchObject({
          spentCents: 20000,
          creditSpentCents: 0,
          remainingCents: 480000,
        });
        expect(await account(ana, '2026-04')).toMatchObject({ spentCents: 0, remainingCents: 500000 });
        expect(await account(ana, '2026-02')).toMatchObject({ spentCents: 0 });
        expect(await card(ana, '2026-03')).toMatchObject({ chargedCents: 0, balanceCents: 0 });
      },
    );

    it('a loan born from an expense counts once, through the expense', async () => {
      await earn(ana, MONTH, 500000);
      await spend(ana, global, 40000, '2026-03-05');
      await spend(ana, global, 6000, '2026-03-06', { method: 'CREDIT' });
      // The rows were inserted directly with plain ids; the API wants UUIDs, so give them one.
      const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
      await t.prisma.client.$executeRaw`UPDATE "Expense" SET "id" = ${ids[0]} WHERE "id" = 'e1'`;
      await t.prisma.client.$executeRaw`UPDATE "Expense" SET "id" = ${ids[1]} WHERE "id" = 'e2'`;
      for (const id of ids) {
        const lent = await http()
          .post('/loans')
          .set(...bearer(ana))
          .send({ borrowerName: 'Carlos', dueDate: '2099-01-01', expenseId: id });
        expect(lent.status).toBe(201);
      }
      expect(await account(ana)).toMatchObject({
        spentCents: 40000,
        creditSpentCents: 6000,
        remainingCents: 460000,
      });
      expect(await card(ana)).toMatchObject({ chargedCents: 6000, balanceCents: 6000 });
    });

    it('accumulates on the card until the bill is paid, and the payment leaves the account', async () => {
      await earn(ana, '2026-04', 500000);
      await lendDirect(ana, 30000, 'CREDIT', '2026-03-20');
      await spend(ana, global, 10000, '2026-04-02', { method: 'CREDIT' });
      expect(await card(ana, '2026-04')).toEqual({
        month: '2026-04',
        openingCents: 30000,
        chargedCents: 10000,
        paidCents: 0,
        balanceCents: 40000,
      });
      await spend(ana, global, 40000, '2026-04-15', { isCardPayment: true });
      expect(await card(ana, '2026-04')).toMatchObject({ paidCents: 40000, balanceCents: 0 });
      expect(await account(ana, '2026-04')).toMatchObject({
        spentCents: 40000,
        creditSpentCents: 10000,
        remainingCents: 460000,
      });
      expect(await account(ana, '2026-03')).toMatchObject({ spentCents: 0, creditSpentCents: 30000 });
    });

    it("never shows another user's loans", async () => {
      await lendDirect(ana, 30000, 'CREDIT', '2026-03-10');
      await lendDirect(ana, 20000, 'PIX', '2026-03-10');
      for (const s of [bob, admin]) {
        expect(await account(s)).toMatchObject({ spentCents: 0, creditSpentCents: 0 });
        expect(await card(s)).toMatchObject({ chargedCents: 0, balanceCents: 0 });
      }
    });

    it('income-vs-spent counts what left the account while the other reports ignore the bill and the loans', async () => {
      await earn(ana, MONTH, 500000);
      await spend(ana, global, 20000, '2026-03-02');
      await spend(ana, anaCat, 100000, '2026-03-03', { method: 'CREDIT' });
      await spend(ana, global, 100000, '2026-03-20', { isCardPayment: true });
      await lendDirect(ana, 30000, 'PIX', '2026-03-10');
      await lendDirect(ana, 5000, 'CREDIT', '2026-03-12');

      // spentCents is the account outflow: Pix expense + bill payment + Pix loan.
      expect(await account(ana)).toEqual({
        month: MONTH,
        incomeCents: 500000,
        spentCents: 150000,
        receivedCents: 0,
        creditSpentCents: 105000,
        remainingCents: 350000,
        percentSpent: 30,
      });
      // The card: both credit items charged, the bill paid, the credit loan still owed.
      expect(await card(ana)).toMatchObject({ chargedCents: 105000, paidCents: 100000, balanceCents: 5000 });

      // The grouped reports are expense reports: they count the credit purchase, not the bill
      // payment, and loans are not expenses.
      const [cat, day, evo] = await Promise.all([
        report(ana, `by-category?month=${MONTH}`),
        report(ana, `by-day?month=${MONTH}`),
        report(ana, `monthly-evolution?from=${MONTH}&to=${MONTH}`),
      ]);
      expect(cat.body.totalCents).toBe(120000);
      expect(day.body.days).toEqual([
        { date: '2026-03-02', totalCents: 20000 },
        { date: '2026-03-03', totalCents: 100000 },
      ]);
      expect(evo.body.months).toEqual([{ month: MONTH, totalCents: 120000 }]);
    });
  });

  describe('consistency and isolation', () => {
    // income-vs-spent is left out on purpose: it measures what left the account (credit
    // purchases out, bill payments in), so it does not match the three grouped reports.
    it('by-category, by-day and monthly-evolution agree on the total of the same month', async () => {
      for (let day = 1; day <= 28; day++) {
        await spend(ana, day % 2 ? global : anaCat, 100 + day, `2026-02-${String(day).padStart(2, '0')}`);
      }
      await spend(ana, global, 5000, '2026-02-10', { method: 'CREDIT' });
      await spend(ana, global, 5000, '2026-02-20', { isCardPayment: true });
      const [cat, day, evo] = await Promise.all([
        report(ana, 'by-category?month=2026-02'),
        report(ana, 'by-day?month=2026-02'),
        report(ana, 'monthly-evolution?from=2026-02&to=2026-02'),
      ]);
      const spent = cat.body.totalCents;
      expect(spent).toBeGreaterThan(0);
      expect(
        cat.body.items.reduce((s: number, i: { totalCents: number }) => s + i.totalCents, 0),
      ).toBe(spent);
      expect(
        day.body.days.reduce((s: number, d: { totalCents: number }) => s + d.totalCents, 0),
      ).toBe(spent);
      expect(evo.body.months[0].totalCents).toBe(spent);
    });

    it('ignores a card bill payment but counts the credit purchase it pays for', async () => {
      await spend(ana, global, 1000, '2026-11-02', { method: 'CREDIT' });
      await spend(ana, global, 1000, '2026-11-10', { isCardPayment: true });
      const [cat, day, evo] = await Promise.all([
        report(ana, 'by-category?month=2026-11'),
        report(ana, 'by-day?month=2026-11'),
        report(ana, 'monthly-evolution?from=2026-10&to=2026-11'),
      ]);
      expect(cat.body.totalCents).toBe(1000);
      expect(cat.body.items).toHaveLength(1);
      expect(day.body.days).toEqual([{ date: '2026-11-02', totalCents: 1000 }]);
      expect(day.body.topDay).toEqual({ date: '2026-11-02', totalCents: 1000 });
      expect(evo.body.months).toEqual([
        { month: '2026-10', totalCents: 0 },
        { month: '2026-11', totalCents: 1000 },
      ]);
    });

    it('reflects an expense created through POST /expenses', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const created = await http()
        .post('/expenses')
        .set(...bearer(ana))
        .send({ categoryId: global, amountCents: 4242, paidAlone: true, paymentMethod: 'PIX', spentAt: today });
      expect(created.status).toBe(201);
      const res = await report(ana, `by-day?month=${today.slice(0, 7)}`);
      expect(res.body.topDay).toEqual({ date: today, totalCents: 4242 });
    });

    it("never includes another user's spending or income, admin included", async () => {
      await spend(ana, global, 100, '2026-11-05');
      await spend(bob, global, 900, '2026-11-05');
      await spend(bob, bobCat, 800, '2026-11-06');
      await http().put('/income/2026-11').set(...bearer(bob)).send({ amountCents: 777 });

      const anaCats = await report(ana, 'by-category?month=2026-11');
      expect(anaCats.body.totalCents).toBe(100);
      expect(JSON.stringify(anaCats.body)).not.toContain('Lazer');
      expect((await report(ana, 'by-day?month=2026-11')).body.days).toEqual([
        { date: '2026-11-05', totalCents: 100 },
      ]);
      expect((await report(ana, 'income-vs-spent?month=2026-11')).body).toMatchObject({
        incomeCents: null,
        spentCents: 100,
      });
      expect((await report(bob, 'by-category?month=2026-11')).body.totalCents).toBe(1700);

      for (const path of PATHS) {
        const res = await report(admin, path);
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/900|800|1700|777|Lazer/);
      }
      expect((await report(admin, 'by-category?month=2026-11')).body).toEqual({
        month: '2026-11',
        totalCents: 0,
        items: [],
      });
    });

    it('sums many maximum expenses without losing precision', async () => {
      await t.prisma.client.$executeRaw`
        INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","paymentMethod","spentAt")
        SELECT 'max' || g, ${ana.id}, ${global}, 1000000000, true, 'PIX', '2026-11-01'::date
        FROM generate_series(1, 5000) g`;
      const res = await report(ana, 'income-vs-spent?month=2026-11');
      expect(res.body.spentCents).toBe(5_000_000_000_000);
      expect((await report(ana, 'by-day?month=2026-11')).body.topDay.totalCents).toBe(
        5_000_000_000_000,
      );
    });
  });
});

describe('reports throttling', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp({ throttleLimit: 3 });
  });
  afterAll(async () => {
    await t.close();
  });

  it('is limited by the global throttle (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(t.app.getHttpServer()).get('/reports/by-day?month=2026-11');
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
