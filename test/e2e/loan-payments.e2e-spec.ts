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

const PAYMENT_FIELDS = ['amountCents', 'createdAt', 'id', 'loanId', 'method', 'paidAt', 'receiptId'];

describe('loan payments endpoints', () => {
  let t: TestApp;
  let uploadDir: string;
  let admin: Session;
  let ana: Session;
  let bob: Session;
  let global: string;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'fm-e2e-loan-payments-'));
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
    global = (
      await http().post('/categories').set(...bearer(admin)).send({ name: 'Mercado', global: true })
    ).body.id;
  });

  const http = () => request(t.app.getHttpServer());
  const lend = async (s: Session, amountCents = 10_000, dueDate = dayFromToday(30)): Promise<string> =>
    (
      await http()
        .post('/loans')
        .set(...bearer(s))
        .send({ borrowerName: 'Carlos', dueDate, amountCents })
    ).body.id;
  const loan = (s: Session, id: string) => http().get(`/loans/${id}`).set(...bearer(s));
  const pay = (s: Session, id: string, body: object) =>
    http().post(`/loans/${id}/payments`).set(...bearer(s)).send(body);
  const cash = (s: Session, id: string, amountCents: number, paidAt = dayFromToday(0)) =>
    pay(s, id, { amountCents, method: 'CASH', paidAt });
  const pix = (s: Session, id: string, receiptId: string, amountCents: number, paidAt = dayFromToday(0)) =>
    pay(s, id, { amountCents, method: 'PIX', paidAt, receiptId });
  const payments = (s: Session, id: string) => http().get(`/loans/${id}/payments`).set(...bearer(s));
  async function upload(s: Session): Promise<string> {
    const res = await http()
      .post('/receipts')
      .set(...bearer(s))
      .field('paidAlone', 'true')
      .attach('file', await readFile(join(__dirname, '..', 'fixtures', 'comprovante-texto.pdf')), {
        filename: 'c.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    return res.body.receiptId;
  }
  const paymentCount = () => t.prisma.client.loanPayment.count();

  describe('full flow', () => {
    it('lends, pays part in cash, pays the rest by pix with a real uploaded receipt', async () => {
      const id = await lend(ana, 10_000);

      const first = await cash(ana, id, 2_500, dayFromToday(-2));
      expect(first.status).toBe(201);
      expect(Object.keys(first.body)).toEqual(['id']);
      expect((await loan(ana, id)).body).toMatchObject({
        paidCents: 2_500,
        remainingCents: 7_500,
        status: 'OPEN',
      });

      const receiptId = await upload(ana);
      const second = await pix(ana, id, receiptId, 7_500);
      expect(second.status).toBe(201);
      expect((await loan(ana, id)).body).toMatchObject({
        paidCents: 10_000,
        remainingCents: 0,
        status: 'PAID',
      });

      const listed = await payments(ana, id);
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(2);
      expect(Object.keys(listed.body[0]).sort()).toEqual(PAYMENT_FIELDS);
      expect(listed.body[0]).toMatchObject({
        id: first.body.id,
        loanId: id,
        amountCents: 2_500,
        method: 'CASH',
        receiptId: null,
        paidAt: dayFromToday(-2),
      });
      expect(listed.body[1]).toMatchObject({
        id: second.body.id,
        amountCents: 7_500,
        method: 'PIX',
        receiptId,
        paidAt: dayFromToday(0),
      });
      expect(JSON.stringify(listed.body)).not.toContain(ana.id);

      const paid = await http().get('/loans?status=PAID').set(...bearer(ana));
      expect(paid.body).toMatchObject({ total: 1 });
      expect(paid.body.items[0]).toMatchObject({ id, paidCents: 10_000, status: 'PAID' });
      expect((await http().get('/loans?status=OPEN').set(...bearer(ana))).body.total).toBe(0);
    });

    it('settles an overdue loan: it is OVERDUE with a balance and PAID once settled', async () => {
      const id = await lend(ana, 1_000, '2020-01-15');
      await cash(ana, id, 400);
      expect((await loan(ana, id)).body).toMatchObject({ remainingCents: 600, status: 'OVERDUE' });
      await cash(ana, id, 600);
      expect((await loan(ana, id)).body).toMatchObject({ remainingCents: 0, status: 'PAID' });
    });

    it('shows the paid amount in the list and keeps the loans of each user apart', async () => {
      const a = await lend(ana, 5_000);
      const b = await lend(bob, 5_000);
      await cash(ana, a, 1_000);
      await cash(bob, b, 4_000);
      expect((await http().get('/loans').set(...bearer(ana))).body.items[0].paidCents).toBe(1_000);
      expect((await http().get('/loans').set(...bearer(bob))).body.items[0].paidCents).toBe(4_000);
    });

    it('refuses to delete a loan that has payments, and deletes one that has none', async () => {
      const withPayment = await lend(ana);
      const empty = await lend(ana);
      await cash(ana, withPayment, 100);
      const blocked = await http().delete(`/loans/${withPayment}`).set(...bearer(ana));
      expect(blocked.status).toBe(409);
      expect((await loan(ana, withPayment)).status).toBe(200);
      expect(await paymentCount()).toBe(1);
      expect((await http().delete(`/loans/${empty}`).set(...bearer(ana))).status).toBe(204);
    });
  });

  describe('validation (400)', () => {
    const base = { amountCents: 100, method: 'CASH', paidAt: dayFromToday(0) };

    it.each([
      ['a missing amount', { amountCents: undefined }],
      ['a zero amount', { amountCents: 0 }],
      ['a negative amount', { amountCents: -1 }],
      ['a fractional amount', { amountCents: 1.5 }],
      ['a string amount', { amountCents: '100' }],
      ['an amount above the ceiling', { amountCents: MAX_EXPENSE_CENTS + 1 }],
      ['a missing method', { method: undefined }],
      ['a lowercase method', { method: 'cash' }],
      ['a method that is only for expenses', { method: 'CREDIT' }],
      ['a null method', { method: null }],
      ['a missing paidAt', { paidAt: undefined }],
      ['a non-existent paidAt', { paidAt: '2026-02-30' }],
      ['a paidAt with time', { paidAt: '2026-11-08T00:00:00Z' }],
      ['a paidAt before 2000', { paidAt: '1999-12-31' }],
      ['a paidAt too far in the future', { paidAt: dayFromToday(3) }],
      ['cash with a receipt', { receiptId: MISSING }],
      ['pix without a receipt', { method: 'PIX' }],
      ['pix with a null receipt', { method: 'PIX', receiptId: null }],
      ['a receiptId that is not a UUID', { method: 'PIX', receiptId: 'abc' }],
      ['an unknown field', { color: 'red' }],
      ['a userId in the body', { userId: MISSING }],
      ['a loanId in the body', { loanId: MISSING }],
      ['an id in the body', { id: MISSING }],
    ])('rejects %s', async (_label, extra) => {
      const id = await lend(ana);
      const res = await pay(ana, id, { ...base, ...extra });
      expect(res.status).toBe(400);
      expect(await paymentCount()).toBe(0);
    });

    it('answers 400 to a loan id that is not a UUID', async () => {
      expect((await cash(ana, 'abc', 100)).status).toBe(400);
      expect((await payments(ana, 'abc')).status).toBe(400);
    });

    it('accepts today, tomorrow (time zone slack) and a long past date', async () => {
      const id = await lend(ana);
      for (const paidAt of [dayFromToday(0), dayFromToday(1), '2000-01-01']) {
        expect((await cash(ana, id, 10, paidAt)).status).toBe(201);
      }
    });

    it('refuses a payment above the remaining balance with a clear message', async () => {
      const id = await lend(ana, 1_000);
      await cash(ana, id, 900);
      const res = await cash(ana, id, 101);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/remaining balance/);
      expect(await paymentCount()).toBe(1);
      expect((await loan(ana, id)).body.paidCents).toBe(900);
    });

    it('accepts the exact remaining balance and refuses anything after it', async () => {
      const id = await lend(ana, 1_000);
      expect((await cash(ana, id, 1_000)).status).toBe(201);
      expect((await cash(ana, id, 1)).status).toBe(400);
    });
  });

  describe('authentication (401)', () => {
    it.each([
      ['POST /loans/:id/payments', () => http().post(`/loans/${MISSING}/payments`).send({})],
      ['GET /loans/:id/payments', () => http().get(`/loans/${MISSING}/payments`)],
    ])('%s without a token', async (_route, call) => {
      expect((await call()).status).toBe(401);
    });
  });

  describe('not found (404)', () => {
    it('hides the loans of other users: Bob and the admin get the same 404 as for a missing one', async () => {
      const id = await lend(ana);
      await cash(ana, id, 100);
      for (const who of [bob, admin]) {
        for (const call of [
          (target: string) => cash(who, target, 100),
          (target: string) => payments(who, target),
        ]) {
          const foreign = await call(id);
          const missing = await call(MISSING);
          expect(missing.status).toBe(404);
          expect(foreign.status).toBe(404);
          expect(foreign.body).toEqual(missing.body);
        }
      }
      expect(await paymentCount()).toBe(1);
    });

    it('answers 404 alike for a missing receipt and for a receipt of someone else', async () => {
      const id = await lend(ana);
      const bobReceipt = await upload(bob);
      const missing = await pix(ana, id, MISSING, 100);
      const foreign = await pix(ana, id, bobReceipt, 100);
      const asAdmin = await pix(admin, id, bobReceipt, 100);
      expect(missing.status).toBe(404);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
      expect(asAdmin.status).toBe(404);
      expect(await paymentCount()).toBe(0);
    });
  });

  describe('conflicts (409)', () => {
    it('refuses a receipt that already backs a payment, and accepts another one', async () => {
      const id = await lend(ana);
      const receiptId = await upload(ana);
      expect((await pix(ana, id, receiptId, 100)).status).toBe(201);
      expect((await pix(ana, id, receiptId, 100)).status).toBe(409);
      expect(await paymentCount()).toBe(1);
      expect((await pix(ana, id, await upload(ana), 100)).status).toBe(201);
    });

    it('refuses a receipt that already backs an expense', async () => {
      const id = await lend(ana);
      const receiptId = await upload(ana);
      const expense = await http()
        .post('/expenses')
        .set(...bearer(ana))
        .send({
          receiptId,
          categoryId: global,
          amountCents: 4200,
          paidAlone: true,
          paymentMethod: 'PIX',
          spentAt: dayFromToday(0),
        });
      expect(expense.status).toBe(201);
      expect((await pix(ana, id, receiptId, 100)).status).toBe(409);
      expect(await paymentCount()).toBe(0);
    });

    it('refuses an expense whose receipt already backs a payment', async () => {
      const id = await lend(ana);
      const receiptId = await upload(ana);
      expect((await pix(ana, id, receiptId, 100)).status).toBe(201);
      const expense = await http()
        .post('/expenses')
        .set(...bearer(ana))
        .send({
          receiptId,
          categoryId: global,
          amountCents: 4200,
          paidAlone: true,
          paymentMethod: 'PIX',
          spentAt: dayFromToday(0),
        });
      expect(expense.status).toBe(409);
      expect(await t.prisma.client.expense.count()).toBe(0);
    });

    it('lets only one of two simultaneous payments with the same receipt win', async () => {
      const a = await lend(ana);
      const b = await lend(ana);
      const receiptId = await upload(ana);
      const results = await Promise.all([pix(ana, a, receiptId, 100), pix(ana, b, receiptId, 100)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await paymentCount()).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('never lets simultaneous payments overshoot the loan', async () => {
      const id = await lend(ana, 10_000);
      // 8 x 3000 against 10000: exactly three fit, the rest is refused with 400.
      const results = await Promise.all(Array.from({ length: 8 }, () => cash(ana, id, 3_000)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 400, 400, 400, 400, 400]);
      expect(await paymentCount()).toBe(3);
      expect((await loan(ana, id)).body).toMatchObject({ paidCents: 9_000, remainingCents: 1_000 });
    });

    it('lets simultaneous payments that exactly settle the loan pass, and no more', async () => {
      const id = await lend(ana, 10_000);
      const results = await Promise.all(Array.from({ length: 10 }, () => cash(ana, id, 1_000)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      const extra = await Promise.all([cash(ana, id, 1), cash(ana, id, 1)]);
      expect(extra.map((r) => r.status)).toEqual([400, 400]);
      expect((await loan(ana, id)).body.status).toBe('PAID');
    });
  });
});
