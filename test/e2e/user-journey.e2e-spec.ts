import { Logger, LoggerService } from '@nestjs/common';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { runSeed } from '../../prisma/seed';
import { ReceiptExtractor } from '../../src/application/ports/receipt-extractor';
import { RECEIPT_EXTRACTOR } from '../../src/presentation/http/tokens';
import { PASSWORD } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const FIXTURES = join(__dirname, '..', 'fixtures');
const ADMIN_EMAIL = 'chefe.admin@example.com';
const ADMIN_PASSWORD = 'admin pass phrase 123';
const USER_EMAIL = 'maria.silva@example.com';
const USER_PASSWORD = PASSWORD;
const DESCRIPTIONS = ['feira do mes', 'cinema com a familia', 'racha do jantar', 'padaria de outubro'];

/** Everything the process writes while the journey runs: Nest logger, stdout, stderr, console. */
class LogCapture implements LoggerService {
  readonly lines: string[] = [];
  private restores: (() => void)[] = [];
  private push = (...args: unknown[]) => {
    this.lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  log = this.push;
  error = this.push;
  warn = this.push;
  debug = this.push;
  verbose = this.push;
  fatal = this.push;

  start(): void {
    Logger.overrideLogger(this);
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        this.push(String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      this.restores.push(() => (stream.write = original));
    }
  }

  stop(): void {
    for (const restore of this.restores) restore();
    this.restores = [];
    Logger.overrideLogger(false);
  }
}

describe('complete user journey', () => {
  let t: TestApp;
  let uploadDir: string;
  const logs = new LogCapture();
  let extract: jest.SpiedFunction<ReceiptExtractor['extract']>;

  const s: Record<string, string> = {};
  const http = () => request(t.app.getHttpServer());
  const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
  const fixture = (name: string) => readFile(join(FIXTURES, name));

  beforeAll(async () => {
    const parent = process.env.UPLOAD_DIR ?? tmpdir();
    await mkdir(parent, { recursive: true });
    uploadDir = await mkdtemp(join(parent, 'fm-journey-'));
    t = await startApp({ uploadDir });
    await cleanTables(t.prisma);
    extract = jest.spyOn(t.app.get<ReceiptExtractor>(RECEIPT_EXTRACTOR), 'extract');
    logs.start();
  });
  afterAll(async () => {
    logs.stop();
    await t.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('seeds the first admin (EnsureAdmin) and logs in', async () => {
    const seeded = await runSeed({ ADMIN_EMAIL, ADMIN_PASSWORD }, t.prisma);
    expect(seeded.state).toBe('created');
    const login = await http().post('/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    s.admin = login.body.accessToken;
    expect((await http().get('/auth/me').set(...auth(s.admin))).body.role).toBe('A');
  });

  it('registers and logs in a normal user', async () => {
    const reg = await http().post('/auth/register').send({ name: 'Maria', email: USER_EMAIL, password: USER_PASSWORD });
    expect(reg.status).toBe(201);
    const bad = await http().post('/auth/login').send({ email: USER_EMAIL, password: 'wrong password!!' });
    expect(bad.status).toBe(401);
    const login = await http().post('/auth/login').send({ email: USER_EMAIL, password: USER_PASSWORD });
    expect(login.status).toBe(200);
    s.user = login.body.accessToken;
    s.refresh1 = login.body.refreshToken;
    const me = await http().get('/auth/me').set(...auth(s.user));
    expect(me.body).toMatchObject({ email: USER_EMAIL, role: 'N' });
  });

  it('lets the admin create the global category and the user a private one', async () => {
    const mercado = await http().post('/categories').set(...auth(s.admin)).send({ name: 'Mercado', global: true });
    expect(mercado.status).toBe(201);
    s.mercado = mercado.body.id;
    const denied = await http().post('/categories').set(...auth(s.user)).send({ name: 'Outra', global: true });
    expect(denied.status).toBe(403);
    const lazer = await http().post('/categories').set(...auth(s.user)).send({ name: 'Lazer' });
    expect(lazer.status).toBe(201);
    s.lazer = lazer.body.id;
    const list = await http().get('/categories').set(...auth(s.user));
    expect(list.body).toEqual(
      expect.arrayContaining([
        { id: s.mercado, name: 'Mercado', global: true },
        { id: s.lazer, name: 'Lazer', global: false },
      ]),
    );
  });

  it('sets the salary of the month', async () => {
    const put = await http().put('/income/2026-11').set(...auth(s.user)).send({ amountCents: 500_000 });
    expect(put.status).toBe(200);
    expect((await http().get('/income/2026-11').set(...auth(s.user))).body).toEqual({
      month: '2026-11',
      amountCents: 500_000,
    });
  });

  function upload(file: Buffer, type: string, name: string, paidAlone: boolean) {
    return http()
      .post('/receipts')
      .set(...auth(s.user))
      .field('paidAlone', String(paidAlone))
      .attach('file', file, { filename: name, contentType: type });
  }
  const expense = (body: object) => http().post('/expenses').set(...auth(s.user)).send(body);

  it('uploads a PDF (paidAlone) and confirms the expense correcting the suggested value', async () => {
    const res = await upload(await fixture('comprovante-texto.pdf'), 'application/pdf', 'a.pdf', true);
    expect(res.status).toBe(201);
    expect(res.body.suggestedAmountCents).toBe(12345);
    expect(extract).toHaveBeenCalledTimes(1);
    const created = await expense({
      categoryId: s.mercado,
      receiptId: res.body.receiptId,
      amountCents: 12_000,
      paidAlone: true,
      paymentMethod: 'PIX',
      spentAt: '2026-11-02',
      description: DESCRIPTIONS[0],
    });
    expect(created.status).toBe(201);
    const got = await http().get(`/expenses/${created.body.id}`).set(...auth(s.user));
    expect(got.body).toMatchObject({ amountCents: 12_000, receiptId: res.body.receiptId, spentAt: '2026-11-02' });
  });

  it('uploads a PNG (OCR) and confirms the suggested value', async () => {
    const res = await upload(await fixture('comprovante.png'), 'image/png', 'foto.png', true);
    expect(res.status).toBe(201);
    expect(res.body.suggestedAmountCents).toBe(12345);
    expect(extract).toHaveBeenCalledTimes(2);
    const created = await expense({
      categoryId: s.lazer,
      receiptId: res.body.receiptId,
      amountCents: res.body.suggestedAmountCents,
      paidAlone: true,
      paymentMethod: 'PIX',
      spentAt: '2026-11-05',
      description: DESCRIPTIONS[1],
    });
    expect(created.status).toBe(201);
  }, 90_000);

  it('splits a bill: no extraction, the user-informed value is stored', async () => {
    const res = await upload(await fixture('comprovante-varios-valores.pdf'), 'application/pdf', 'b.pdf', false);
    expect(res.status).toBe(201);
    expect(res.body.suggestedAmountCents).toBeNull();
    expect(extract).toHaveBeenCalledTimes(2); // not called again
    const created = await expense({
      categoryId: s.lazer,
      receiptId: res.body.receiptId,
      amountCents: 5_000,
      paidAlone: false,
      paymentMethod: 'PIX',
      spentAt: '2026-11-05',
      description: DESCRIPTIONS[2],
    });
    expect(created.status).toBe(201);
  });

  it('records manual expenses without a receipt', async () => {
    const nov = await expense({ categoryId: s.mercado, amountCents: 3_000, paidAlone: true, paymentMethod: 'PIX', spentAt: '2026-11-02' });
    const oct = await expense({
      categoryId: s.mercado,
      amountCents: 1_000,
      paidAlone: true,
      paymentMethod: 'PIX',
      spentAt: '2026-10-15',
      description: DESCRIPTIONS[3],
    });
    expect([nov.status, oct.status]).toEqual([201, 201]);
    const list = await http().get('/expenses').set(...auth(s.user));
    expect(list.body.total).toBe(5);
  });

  it('answers the four reports with the exact numbers', async () => {
    const get = (path: string) => http().get(`/reports/${path}`).set(...auth(s.user));

    const byCategory = await get('by-category?month=2026-11');
    expect(byCategory.body).toEqual({
      month: '2026-11',
      totalCents: 32_345,
      items: [
        { categoryId: s.lazer, categoryName: 'Lazer', totalCents: 17_345, percentage: 53.62 },
        { categoryId: s.mercado, categoryName: 'Mercado', totalCents: 15_000, percentage: 46.38 },
      ],
    });
    const sum = byCategory.body.items.reduce((a: number, i: { percentage: number }) => a + i.percentage, 0);
    expect(sum.toFixed(2)).toBe('100.00');

    expect((await get('by-day?month=2026-11')).body).toEqual({
      month: '2026-11',
      days: [
        { date: '2026-11-02', totalCents: 15_000 },
        { date: '2026-11-05', totalCents: 17_345 },
      ],
      topDay: { date: '2026-11-05', totalCents: 17_345 },
    });

    expect((await get('monthly-evolution?from=2026-09&to=2026-11')).body).toEqual({
      from: '2026-09',
      to: '2026-11',
      months: [
        { month: '2026-09', totalCents: 0 },
        { month: '2026-10', totalCents: 1_000 },
        { month: '2026-11', totalCents: 32_345 },
      ],
    });

    expect((await get('income-vs-spent?month=2026-11')).body).toEqual({
      month: '2026-11',
      incomeCents: 500_000,
      spentCents: 32_345,
      receivedCents: 0,
      creditSpentCents: 0,
      remainingCents: 467_655,
      percentSpent: 6.47,
    });
  });

  it('rotates the refresh token and ends the session on logout', async () => {
    const rotated = await http().post('/auth/refresh').send({ refreshToken: s.refresh1 });
    expect(rotated.status).toBe(200);
    s.refresh2 = rotated.body.refreshToken;
    expect(s.refresh2).not.toBe(s.refresh1);

    const out = await http().post('/auth/logout').send({ refreshToken: s.refresh2 });
    expect(out.status).toBe(204);

    for (const old of [s.refresh2, s.refresh1]) {
      const res = await http().post('/auth/refresh').send({ refreshToken: old });
      expect(res.status).toBe(401);
    }
  });

  it('wrote no secret to any log during the whole journey', async () => {
    // The capture really works (otherwise an empty log would prove nothing).
    new Logger('Canary').warn('canary-line');
    expect(logs.lines.join('\n')).toContain('canary-line');

    const users = await t.prisma.client.user.findMany();
    const tokens = await t.prisma.client.refreshToken.findMany();
    const secrets = [
      USER_PASSWORD,
      ADMIN_PASSWORD,
      s.admin,
      s.user,
      s.refresh1,
      s.refresh2,
      USER_EMAIL,
      ADMIN_EMAIL,
      ...DESCRIPTIONS,
      ...users.map((u) => u.passwordHash),
      ...tokens.map((r) => r.tokenHash),
    ];
    expect(users.length).toBe(2);
    const output = logs.lines.join('\n');
    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(output).not.toContain(secret);
    }
    // The tail of a JWT or an argon2 hash would still be identifiable.
    expect(output).not.toMatch(/\$argon2|eyJ[A-Za-z0-9_-]{10,}/);
  });
});
