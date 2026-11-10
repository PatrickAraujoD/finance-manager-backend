import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { bearer, PASSWORD, Session, signUp } from './support/auth-helpers';
import { listRoutes } from './support/routes';
import { ACCESS_SECRET, cleanTables, startApp, TestApp } from './support/test-app';

/**
 * Authorization matrix driven by the route inventory. Every route registered in the app must be
 * declared in ROUTES below; adding a route without declaring it (and therefore without deciding
 * how it is covered) fails the first test on purpose.
 *
 * kind:   public | private (any authenticated user) | admin (@Roles('A'))
 * scope:  none  - no resource of another user can be named
 *         self  - always the caller's own data, nothing to name (checked in SELF)
 *         by-id - names a resource that can belong to someone else (checked in OWNED)
 */
type Kind = 'public' | 'private' | 'admin';
type Scope = 'none' | 'self' | 'by-id';
const ROUTES: Record<string, { kind: Kind; scope: Scope }> = {
  'GET /health': { kind: 'public', scope: 'none' },
  'POST /auth/register': { kind: 'public', scope: 'none' },
  'POST /auth/login': { kind: 'public', scope: 'none' },
  'POST /auth/refresh': { kind: 'public', scope: 'none' },
  'POST /auth/logout': { kind: 'public', scope: 'none' },
  'GET /auth/me': { kind: 'private', scope: 'self' },
  'GET /users': { kind: 'admin', scope: 'none' },
  'PATCH /users/:id': { kind: 'admin', scope: 'none' },
  'GET /categories': { kind: 'private', scope: 'self' },
  'POST /categories': { kind: 'private', scope: 'none' },
  'PATCH /categories/:id': { kind: 'private', scope: 'by-id' },
  'DELETE /categories/:id': { kind: 'private', scope: 'by-id' },
  'PUT /income/:month': { kind: 'private', scope: 'self' },
  'GET /income/:month': { kind: 'private', scope: 'self' },
  'POST /receipts': { kind: 'private', scope: 'none' },
  'GET /receipts/:id/file': { kind: 'private', scope: 'by-id' },
  'POST /expenses': { kind: 'private', scope: 'by-id' },
  'GET /expenses': { kind: 'private', scope: 'self' },
  'GET /expenses/:id': { kind: 'private', scope: 'by-id' },
  'PATCH /expenses/:id': { kind: 'private', scope: 'by-id' },
  'DELETE /expenses/:id': { kind: 'private', scope: 'by-id' },
  'POST /loans': { kind: 'private', scope: 'by-id' },
  'GET /loans': { kind: 'private', scope: 'self' },
  'GET /loans/summary': { kind: 'private', scope: 'self' },
  'GET /loans/:id': { kind: 'private', scope: 'by-id' },
  'PATCH /loans/:id': { kind: 'private', scope: 'by-id' },
  'DELETE /loans/:id': { kind: 'private', scope: 'by-id' },
  'POST /loans/:id/payments': { kind: 'private', scope: 'by-id' },
  'GET /loans/:id/payments': { kind: 'private', scope: 'by-id' },
  'GET /reports/by-category': { kind: 'private', scope: 'self' },
  'GET /reports/by-day': { kind: 'private', scope: 'self' },
  'GET /reports/monthly-evolution': { kind: 'private', scope: 'self' },
  'GET /reports/income-vs-spent': { kind: 'private', scope: 'self' },
  'GET /reports/card': { kind: 'private', scope: 'self' },
};

const MONTH = '2026-11';
const OTHER_MONTH = '2026-10';

interface World {
  admin: Session;
  ana: Session;
  bia: Session;
  dead: Session;
  globalCategory: string;
  bCategory: string;
  bExpense: string;
  bLoan: string;
  bReceipt: string;
}

