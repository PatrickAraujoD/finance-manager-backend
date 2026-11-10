import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

/** `YYYY-MM-DD` of today (UTC) plus `days`, from the real clock the app uses. */
function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const ITEM_FIELDS = [
  'borrowerName',
  'loansCount',
  'nextDueDate',
  'overdueCents',
  'overdueLoansCount',
  'owedCents',
  'paidCents',
  'totalLentCents',
  'upcomingCents',
];

describe('GET /loans/summary', () => {
  let t: TestApp;
  let uploadDir: string;
  let ana: Session;
  let bob: Session;
  let admin: Session;

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'fm-e2e-loan-summary-'));
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
  });

  const http = () => request(t.app.getHttpServer());
  const lend = async (s: Session, borrowerName: string, dueDate: string, amountCents: number) =>
    (
      await http()
        .post('/loans')
        .set(...bearer(s))
        .send({ borrowerName, dueDate, amountCents, paymentMethod: 'PIX' })
    ).body.id as string;
  const pay = (s: Session, id: string, body: object) =>
    http()
      .post(`/loans/${id}/payments`)
      .set(...bearer(s))
      .send({ paidAt: dayFromToday(0), ...body });
  const summary = (s: Session, query = '') => http().get(`/loans/summary${query}`).set(...bearer(s));
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

  async function seedAna(): Promise<void> {
    const upcoming = await lend(ana, 'Carlos', dayFromToday(30), 10_000);
    const overdue = await lend(ana, ' carlos', dayFromToday(-5), 5_000);
    await lend(ana, 'Maria', dayFromToday(10), 3_000);
    expect((await pay(ana, upcoming, { amountCents: 2_000, method: 'CASH' })).status).toBe(201);
    const receiptId = await upload(ana);
    expect((await pay(ana, upcoming, { amountCents: 1_000, method: 'PIX', receiptId })).status).toBe(201);
    expect((await pay(ana, overdue, { amountCents: 500, method: 'CASH' })).status).toBe(201);
  }

  it('answers each person with every number, plus the totals of the user', async () => {
    await seedAna();
    const res = await summary(ana);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          borrowerName: 'Carlos',
          loansCount: 2,
          totalLentCents: 15_000,
          paidCents: 3_500,
          owedCents: 11_500,
          upcomingCents: 7_000,
          overdueCents: 4_500,
          overdueLoansCount: 1,
          nextDueDate: dayFromToday(-5),
        },
        {
          borrowerName: 'Maria',
          loansCount: 1,
          totalLentCents: 3_000,
          paidCents: 0,
          owedCents: 3_000,
          upcomingCents: 3_000,
          overdueCents: 0,
          overdueLoansCount: 0,
          nextDueDate: dayFromToday(10),
        },
      ],
      totals: {
        totalLentCents: 18_000,
        paidCents: 3_500,
        owedCents: 14_500,
        upcomingCents: 10_000,
        overdueCents: 4_500,
      },
      truncated: false,
    });
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_FIELDS);
      expect(item.owedCents).toBe(item.upcomingCents + item.overdueCents);
      expect(item.owedCents).toBe(item.totalLentCents - item.paidCents);
    }
  });

  it('is not captured by GET /loans/:id (no UUID 400) and the id route still works', async () => {
    const id = await lend(ana, 'Carlos', dayFromToday(30), 1_000);
    expect((await summary(ana)).status).toBe(200);
    expect((await http().get(`/loans/${id}`).set(...bearer(ana))).status).toBe(200);
    expect((await http().get('/loans/not-a-uuid').set(...bearer(ana))).status).toBe(400);
  });

  it('filters by borrower ignoring case and spaces, and narrows the totals', async () => {
    await seedAna();
    const res = await summary(ana, '?borrower=%20MARIA%20');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { borrowerName: string }) => i.borrowerName)).toEqual(['Maria']);
    expect(res.body.totals).toEqual({
      totalLentCents: 3_000,
      paidCents: 0,
      owedCents: 3_000,
      upcomingCents: 3_000,
      overdueCents: 0,
    });
    const none = await summary(ana, '?borrower=Ninguem');
    expect(none.body).toMatchObject({ items: [], truncated: false });
    expect(none.body.totals.owedCents).toBe(0);
  });

  it('refuses a blank borrower and unknown query parameters', async () => {
    expect((await summary(ana, '?borrower=%20%20')).status).toBe(400);
    expect((await summary(ana, '?foo=1')).status).toBe(400);
  });

  it('is empty with zero totals for a user without loans', async () => {
    const res = await summary(ana);
    expect(res.body).toEqual({
      items: [],
      totals: { totalLentCents: 0, paidCents: 0, owedCents: 0, upcomingCents: 0, overdueCents: 0 },
      truncated: false,
    });
  });

  it('shows each user only the own loans, admin included', async () => {
    await seedAna();
    await lend(bob, 'Dora', dayFromToday(5), 900);
    const forBob = await summary(bob);
    expect(forBob.body.items.map((i: { borrowerName: string }) => i.borrowerName)).toEqual(['Dora']);
    expect(forBob.body.totals.totalLentCents).toBe(900);
    const forAdmin = await summary(admin);
    expect(forAdmin.body.items).toEqual([]);
    expect(JSON.stringify(forAdmin.body)).not.toContain('Carlos');
    expect(JSON.stringify(forBob.body)).not.toContain('Carlos');
  });

  it('answers 401 without a token or with a bad one', async () => {
    expect((await http().get('/loans/summary')).status).toBe(401);
    expect((await http().get('/loans/summary').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});
