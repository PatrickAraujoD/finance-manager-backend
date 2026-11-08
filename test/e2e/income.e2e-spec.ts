import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

describe('income endpoints', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;
  let bob: Session;

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
  });

  const http = () => request(t.app.getHttpServer());
  const put = (s: Session, month: string, body: unknown) =>
    http().put(`/income/${month}`).set(...bearer(s)).send(body as object);
  const get = (s: Session, month: string) => http().get(`/income/${month}`).set(...bearer(s));

  it('rejects every route without a token (401)', async () => {
    expect((await http().put('/income/2026-11').send({ amountCents: 100 })).status).toBe(401);
    expect((await http().get('/income/2026-11')).status).toBe(401);
  });

  it('rejects an invalid token (401)', async () => {
    const res = await http().get('/income/2026-11').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  describe('PUT then GET', () => {
    it('stores the income and answers with explicit fields only', async () => {
      const res = await put(ana, '2026-11', { amountCents: 500000 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ month: '2026-11', amountCents: 500000 });
      const read = await get(ana, '2026-11');
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ month: '2026-11', amountCents: 500000 });
    });

    it('overwrites the same month', async () => {
      await put(ana, '2026-11', { amountCents: 500000 });
      const res = await put(ana, '2026-11', { amountCents: 650000 });
      expect(res.status).toBe(200);
      expect((await get(ana, '2026-11')).body).toEqual({ month: '2026-11', amountCents: 650000 });
      expect(await t.prisma.client.monthlyIncome.count()).toBe(1);
    });

    it('answers 404 for a month without income', async () => {
      const res = await get(ana, '2026-11');
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('amountCents');
    });
  });

  describe('isolation between users', () => {
    it('each user only sees and overwrites their own income', async () => {
      await put(ana, '2026-11', { amountCents: 500000 });
      expect((await get(bob, '2026-11')).status).toBe(404);
      expect((await get(admin, '2026-11')).status).toBe(404);
      await put(bob, '2026-11', { amountCents: 999 });
      expect((await get(ana, '2026-11')).body.amountCents).toBe(500000);
      expect((await get(bob, '2026-11')).body.amountCents).toBe(999);
      expect(await t.prisma.client.monthlyIncome.count()).toBe(2);
    });

    it('has no way to target another user (extra userId in the body is rejected)', async () => {
      const res = await put(bob, '2026-11', { amountCents: 100, userId: ana.id });
      expect(res.status).toBe(400);
      expect(await t.prisma.client.monthlyIncome.count()).toBe(0);
    });
  });

  describe('month validation (400)', () => {
    it.each(['2026-13', '2026-00', '26-1', '2026-1', '2026-011', 'abcd-ef', '2026_11', '20261'])(
      'rejects %p on PUT and GET',
      async (month) => {
        expect((await put(ana, month, { amountCents: 100 })).status).toBe(400);
        expect((await get(ana, month)).status).toBe(400);
      },
    );

    it('rejects a month with a trailing space or newline', async () => {
      expect((await put(ana, '2026-11%20', { amountCents: 100 })).status).toBe(400);
      expect((await put(ana, '2026-11%0A', { amountCents: 100 })).status).toBe(400);
    });
  });

  describe('body validation (400)', () => {
    const bodies: [string, unknown][] = [
      ['a string amount', { amountCents: '1000' }],
      ['a float amount', { amountCents: 10.5 }],
      ['a negative amount', { amountCents: -100 }],
      ['a zero amount', { amountCents: 0 }],
      ['a gigantic amount', { amountCents: 100_000_000_001 }],
      ['an unsafe integer', { amountCents: 9007199254740993 }],
      ['a null amount', { amountCents: null }],
      ['a boolean amount', { amountCents: true }],
      ['an array amount', { amountCents: [100] }],
      ['a missing amount', {}],
      ['an extra field', { amountCents: 100, extra: 1 }],
      ['a month in the body', { amountCents: 100, month: '2026-12' }],
    ];
    it.each(bodies)('rejects %s', async (_label, body) => {
      const res = await put(ana, '2026-11', body);
      expect(res.status).toBe(400);
      expect(await t.prisma.client.monthlyIncome.count()).toBe(0);
    });

    it('accepts the documented maximum', async () => {
      const res = await put(ana, '2026-11', { amountCents: 100_000_000_000 });
      expect(res.status).toBe(200);
    });

    it('does not echo the stored value on rejection', async () => {
      await put(ana, '2026-11', { amountCents: 500000 });
      const res = await put(ana, '2026-11', { amountCents: -1 });
      expect(res.status).toBe(400);
      expect((await get(ana, '2026-11')).body.amountCents).toBe(500000);
    });
  });
});
