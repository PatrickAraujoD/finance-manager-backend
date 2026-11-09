import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { MAX_EXPENSE_CENTS } from '../../src/domain/entities/expense';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const MISSING = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

/** `YYYY-MM-DD` of today (UTC) plus `days`, from the real clock the app uses. */
function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('expenses endpoints', () => {
  let t: TestApp;
  let uploadDir: string;
  let admin: Session;
  let ana: Session;
  let bob: Session;
  let global: string;
  let anaCat: string;
  let bobCat: string;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'fm-e2e-expenses-'));
    t = await startApp({ uploadDir });
  });
  afterAll(async () => {
    await t.close();
    await rm(uploadDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
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
  const post = (s: Session, body: object) => http().post('/expenses').set(...bearer(s)).send(body);
  const get = (s: Session, id: string) => http().get(`/expenses/${id}`).set(...bearer(s));
  const patch = (s: Session, id: string, body: object) =>
    http().patch(`/expenses/${id}`).set(...bearer(s)).send(body);
  const del = (s: Session, id: string) => http().delete(`/expenses/${id}`).set(...bearer(s));
  const list = (s: Session, query = '') => http().get(`/expenses${query}`).set(...bearer(s));

  const valid = () => ({
    categoryId: global,
    amountCents: 2550,
    paidAlone: true,
    paymentMethod: 'PIX',
    spentAt: '2026-11-05',
  });

  async function receiptOf(s: Session): Promise<string> {
    const id = crypto.randomUUID();
    await t.prisma.client.receipt.create({
      data: { id, userId: s.id, storageKey: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 9 },
    });
    return id;
  }

  async function expectNoExpenses(): Promise<void> {
    expect(await t.prisma.client.expense.count()).toBe(0);
  }

  it('rejects every route without a token (401)', async () => {
    expect((await http().post('/expenses').send(valid())).status).toBe(401);
    expect((await http().get('/expenses')).status).toBe(401);
    expect((await http().get(`/expenses/${MISSING}`)).status).toBe(401);
    expect((await http().patch(`/expenses/${MISSING}`).send({ amountCents: 1 })).status).toBe(401);
    expect((await http().delete(`/expenses/${MISSING}`)).status).toBe(401);
  });

  describe('POST /expenses', () => {
    it('creates a manual expense (201 {id}) and reads it back with explicit fields', async () => {
      const res = await post(ana, { ...valid(), description: 'Almoço' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      const read = await get(ana, res.body.id);
      expect(read.status).toBe(200);
      expect(Object.keys(read.body).sort()).toEqual(
        [
          'amountCents',
          'categoryId',
          'createdAt',
          'description',
          'id',
          'paidAlone',
          'paymentMethod',
          'receiptId',
          'spentAt',
        ].sort(),
      );
      expect(read.body).toMatchObject({
        id: res.body.id,
        categoryId: global,
        receiptId: null,
        amountCents: 2550,
        paidAlone: true,
        paymentMethod: 'PIX',
        spentAt: '2026-11-05',
        description: 'Almoço',
      });
      expect(typeof read.body.amountCents).toBe('number');
      expect(Number.isNaN(Date.parse(read.body.createdAt))).toBe(false);
    });

    it('accepts a personal category, paidAlone=false without a receipt, and no description', async () => {
      const res = await post(ana, { ...valid(), categoryId: anaCat, paidAlone: false });
      expect(res.status).toBe(201);
      expect((await get(ana, res.body.id)).body).toMatchObject({
        categoryId: anaCat,
        paidAlone: false,
        description: null,
      });
    });

    it.each(['CREDIT', 'DEBIT', 'PIX'])('stores and returns the payment method %s', async (paymentMethod) => {
      const res = await post(ana, { ...valid(), paymentMethod });
      expect(res.status).toBe(201);
      expect((await get(ana, res.body.id)).body.paymentMethod).toBe(paymentMethod);
    });

    it('requires the payment method (400)', async () => {
      const { paymentMethod: _omit, ...rest } = valid();
      void _omit;
      expect((await post(ana, rest)).status).toBe(400);
      await expectNoExpenses();
    });

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['an unknown method', 'CASH'],
      ['lowercase', 'pix'],
      ['a number', 1],
      ['an array', ['PIX']],
      ['an object', { a: 1 }],
    ])('rejects a payment method that is %s (400)', async (_l, paymentMethod) => {
      expect((await post(ana, { ...valid(), paymentMethod })).status).toBe(400);
      await expectNoExpenses();
    });

    it('accepts the largest amount and one cent', async () => {
      expect((await post(ana, { ...valid(), amountCents: MAX_EXPENSE_CENTS })).status).toBe(201);
      expect((await post(ana, { ...valid(), amountCents: 1 })).status).toBe(201);
    });

    it('requires amountCents even when paidAlone is false (400)', async () => {
      const { amountCents: _omit, ...rest } = valid();
      void _omit;
      expect((await post(ana, { ...rest, paidAlone: false })).status).toBe(400);
      expect((await post(ana, rest)).status).toBe(400);
      await expectNoExpenses();
    });

    it.each([
      ['zero', 0],
      ['negative', -100],
      ['a string', '2550'],
      ['a float', 10.5],
      ['null', null],
      ['a boolean', true],
      ['an array', [1]],
      ['an object', { a: 1 }],
      ['above the maximum', MAX_EXPENSE_CENTS + 1],
      ['huge', 1e21],
      ['beyond the safe range', Number.MAX_SAFE_INTEGER + 2],
    ])('rejects amountCents that is %s (400)', async (_label, amountCents) => {
      expect((await post(ana, { ...valid(), amountCents })).status).toBe(400);
      await expectNoExpenses();
    });

    it('rejects a gigantic integer literal sent as raw JSON (400)', async () => {
      const res = await http()
        .post('/expenses')
        .set(...bearer(ana))
        .set('Content-Type', 'application/json')
        .send(
          `{"categoryId":"${global}","amountCents":99999999999999999999999,"paidAlone":true,"paymentMethod":"PIX","spentAt":"2026-11-05"}`,
        );
      expect(res.status).toBe(400);
      await expectNoExpenses();
    });

    it.each(['2026-02-30', '2026-13-01', '26-1-1', '2026-11-5', '', 'hoje', '2026-11-05T10:00:00Z', 20261105, null])(
      'rejects the invalid spentAt %p (400)',
      async (spentAt) => {
        expect((await post(ana, { ...valid(), spentAt })).status).toBe(400);
        await expectNoExpenses();
      },
    );

    it('allows today and tomorrow (UTC) but rejects dates further in the future', async () => {
      expect((await post(ana, { ...valid(), spentAt: dayFromToday(0) })).status).toBe(201);
      expect((await post(ana, { ...valid(), spentAt: dayFromToday(1) })).status).toBe(201);
      expect((await post(ana, { ...valid(), spentAt: dayFromToday(2) })).status).toBe(400);
      expect((await post(ana, { ...valid(), spentAt: '2999-01-01' })).status).toBe(400);
    });

    it.each([
      ['missing', undefined],
      ['a string', 'true'],
      ['null', null],
      ['a number', 1],
    ])('rejects paidAlone that is %s (400)', async (_l, paidAlone) => {
      expect((await post(ana, { ...valid(), paidAlone })).status).toBe(400);
    });

    it.each([
      ['null', null],
      ['a number', 5],
      ['501 characters', 'a'.repeat(501)],
      ['a NUL character', 'a\u0000b'],
      ['a lone surrogate', 'a\ud800b'],
    ])('rejects a description that is %s (400)', async (_l, description) => {
      expect((await post(ana, { ...valid(), description })).status).toBe(400);
      await expectNoExpenses();
    });

    it('rejects mass assignment of userId, id, createdAt and unknown fields (400)', async () => {
      for (const extra of [
        { userId: bob.id },
        { id: MISSING },
        { createdAt: '2000-01-01T00:00:00Z' },
        { role: 'A' },
      ]) {
        const res = await post(ana, { ...valid(), ...extra });
        expect(res.status).toBe(400);
      }
      await expectNoExpenses();
    });

    it('rejects a malformed categoryId or receiptId (400)', async () => {
      expect((await post(ana, { ...valid(), categoryId: 'abc' })).status).toBe(400);
      expect((await post(ana, { ...valid(), categoryId: null })).status).toBe(400);
      expect((await post(ana, { ...valid(), receiptId: 'abc' })).status).toBe(400);
      expect((await post(ana, { ...valid(), receiptId: null })).status).toBe(400);
      expect((await post(ana, { ...valid(), categoryId: undefined })).status).toBe(400);
    });

    it('answers 404 for a category of another user or one that does not exist', async () => {
      const other = await post(ana, { ...valid(), categoryId: bobCat });
      const missing = await post(ana, { ...valid(), categoryId: MISSING });
      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.body).toEqual(missing.body);
      await expectNoExpenses();
    });

    it('answers 404 for a receipt of another user or one that does not exist', async () => {
      const bobReceipt = await receiptOf(bob);
      const other = await post(ana, { ...valid(), receiptId: bobReceipt });
      const missing = await post(ana, { ...valid(), receiptId: MISSING });
      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.body).toEqual(missing.body);
      // Not even an admin can attach someone else's receipt.
      expect((await post(admin, { ...valid(), receiptId: bobReceipt })).status).toBe(404);
      await expectNoExpenses();
    });

    it('answers 409 when the receipt already backs another expense, leaving the first intact', async () => {
      const receiptId = await receiptOf(ana);
      const first = await post(ana, { ...valid(), receiptId, amountCents: 111 });
      expect(first.status).toBe(201);
      const second = await post(ana, { ...valid(), receiptId, amountCents: 222 });
      expect(second.status).toBe(409);
      expect(await t.prisma.client.expense.count()).toBe(1);
      expect((await get(ana, first.body.id)).body.amountCents).toBe(111);
    });

    it('lets exactly one of two simultaneous requests use a receipt', async () => {
      const receiptId = await receiptOf(ana);
      const [a, b] = await Promise.all([
        post(ana, { ...valid(), receiptId }),
        post(ana, { ...valid(), receiptId }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await t.prisma.client.expense.count()).toBe(1);
    });

    it('does not accept a body that is not JSON', async () => {
      const res = await http()
        .post('/expenses')
        .set(...bearer(ana))
        .set('Content-Type', 'text/plain')
        .send('hello');
      expect(res.status).toBe(400);
    });
  });

  describe('full flow: upload, suggestion, corrected amount', () => {
    it('saves the amount the user typed, not the one suggested from the receipt', async () => {
      const upload = await http()
        .post('/receipts')
        .set(...bearer(ana))
        .field('paidAlone', 'true')
        .attach('file', await readFile(join(__dirname, '..', 'fixtures', 'comprovante-texto.pdf')), {
          filename: 'c.pdf',
          contentType: 'application/pdf',
        });
      expect(upload.status).toBe(201);
      expect(upload.body.suggestedAmountCents).toBe(12345);

      const created = await post(ana, {
        ...valid(),
        receiptId: upload.body.receiptId,
        amountCents: 12000,
      });
      expect(created.status).toBe(201);
      const read = await get(ana, created.body.id);
      expect(read.body.amountCents).toBe(12000);
      expect(read.body.receiptId).toBe(upload.body.receiptId);

      // The receipt cannot back a second expense.
      expect(
        (await post(ana, { ...valid(), receiptId: upload.body.receiptId })).status,
      ).toBe(409);
    }, 60_000);
  });

  describe('isolation', () => {
    it('answers identical 404s for GET, PATCH and DELETE of an expense of someone else', async () => {
      const { id } = (await post(ana, valid())).body;
      for (const other of [bob, admin]) {
        const missing = {
          get: await get(other, MISSING),
          patch: await patch(other, MISSING, { amountCents: 1 }),
          del: await del(other, MISSING),
        };
        const real = {
          get: await get(other, id),
          patch: await patch(other, id, { amountCents: 1 }),
          del: await del(other, id),
        };
        for (const k of ['get', 'patch', 'del'] as const) {
          expect(real[k].status).toBe(404);
          expect(real[k].body).toEqual(missing[k].body);
        }
      }
      const intact = await get(ana, id);
      expect(intact.status).toBe(200);
      expect(intact.body.amountCents).toBe(2550);
    });

    it('lists only the own expenses, admins included', async () => {
      await post(ana, valid());
      await post(bob, valid());
      expect((await list(ana)).body.total).toBe(1);
      expect((await list(bob)).body.total).toBe(1);
      expect(await list(admin)).toMatchObject({ status: 200, body: { items: [], total: 0 } });
    });
  });

  describe('PATCH /expenses/:id', () => {
    it('changes only the sent fields and answers the explicit view', async () => {
      const receiptId = await receiptOf(ana);
      const { id } = (await post(ana, { ...valid(), receiptId, description: 'a' })).body;
      const before = (await get(ana, id)).body;
      const res = await patch(ana, id, { amountCents: 999, categoryId: anaCat });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...before, amountCents: 999, categoryId: anaCat });
      expect((await get(ana, id)).body).toEqual(res.body);
    });

    it('updates the date, paidAlone and description', async () => {
      const { id } = (await post(ana, { ...valid(), description: 'a' })).body;
      const res = await patch(ana, id, { spentAt: '2026-10-31', paidAlone: false, description: '' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ spentAt: '2026-10-31', paidAlone: false, description: null });
    });

    it('changes the payment method and keeps it when not sent', async () => {
      const { id } = (await post(ana, { ...valid(), paymentMethod: 'CREDIT' })).body;
      const res = await patch(ana, id, { paymentMethod: 'DEBIT' });
      expect(res.status).toBe(200);
      expect(res.body.paymentMethod).toBe('DEBIT');
      expect((await get(ana, id)).body.paymentMethod).toBe('DEBIT');
      expect((await patch(ana, id, { amountCents: 5 })).body.paymentMethod).toBe('DEBIT');
    });

    it('needs at least one field (400)', async () => {
      const { id } = (await post(ana, valid())).body;
      expect((await patch(ana, id, {})).status).toBe(400);
    });

    it('refuses userId, receiptId, id and createdAt (400) and changes nothing', async () => {
      const receiptId = await receiptOf(ana);
      const other = await receiptOf(ana);
      const { id } = (await post(ana, { ...valid(), receiptId })).body;
      for (const body of [
        { userId: bob.id },
        { receiptId: other },
        { receiptId: null },
        { id: MISSING },
        { createdAt: '2000-01-01T00:00:00Z' },
        { amountCents: 5, userId: bob.id },
      ]) {
        expect((await patch(ana, id, body)).status).toBe(400);
      }
      const read = (await get(ana, id)).body;
      expect(read.amountCents).toBe(2550);
      expect(read.receiptId).toBe(receiptId);
    });

    it.each([
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: '5' },
      { amountCents: 1.5 },
      { amountCents: null },
      { amountCents: MAX_EXPENSE_CENTS + 1 },
      { spentAt: '2026-02-30' },
      { spentAt: dayFromToday(3) },
      { categoryId: 'abc' },
      { paidAlone: 'no' },
      { paymentMethod: null },
      { paymentMethod: 'CASH' },
      { paymentMethod: 'pix' },
      { paymentMethod: 1 },
      { description: null },
      { description: 'a'.repeat(501) },
    ])('rejects the invalid change %j (400)', async (body) => {
      const { id } = (await post(ana, valid())).body;
      expect((await patch(ana, id, body)).status).toBe(400);
      expect((await get(ana, id)).body.amountCents).toBe(2550);
    });

    it('answers 404 for a category of someone else and 400 for a malformed id', async () => {
      const { id } = (await post(ana, valid())).body;
      expect((await patch(ana, id, { categoryId: bobCat })).status).toBe(404);
      expect((await patch(ana, 'not-a-uuid', { amountCents: 1 })).status).toBe(400);
    });
  });

  describe('DELETE /expenses/:id', () => {
    it('answers 204, then 404, and keeps the receipt and its file reachable', async () => {
      const upload = await http()
        .post('/receipts')
        .set(...bearer(ana))
        .field('paidAlone', 'false')
        .attach('file', await readFile(join(__dirname, '..', 'fixtures', 'comprovante-texto.pdf')), {
          filename: 'c.pdf',
          contentType: 'application/pdf',
        });
      const { id } = (await post(ana, { ...valid(), receiptId: upload.body.receiptId })).body;
      const res = await del(ana, id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect((await get(ana, id)).status).toBe(404);
      expect((await del(ana, id)).status).toBe(404);
      const file = await http().get(`/receipts/${upload.body.receiptId}/file`).set(...bearer(ana));
      expect(file.status).toBe(200);
      // The freed receipt can back a new expense.
      expect((await post(ana, { ...valid(), receiptId: upload.body.receiptId })).status).toBe(201);
    }, 60_000);

    it('answers 400 for a malformed id', async () => {
      expect((await del(ana, 'nope')).status).toBe(400);
      expect((await get(ana, 'nope')).status).toBe(400);
    });
  });

  describe('GET /expenses', () => {
    async function seed() {
      const ids: Record<string, string> = {};
      const add = async (key: string, spentAt: string, categoryId = global) => {
        ids[key] = (await post(ana, { ...valid(), spentAt, categoryId })).body.id;
      };
      await add('a', '2026-11-01');
      await add('b', '2026-11-05');
      await add('c', '2026-11-05');
      await add('d', '2026-10-20', anaCat);
      return ids;
    }

    it('returns items, total, limit and offset, newest first with a stable tie-break', async () => {
      const ids = await seed();
      const res = await list(ana);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(res.body.limit).toBe(100);
      expect(res.body.offset).toBe(0);
      const sameDay = [ids.b, ids.c].sort().reverse();
      expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([
        ...sameDay,
        ids.a,
        ids.d,
      ]);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          'amountCents',
          'categoryId',
          'createdAt',
          'description',
          'id',
          'paidAlone',
          'paymentMethod',
          'receiptId',
          'spentAt',
        ].sort(),
      );
      const again = await list(ana);
      expect(again.body.items.map((e: { id: string }) => e.id)).toEqual(
        res.body.items.map((e: { id: string }) => e.id),
      );
    });

    it('filters by payment method and rejects an invalid one (400)', async () => {
      for (const paymentMethod of ['CREDIT', 'DEBIT', 'PIX', 'PIX']) {
        await post(ana, { ...valid(), paymentMethod });
      }
      await post(bob, { ...valid(), paymentMethod: 'CREDIT' });
      const only = async (m: string) => (await list(ana, `?paymentMethod=${m}`)).body;
      expect((await only('CREDIT')).total).toBe(1);
      expect((await only('DEBIT')).total).toBe(1);
      const pix = await only('PIX');
      expect(pix.total).toBe(2);
      expect(pix.items.every((e: { paymentMethod: string }) => e.paymentMethod === 'PIX')).toBe(true);
      expect((await list(ana, '?paymentMethod=PIX&limit=1')).body).toMatchObject({ total: 2 });
      for (const bad of ['CASH', 'pix', '', 'PIX&paymentMethod=CREDIT']) {
        expect((await list(ana, `?paymentMethod=${bad}`)).status).toBe(400);
      }
    });

    it('filters by inclusive dates and by category', async () => {
      await seed();
      expect((await list(ana, '?from=2026-11-01&to=2026-11-05')).body.total).toBe(3);
      expect((await list(ana, '?from=2026-11-05&to=2026-11-05')).body.total).toBe(2);
      expect((await list(ana, '?from=2026-11-02')).body.total).toBe(2);
      expect((await list(ana, '?to=2026-10-31')).body.total).toBe(1);
      expect((await list(ana, `?categoryId=${anaCat}`)).body.total).toBe(1);
      expect((await list(ana, `?categoryId=${bobCat}`)).body.total).toBe(0);
    });

    it('pages and keeps the total of the whole filtered set', async () => {
      await seed();
      const page = await list(ana, '?limit=2&offset=1');
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBe(4);
      expect(page.body.limit).toBe(2);
      expect(page.body.offset).toBe(1);
      expect((await list(ana, '?offset=10')).body.items).toEqual([]);
      expect((await list(ana, '?limit=200&offset=100000')).status).toBe(200);
    });

    it.each([
      '?limit=0',
      '?limit=201',
      '?limit=-1',
      '?limit=abc',
      '?limit=1.5',
      '?limit=',
      '?limit=1&limit=2',
      '?offset=-1',
      '?offset=100001',
      '?offset=abc',
      '?from=2026-02-30',
      '?to=26-1-1',
      '?from=2026-11-06&to=2026-11-05',
      '?categoryId=abc',
      '?userId=x',
      '?sort=asc',
    ])('rejects the query %s (400)', async (query) => {
      expect((await list(ana, query)).status).toBe(400);
    });
  });

  describe('deleting a category in use', () => {
    it('is blocked with 409 and keeps the expense; works once the expense is gone', async () => {
      const { id } = (await post(ana, { ...valid(), categoryId: anaCat })).body;
      const blocked = await http().delete(`/categories/${anaCat}`).set(...bearer(ana));
      expect(blocked.status).toBe(409);
      expect((await get(ana, id)).body.categoryId).toBe(anaCat);
      expect(await t.prisma.client.expense.count()).toBe(1);

      // Same for a global category used by an expense (admin deleting it).
      await post(ana, valid());
      const blockedGlobal = await http().delete(`/categories/${global}`).set(...bearer(admin));
      expect(blockedGlobal.status).toBe(409);
      expect(await t.prisma.client.expense.count()).toBe(2);

      await del(ana, id);
      const ok = await http().delete(`/categories/${anaCat}`).set(...bearer(ana));
      expect(ok.status).toBe(204);
    });
  });
});