describe('authorization matrix', () => {
  let t: TestApp;
  let w: World;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    const admin = await signUp(t, 'admin@example.com', 'A');
    const ana = await signUp(t, 'ana@example.com');
    const bia = await signUp(t, 'bia@example.com');
    const dead = await signUp(t, 'dead@example.com');
    const globalCategory = (await post('/categories', admin, { name: 'Mercado', global: true })).body.id;
    const bCategory = (await post('/categories', bia, { name: 'Segredo da Bia' })).body.id;
    const bExpense = (
      await post('/expenses', bia, {
        categoryId: bCategory,
        amountCents: 4200,
        paidAlone: true,
        paymentMethod: 'PIX',
        spentAt: '2026-11-03',
        description: 'gasto da bia',
      })
    ).body.id;
    const bLoan = (
      await post('/loans', bia, { borrowerName: 'Devedor da Bia', dueDate: '2026-12-10', amountCents: 7700, paymentMethod: 'PIX', lentAt: '2026-11-03' })
    ).body.id;
    const bReceipt = randomUUID();
    await t.prisma.client.receipt.create({
      data: { id: bReceipt, userId: bia.id, storageKey: randomUUID(), mimeType: 'application/pdf', sizeBytes: 10 },
    });
    await request(t.app.getHttpServer())
      .put(`/income/${MONTH}`)
      .set(...bearer(bia))
      .send({ amountCents: 900_000 });
    await t.prisma.client.user.update({ where: { id: dead.id }, data: { active: false } });
    w = { admin, ana, bia, dead, globalCategory, bCategory, bExpense, bLoan, bReceipt };
  });

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, s: Session, body: object) => http().post(path).set(...bearer(s)).send(body);

  type Auth = string | null;
  const withAuth = (req: request.Test, auth: Auth) =>
    auth === null ? req : req.set('Authorization', auth);
  const asBearer = (s: Session): Auth => `Bearer ${s.accessToken}`;

  /** A request to each protected route; guards run first, so the payloads need not be valid. */
  const REQUESTS: Record<string, (auth: Auth) => request.Test> = {
    'GET /auth/me': (a) => withAuth(http().get('/auth/me'), a),
    'GET /users': (a) => withAuth(http().get('/users'), a),
    'PATCH /users/:id': (a) => withAuth(http().patch(`/users/${w.bia.id}`), a).send({ active: true }),
    'GET /categories': (a) => withAuth(http().get('/categories'), a),
    'POST /categories': (a) => withAuth(http().post('/categories'), a).send({ name: 'Nova' }),
    'PATCH /categories/:id': (a) => withAuth(http().patch(`/categories/${randomUUID()}`), a).send({ name: 'N' }),
    'DELETE /categories/:id': (a) => withAuth(http().delete(`/categories/${randomUUID()}`), a),
    'PUT /income/:month': (a) => withAuth(http().put(`/income/${MONTH}`), a).send({ amountCents: 1 }),
    'GET /income/:month': (a) => withAuth(http().get(`/income/${MONTH}`), a),
    'POST /receipts': (a) =>
      withAuth(http().post('/receipts'), a)
        .field('paidAlone', 'true')
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' }),
    'GET /receipts/:id/file': (a) => withAuth(http().get(`/receipts/${randomUUID()}/file`), a),
    'POST /expenses': (a) => withAuth(http().post('/expenses'), a).send({}),
    'GET /expenses': (a) => withAuth(http().get('/expenses'), a),
    'GET /expenses/:id': (a) => withAuth(http().get(`/expenses/${randomUUID()}`), a),
    'PATCH /expenses/:id': (a) => withAuth(http().patch(`/expenses/${randomUUID()}`), a).send({ description: 'x' }),
    'DELETE /expenses/:id': (a) => withAuth(http().delete(`/expenses/${randomUUID()}`), a),
    'POST /loans': (a) => withAuth(http().post('/loans'), a).send({}),
    'GET /loans': (a) => withAuth(http().get('/loans'), a),
    'GET /loans/summary': (a) => withAuth(http().get('/loans/summary'), a),
    'GET /loans/:id': (a) => withAuth(http().get(`/loans/${randomUUID()}`), a),
    'PATCH /loans/:id': (a) => withAuth(http().patch(`/loans/${randomUUID()}`), a).send({ borrowerName: 'X' }),
    'DELETE /loans/:id': (a) => withAuth(http().delete(`/loans/${randomUUID()}`), a),
    'POST /loans/:id/payments': (a) => withAuth(http().post(`/loans/${randomUUID()}/payments`), a).send({}),
    'GET /loans/:id/payments': (a) => withAuth(http().get(`/loans/${randomUUID()}/payments`), a),
    'GET /reports/by-category': (a) => withAuth(http().get(`/reports/by-category?month=${MONTH}`), a),
    'GET /reports/by-day': (a) => withAuth(http().get(`/reports/by-day?month=${MONTH}`), a),
    'GET /reports/monthly-evolution': (a) =>
      withAuth(http().get('/reports/monthly-evolution?from=2026-01&to=2026-03'), a),
    'GET /reports/income-vs-spent': (a) => withAuth(http().get(`/reports/income-vs-spent?month=${MONTH}`), a),
    'GET /reports/card': (a) => withAuth(http().get(`/reports/card?month=${MONTH}`), a),
  };

  const protectedRoutes = Object.entries(ROUTES).filter(([, r]) => r.kind !== 'public').map(([k]) => k);

  /** Headers that legitimately differ between two otherwise identical responses. */
  const stable = (headers: Record<string, unknown>) => {
    const h = { ...headers };
    delete h['date'];
    // The remaining-requests counters go down with every request by design, and the reset
    // countdown moves with the clock (it can differ by a second between two requests).
    for (const k of Object.keys(h)) {
      if (k.startsWith('x-ratelimit-remaining') || k.startsWith('x-ratelimit-reset')) delete h[k];
    }
    return h;
  };
  const same = (a: request.Response, b: request.Response) => {
    expect(a.status).toBe(b.status);
    expect(Buffer.from(a.text)).toEqual(Buffer.from(b.text));
    expect(stable(a.headers)).toEqual(stable(b.headers));
  };

  describe('inventory', () => {
    it('declares every registered route, and nothing else (add new routes to ROUTES)', () => {
      const registered = listRoutes(t).map((r) => r.route).sort();
      expect(registered).toEqual(Object.keys(ROUTES).sort());
    });

    it('matches the declared kind with the real metadata (public / @Roles)', () => {
      for (const r of listRoutes(t)) {
        const declared = ROUTES[r.route];
        expect(declared).toBeDefined();
        expect(`${r.route}:${r.isPublic}`).toBe(`${r.route}:${declared.kind === 'public'}`);
        expect(`${r.route}:${r.roles.join()}`).toBe(`${r.route}:${declared.kind === 'admin' ? 'A' : ''}`);
      }
    });

    it('has a request, and an ownership check, for every route that needs one', () => {
      expect(Object.keys(REQUESTS).sort()).toEqual([...protectedRoutes].sort());
      const scoped = (s: Scope) => Object.entries(ROUTES).filter(([, r]) => r.scope === s).map(([k]) => k).sort();
      expect(Object.keys(OWNED).sort()).toEqual(scoped('by-id'));
      expect(Object.keys(SELF_ROUTES).sort()).toEqual(scoped('self'));
    });
  });

  describe('authentication on every private route', () => {
    function forged(name: string): Auth {
      const sub = w.ana.id;
      switch (name) {
        case 'no token':
          return null;
        case 'not a bearer':
          return 'Basic abc';
        case 'garbage':
          return 'Bearer not.a.jwt';
        case 'tampered':
          return `Bearer ${w.ana.accessToken.slice(0, -3)}${w.ana.accessToken.endsWith('aaa') ? 'bbb' : 'aaa'}`;
        case 'expired': {
          const iat = Math.floor(Date.now() / 1000) - 3600;
          return `Bearer ${jwt.sign({ role: 'N', iat }, ACCESS_SECRET, { subject: sub, expiresIn: 60 })}`;
        }
        case 'wrong secret':
          return `Bearer ${jwt.sign({ role: 'A' }, 'z'.repeat(48), { subject: sub, expiresIn: 600 })}`;
        case 'alg none': {
          const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
          const exp = Math.floor(Date.now() / 1000) + 600;
          return `Bearer ${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub, role: 'A', exp })}.`;
        }
        case 'alg none with signature part':
          return `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
            JSON.stringify({ sub, role: 'A' }),
          ).toString('base64url')}.xxxx`;
        default:
          throw new Error(name);
      }
    }
    const variants = [
      'no token',
      'not a bearer',
      'garbage',
      'tampered',
      'expired',
      'wrong secret',
      'alg none',
      'alg none with signature part',
      'deactivated user with a valid token',
    ];

    it.each(protectedRoutes)('%s answers an identical 401 to every bad credential', async (route) => {
      const baseline = await REQUESTS[route](null);
      expect(baseline.status).toBe(401);
      expect(baseline.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' });
      for (const name of variants) {
        const auth = name.startsWith('deactivated') ? asBearer(w.dead) : forged(name);
        const res = await REQUESTS[route](auth);
        try {
          same(res, baseline);
        } catch (e) {
          throw new Error(`${route} with "${name}" differs from the anonymous 401`, { cause: e });
        }
      }
    });
  });

  describe('admin routes', () => {
    it.each(Object.entries(ROUTES).filter(([, r]) => r.kind === 'admin').map(([k]) => k))(
      '%s is 403 for a normal user and allowed for an admin',
      async (route) => {
        const forbidden = await REQUESTS[route](asBearer(w.ana));
        expect(forbidden.status).toBe(403);
        expect(forbidden.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Forbidden' });
        const allowed = await REQUESTS[route](asBearer(w.admin));
        expect(allowed.status).toBeLessThan(300);
      },
    );

    it('PATCH /users/:id by an admin really changes the user, by a normal user changes nothing', async () => {
      await http().patch(`/users/${w.bia.id}`).set(...bearer(w.ana)).send({ role: 'A' });
      expect((await t.prisma.client.user.findUniqueOrThrow({ where: { id: w.bia.id } })).role).toBe('N');
      const ok = await http().patch(`/users/${w.bia.id}`).set(...bearer(w.admin)).send({ role: 'A' });
      expect(ok.status).toBe(200);
    });

    it('creating or editing a GLOBAL category is admin only', async () => {
      const create = await post('/categories', w.ana, { name: 'Global da Ana', global: true });
      const edit = await http().patch(`/categories/${w.globalCategory}`).set(...bearer(w.ana)).send({ name: 'Hack' });
      const del = await http().delete(`/categories/${w.globalCategory}`).set(...bearer(w.ana));
      expect([create.status, edit.status, del.status]).toEqual([403, 403, 403]);
      const adminCreate = await post('/categories', w.admin, { name: 'Global nova', global: true });
      const adminEdit = await http().patch(`/categories/${w.globalCategory}`).set(...bearer(w.admin)).send({ name: 'Mercado 2' });
      expect([adminCreate.status, adminEdit.status]).toEqual([201, 200]);
    });
  });

  /** Ways to reach a resource of Bia that is not yours; each must look exactly like a missing one. */
  interface Attack {
    name: string;
    call(auth: Auth, target: 'foreign' | 'missing'): request.Test;
  }
  const OWNED: Record<string, Attack[]> = {
    'PATCH /categories/:id': [
      { name: 'rename', call: (a, x) => withAuth(http().patch(`/categories/${x === 'foreign' ? w.bCategory : randomUUID()}`), a).send({ name: 'Roubada' }) },
    ],
    'DELETE /categories/:id': [
      { name: 'delete', call: (a, x) => withAuth(http().delete(`/categories/${x === 'foreign' ? w.bCategory : randomUUID()}`), a) },
    ],
    'GET /expenses/:id': [
      { name: 'read', call: (a, x) => withAuth(http().get(`/expenses/${x === 'foreign' ? w.bExpense : randomUUID()}`), a) },
    ],
    'PATCH /expenses/:id': [
      { name: 'edit', call: (a, x) => withAuth(http().patch(`/expenses/${x === 'foreign' ? w.bExpense : randomUUID()}`), a).send({ amountCents: 1 }) },
    ],
    'DELETE /expenses/:id': [
      { name: 'delete', call: (a, x) => withAuth(http().delete(`/expenses/${x === 'foreign' ? w.bExpense : randomUUID()}`), a) },
    ],
    'GET /loans/:id': [
      { name: 'read', call: (a, x) => withAuth(http().get(`/loans/${x === 'foreign' ? w.bLoan : randomUUID()}`), a) },
    ],
    'PATCH /loans/:id': [
      { name: 'edit', call: (a, x) => withAuth(http().patch(`/loans/${x === 'foreign' ? w.bLoan : randomUUID()}`), a).send({ borrowerName: 'Roubado' }) },
    ],
    'DELETE /loans/:id': [
      { name: 'delete', call: (a, x) => withAuth(http().delete(`/loans/${x === 'foreign' ? w.bLoan : randomUUID()}`), a) },
    ],
    'POST /loans/:id/payments': [
      {
        name: 'pay a foreign loan',
        call: (a, x) =>
          withAuth(http().post(`/loans/${x === 'foreign' ? w.bLoan : randomUUID()}/payments`), a).send({
            amountCents: 100,
            method: 'CASH',
            paidAt: '2026-11-08',
          }),
      },
    ],
    'GET /loans/:id/payments': [
      { name: 'list', call: (a, x) => withAuth(http().get(`/loans/${x === 'foreign' ? w.bLoan : randomUUID()}/payments`), a) },
    ],
    'POST /loans': [
      {
        name: 'lend against a foreign expense',
        call: (a, x) =>
          withAuth(http().post('/loans'), a).send({
            borrowerName: 'Carlos',
            dueDate: '2026-12-10',
            expenseId: x === 'foreign' ? w.bExpense : randomUUID(),
          }),
      },
    ],
    'GET /receipts/:id/file': [
      { name: 'download', call: (a, x) => withAuth(http().get(`/receipts/${x === 'foreign' ? w.bReceipt : randomUUID()}/file`), a) },
    ],
    'POST /expenses': [
      {
        name: 'create in a foreign category',
        call: (a, x) =>
          withAuth(http().post('/expenses'), a).send({
            categoryId: x === 'foreign' ? w.bCategory : randomUUID(),
            amountCents: 100,
            paidAlone: true,
            paymentMethod: 'PIX',
            spentAt: '2026-11-04',
          }),
      },
      {
        name: 'create with a foreign receipt',
        call: (a, x) =>
          withAuth(http().post('/expenses'), a).send({
            categoryId: w.globalCategory,
            receiptId: x === 'foreign' ? w.bReceipt : randomUUID(),
            amountCents: 100,
            paidAlone: true,
            paymentMethod: 'PIX',
            spentAt: '2026-11-04',
          }),
      },
    ],
  };

  describe('resources of another user answer exactly like missing ones', () => {
    const attackers: [string, () => Session][] = [
      ['a normal user', () => w.ana],
      ['an admin', () => w.admin],
    ];
    const cases = Object.entries(OWNED).flatMap(([route, attacks]) =>
      attacks.map((a) => [route, a.name, a] as const),
    );

    describe.each(attackers)('as %s', (_label, who) => {
      it.each(cases)('%s (%s) is a byte-identical 404', async (_route, _name, attack) => {
        const foreign = await attack.call(asBearer(who()), 'foreign');
        const missing = await attack.call(asBearer(who()), 'missing');
        expect(missing.status).toBe(404);
        same(foreign, missing);
        expect(foreign.text).not.toMatch(/Segredo|bia|forbidden/i);
      });
    });

    it('leaves the data of Bia untouched after all those attempts', async () => {
      for (const [, who] of attackers) {
        for (const [, , attack] of cases) await attack.call(asBearer(who()), 'foreign');
      }
      const expense = await t.prisma.client.expense.findUniqueOrThrow({ where: { id: w.bExpense } });
      expect(Number(expense.amountCents)).toBe(4200);
      expect(await t.prisma.client.category.findUnique({ where: { id: w.bCategory } })).toMatchObject({
        name: 'Segredo da Bia',
      });
      expect(await t.prisma.client.receipt.count({ where: { id: w.bReceipt } })).toBe(1);
      const loan = await t.prisma.client.loan.findUniqueOrThrow({ where: { id: w.bLoan } });
      expect([loan.borrowerName, Number(loan.amountCents), loan.userId]).toEqual(['Devedor da Bia', 7700, w.bia.id]);
      expect(await t.prisma.client.loan.count()).toBe(1);
      expect(await t.prisma.client.loanPayment.count()).toBe(0);
    });
  });

  /** Routes that take no id: they only ever see the caller's own data. */
  const SELF_ROUTES: Record<string, (s: Session) => Promise<void>> = {
    'GET /auth/me': async (s) => {
      const res = await http().get('/auth/me').set(...bearer(s));
      expect(res.body.id).toBe(s.id);
    },
    'GET /categories': async (s) => {
      const res = await http().get('/categories').set(...bearer(s));
      expect(JSON.stringify(res.body)).not.toContain('Segredo da Bia');
      expect(res.body.map((c: { id: string }) => c.id)).toContain(w.globalCategory);
    },
    'PUT /income/:month': async (s) => {
      await http().put(`/income/${MONTH}`).set(...bearer(s)).send({ amountCents: 123 });
      const bia = await t.prisma.client.monthlyIncome.findFirstOrThrow({ where: { userId: w.bia.id, month: MONTH } });
      expect(Number(bia.amountCents)).toBe(900_000);
    },
    'GET /income/:month': async (s) => {
      if (s.id === w.ana.id || s.id === w.admin.id) {
        const mine = await http().get(`/income/${MONTH}`).set(...bearer(s));
        const none = await http().get(`/income/${OTHER_MONTH}`).set(...bearer(s));
        expect(mine.status).toBe(404);
        expect(none.status).toBe(404);
        expect(mine.text).toBe(none.text);
      }
    },
    'GET /expenses': async (s) => {
      const res = await http().get('/expenses').set(...bearer(s));
      expect(res.body).toMatchObject({ items: [], total: 0 });
      const byCat = await http().get(`/expenses?categoryId=${w.bCategory}`).set(...bearer(s));
      expect(byCat.body).toMatchObject({ items: [], total: 0 });
    },
    'GET /loans': async (s) => {
      const res = await http().get('/loans').set(...bearer(s));
      expect(res.body).toMatchObject({ items: [], total: 0 });
      expect(JSON.stringify(res.body)).not.toContain('Devedor da Bia');
      const byBorrower = await http().get('/loans?borrower=Devedor%20da%20Bia').set(...bearer(s));
      expect(byBorrower.body).toMatchObject({ items: [], total: 0 });
    },
    'GET /loans/summary': async (s) => {
      const res = await http().get('/loans/summary').set(...bearer(s));
      expect(res.body.items).toEqual([]);
      expect(res.body.totals.totalLentCents).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain('Devedor da Bia');
      const byBorrower = await http().get('/loans/summary?borrower=Devedor%20da%20Bia').set(...bearer(s));
      expect(byBorrower.body.items).toEqual([]);
    },
    'GET /reports/by-category': async (s) => {
      const res = await http().get(`/reports/by-category?month=${MONTH}`).set(...bearer(s));
      expect(res.body).toEqual({ month: MONTH, totalCents: 0, items: [] });
    },
    'GET /reports/by-day': async (s) => {
      const res = await http().get(`/reports/by-day?month=${MONTH}`).set(...bearer(s));
      expect(res.body).toEqual({ month: MONTH, days: [], topDay: null });
    },
    'GET /reports/monthly-evolution': async (s) => {
      const res = await http().get('/reports/monthly-evolution?from=2026-10&to=2026-11').set(...bearer(s));
      expect(res.body.months.map((m: { totalCents: number }) => m.totalCents)).toEqual([0, 0]);
    },
    'GET /reports/income-vs-spent': async (s) => {
      const res = await http().get(`/reports/income-vs-spent?month=${MONTH}`).set(...bearer(s));
      expect(res.body).toMatchObject({
        incomeCents: null,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 0,
        remainingCents: null,
        percentSpent: null,
      });
    },
    'GET /reports/card': async (s) => {
      const res = await http().get(`/reports/card?month=${MONTH}`).set(...bearer(s));
      expect(res.body).toEqual({ month: MONTH, openingCents: 0, chargedCents: 0, paidCents: 0, balanceCents: 0 });
    },
  };

  describe('self-scoped routes never show the data of another user', () => {
    it.each(Object.keys(SELF_ROUTES))('%s, for a normal user and for an admin', async (route) => {
      await SELF_ROUTES[route](w.ana);
      await SELF_ROUTES[route](w.admin);
    });

    it('shows Bia her own data through the very same routes (the check is not vacuous)', async () => {
      const list = await http().get('/expenses').set(...bearer(w.bia));
      expect(list.body.total).toBe(1);
      const loans = await http().get('/loans').set(...bearer(w.bia));
      expect(loans.body.total).toBe(1);
      const loanSummary = await http().get('/loans/summary').set(...bearer(w.bia));
      expect(loanSummary.body.totals.totalLentCents).toBe(7700);
      const rep = await http().get(`/reports/income-vs-spent?month=${MONTH}`).set(...bearer(w.bia));
      // The Pix expense (4200) plus the Pix loan (7700) lent in the month leave the account.
      expect(rep.body).toMatchObject({ incomeCents: 900_000, spentCents: 11_900 });
      // Bia's card figures come from a credit purchase made here, so the zeros above are not vacuous.
      const credit = await post('/expenses', w.bia, {
        categoryId: w.bCategory,
        amountCents: 3300,
        paidAlone: true,
        paymentMethod: 'CREDIT',
        spentAt: '2026-11-04',
      });
      expect(credit.status).toBe(201);
      const card = await http().get(`/reports/card?month=${MONTH}`).set(...bearer(w.bia));
      expect(card.body).toEqual({ month: MONTH, openingCents: 0, chargedCents: 3300, paidCents: 0, balanceCents: 3300 });
      expect(PASSWORD).toBeDefined();
    });
  });
});
