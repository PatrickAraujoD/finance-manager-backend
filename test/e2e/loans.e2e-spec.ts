import request from 'supertest';
import { MAX_EXPENSE_CENTS } from '../../src/domain/entities/expense';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const MISSING = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

/** `YYYY-MM-DD` of today (UTC) plus `days`, from the real clock the app uses. */
function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const VIEW_FIELDS = [
  'amountCents',
  'borrowerName',
  'createdAt',
  'dueDate',
  'expenseId',
  'id',
  'paidCents',
  'remainingCents',
  'status',
];

describe('loans endpoints', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;
  let bob: Session;
  let global: string;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    admin = await signUp(t, 'admin@example.com', 'A');
    ana = await signUp(t, 'ana@example.com');
    bob = await signUp(t, 'bob@example.com');
    global = (
      await http().post('/categories').set(...bearer(admin)).send({ name: 'Mercado', global: true })
    ).body.id;
  });

  const http = () => request(t.app.getHttpServer());
  const expense = async (s: Session, amountCents = 4200): Promise<string> =>
    (
      await http()
        .post('/expenses')
        .set(...bearer(s))
        .send({
          categoryId: global,
          amountCents,
          paidAlone: false,
          paymentMethod: 'PIX',
          spentAt: '2026-11-05',
        })
    ).body.id;
  const post = (s: Session, body: object) => http().post('/loans').set(...bearer(s)).send(body);
  const get = (s: Session, id: string) => http().get(`/loans/${id}`).set(...bearer(s));
  const patch = (s: Session, id: string, body: object) =>
    http().patch(`/loans/${id}`).set(...bearer(s)).send(body);
  const del = (s: Session, id: string) => http().delete(`/loans/${id}`).set(...bearer(s));
  const list = (s: Session, query = '') => http().get(`/loans${query}`).set(...bearer(s));
  const lend = (s: Session, borrowerName: string, dueDate: string, amountCents = 1000) =>
    post(s, { borrowerName, dueDate, amountCents });

  async function loanCount(): Promise<number> {
    return t.prisma.client.loan.count();
  }

  describe('full flow', () => {
    it('lends from an expense, reads, lists, edits and deletes it', async () => {
      const expenseId = await expense(ana, 4200);
      const created = await post(ana, {
        borrowerName: 'Carlos',
        dueDate: dayFromToday(30),
        expenseId,
      });
      expect(created.status).toBe(201);
      expect(Object.keys(created.body)).toEqual(['id']);
      const id = created.body.id as string;

      const read = await get(ana, id);
      expect(read.status).toBe(200);
      expect(Object.keys(read.body).sort()).toEqual(VIEW_FIELDS);
      expect(read.body).toMatchObject({
        id,
        borrowerName: 'Carlos',
        amountCents: 4200,
        dueDate: dayFromToday(30),
        expenseId,
        paidCents: 0,
        remainingCents: 4200,
        status: 'OPEN',
      });
      expect(read.body).not.toHaveProperty('userId');

      const listed = await list(ana);
      expect(listed.status).toBe(200);
      expect(listed.body).toMatchObject({ total: 1, limit: 100, offset: 0 });
      expect(listed.body.items).toEqual([read.body]);

      const edited = await patch(ana, id, { borrowerName: 'Carlos Eduardo', dueDate: dayFromToday(-3) });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        borrowerName: 'Carlos Eduardo',
        dueDate: dayFromToday(-3),
        amountCents: 4200,
        expenseId,
        status: 'OVERDUE',
      });

      const removed = await del(ana, id);
      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect((await get(ana, id)).status).toBe(404);
      // The expense is still there, and free for a new loan.
      expect((await http().get(`/expenses/${expenseId}`).set(...bearer(ana))).status).toBe(200);
      expect((await post(ana, { borrowerName: 'Maria', dueDate: dayFromToday(1), expenseId })).status).toBe(
        201,
      );
    });

    it('lends money directly, and one person can have several loans', async () => {
      const a = await lend(ana, 'Carlos', dayFromToday(10), 15_000);
      const b = await lend(ana, 'Carlos', dayFromToday(20), 7_000);
      expect([a.status, b.status]).toEqual([201, 201]);
      const read = await get(ana, a.body.id);
      expect(read.body).toMatchObject({ amountCents: 15_000, expenseId: null, remainingCents: 15_000 });
      expect((await list(ana)).body.total).toBe(2);
    });

    it('classifies due today as OPEN and an older due date as OVERDUE', async () => {
      const today = await lend(ana, 'Hoje', dayFromToday(0));
      const old = await lend(ana, 'Antigo', '2020-01-15');
      expect((await get(ana, today.body.id)).body.status).toBe('OPEN');
      expect((await get(ana, old.body.id)).body.status).toBe('OVERDUE');
    });
  });

  describe('listing', () => {
    beforeEach(async () => {
      await lend(ana, 'Carlos', dayFromToday(30), 100);
      await lend(ana, 'carlos', dayFromToday(-5), 200);
      await lend(ana, 'Maria', dayFromToday(10), 300);
      await lend(bob, 'Carlos', dayFromToday(1), 999);
    });
    const names = (res: request.Response) =>
      (res.body.items as { borrowerName: string }[]).map((i) => i.borrowerName);

    it('orders by due date, soonest first', async () => {
      expect(names(await list(ana))).toEqual(['carlos', 'Maria', 'Carlos']);
    });

    it('filters by borrower ignoring case and spaces at the ends', async () => {
      const res = await list(ana, '?borrower=%20CARLOS%20');
      expect(names(res)).toEqual(['carlos', 'Carlos']);
      expect(res.body.total).toBe(2);
    });

    it('filters by status', async () => {
      expect(names(await list(ana, '?status=overdue'))).toEqual(['carlos']);
      expect(names(await list(ana, '?status=open'))).toEqual(['Maria', 'Carlos']);
      expect((await list(ana, '?status=paid')).body).toMatchObject({ items: [], total: 0 });
    });

    it('pages with limit and offset', async () => {
      const res = await list(ana, '?limit=1&offset=1');
      expect(names(res)).toEqual(['Maria']);
      expect(res.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    });

    it.each([
      '?status=late',
      '?status=OPEN',
      '?limit=0',
      '?limit=201',
      '?limit=abc',
      '?offset=-1',
      '?borrower=',
      '?foo=bar',
    ])('rejects the query %s with 400', async (query) => {
      expect((await list(ana, query)).status).toBe(400);
    });

    it('shows each user only their own loans, admin included', async () => {
      expect((await list(bob)).body.total).toBe(1);
      expect((await list(admin)).body).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('validation (400)', () => {
    const base = { borrowerName: 'Carlos', dueDate: '2026-12-10' };

    it.each([
      ['neither expenseId nor amountCents', {}],
      ['both expenseId and amountCents', { expenseId: MISSING, amountCents: 100 }],
      ['a null borrowerName', { borrowerName: null, amountCents: 100 }],
      ['a blank borrowerName', { borrowerName: '   ', amountCents: 100 }],
      ['a borrowerName over 100 characters', { borrowerName: 'a'.repeat(101), amountCents: 100 }],
      ['a borrowerName with a bidi override', { borrowerName: 'Car‮los', amountCents: 100 }],
      ['a numeric borrowerName', { borrowerName: 5, amountCents: 100 }],
      ['a null dueDate', { dueDate: null, amountCents: 100 }],
      ['a non-existent dueDate', { dueDate: '2026-02-30', amountCents: 100 }],
      ['a dueDate with time', { dueDate: '2026-12-10T00:00:00Z', amountCents: 100 }],
      ['a dueDate before 2000', { dueDate: '1999-12-31', amountCents: 100 }],
      ['a zero amount', { amountCents: 0 }],
      ['a negative amount', { amountCents: -1 }],
      ['a fractional amount', { amountCents: 10.5 }],
      ['a string amount', { amountCents: '100' }],
      ['an amount above the ceiling', { amountCents: MAX_EXPENSE_CENTS + 1 }],
      ['an expenseId that is not a UUID', { expenseId: 'abc' }],
      ['an unknown field', { amountCents: 100, color: 'red' }],
      ['a userId in the body', { amountCents: 100, userId: MISSING }],
      ['an id in the body', { amountCents: 100, id: MISSING }],
    ])('rejects %s', async (_label, extra) => {
      const res = await http().post('/loans').set(...bearer(ana)).send({ ...base, ...extra });
      expect(res.status).toBe(400);
      expect(await loanCount()).toBe(0);
    });

    it('rejects a body without borrowerName or dueDate', async () => {
      for (const body of [{ amountCents: 100 }, { borrowerName: 'C', amountCents: 100 }, { dueDate: '2026-12-10', amountCents: 100 }]) {
        expect((await post(ana, body)).status).toBe(400);
      }
    });

    it('accepts the maximum amount', async () => {
      expect((await post(ana, { ...base, amountCents: MAX_EXPENSE_CENTS })).status).toBe(201);
    });

    it('rejects an empty PATCH, a PATCH with an immutable field and bad values', async () => {
      const { id } = (await lend(ana, 'Carlos', '2026-12-10')).body;
      for (const body of [
        {},
        { amountCents: 5 },
        { expenseId: MISSING },
        { userId: MISSING },
        { borrowerName: '' },
        { borrowerName: 'x'.repeat(101) },
        { dueDate: '1999-01-01' },
        { dueDate: 'tomorrow' },
      ]) {
        expect((await patch(ana, id, body)).status).toBe(400);
      }
      expect((await get(ana, id)).body).toMatchObject({ borrowerName: 'Carlos', amountCents: 1000 });
    });

    it('answers 400 to an id that is not a UUID', async () => {
      expect((await get(ana, 'abc')).status).toBe(400);
      expect((await patch(ana, 'abc', { borrowerName: 'X' })).status).toBe(400);
      expect((await del(ana, 'abc')).status).toBe(400);
    });
  });

  describe('authentication (401)', () => {
    it.each([
      ['POST /loans', () => http().post('/loans').send({})],
      ['GET /loans', () => http().get('/loans')],
      ['GET /loans/:id', () => http().get(`/loans/${MISSING}`)],
      ['PATCH /loans/:id', () => http().patch(`/loans/${MISSING}`).send({ borrowerName: 'X' })],
      ['DELETE /loans/:id', () => http().delete(`/loans/${MISSING}`)],
    ])('%s without a token', async (_route, call) => {
      expect((await call()).status).toBe(401);
    });
  });

  describe('not found (404) and conflict (409)', () => {
    it('hides the loans of other users: Bob and the admin get the same 404 as for a missing one', async () => {
      const { id } = (await lend(ana, 'Carlos', '2026-12-10')).body;
      for (const who of [bob, admin]) {
        for (const call of [
          (target: string) => get(who, target),
          (target: string) => patch(who, target, { borrowerName: 'Roubado' }),
          (target: string) => del(who, target),
        ]) {
          const foreign = await call(id);
          const missing = await call(MISSING);
          expect(missing.status).toBe(404);
          expect(foreign.status).toBe(404);
          expect(foreign.body).toEqual(missing.body);
        }
      }
      expect((await get(ana, id)).body).toMatchObject({ borrowerName: 'Carlos' });
    });

    it('answers 404 when lending against a missing expense or one of someone else', async () => {
      const bobExpense = await expense(bob);
      const missing = await post(ana, { borrowerName: 'C', dueDate: '2026-12-10', expenseId: MISSING });
      const foreign = await post(ana, { borrowerName: 'C', dueDate: '2026-12-10', expenseId: bobExpense });
      expect(missing.status).toBe(404);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
      expect((await post(admin, { borrowerName: 'C', dueDate: '2026-12-10', expenseId: bobExpense })).status).toBe(
        404,
      );
      expect(await loanCount()).toBe(0);
    });

    it('answers 409 when the expense already has a loan', async () => {
      const expenseId = await expense(ana);
      const body = { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId };
      expect((await post(ana, body)).status).toBe(201);
      const second = await post(ana, { ...body, borrowerName: 'Maria' });
      expect(second.status).toBe(409);
      expect(await loanCount()).toBe(1);
    });

    it('lets only one of two simultaneous loans from the same expense win', async () => {
      const expenseId = await expense(ana);
      const body = { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId };
      const results = await Promise.all([post(ana, body), post(ana, body), post(ana, body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await loanCount()).toBe(1);
    });

    it('answers 409 when deleting an expense that has a loan, and frees it after the loan goes', async () => {
      const expenseId = await expense(ana);
      const { id } = (await post(ana, { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId })).body;
      const blocked = await http().delete(`/expenses/${expenseId}`).set(...bearer(ana));
      expect(blocked.status).toBe(409);
      expect((await http().get(`/expenses/${expenseId}`).set(...bearer(ana))).status).toBe(200);
      await del(ana, id);
      expect((await http().delete(`/expenses/${expenseId}`).set(...bearer(ana))).status).toBe(204);
    });
  });
});
