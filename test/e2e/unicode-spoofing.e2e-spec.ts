import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const PASSWORD = 'correct horse battery';
const ZWJ = '\u200d';
const FAMILY = `\u{1f468}${ZWJ}\u{1f469}${ZWJ}\u{1f467}`;

const INVISIBLE = [
  '\u200b',
  '\u200c',
  '\u2060',
  '\ufeff',
  '\u00ad',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
  '\u061c',
  '\u200e',
  '\u200f',
];
const SEPARATORS = ['\u2028', '\u2029'];
const label = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

describe('invisible and spoofing Unicode', () => {
  let t: TestApp;
  let ana: Session;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    ana = await signUp(t, 'ana@example.com');
  });

  const http = () => request(t.app.getHttpServer());
  const register = (name: string, email: string, password = PASSWORD) =>
    http().post('/auth/register').send({ name, email, password });
  const category = (name: string) =>
    http().post('/categories').set(...bearer(ana)).send({ name });
  const expenseWith = async (description: string) => {
    const cat = (await category(`Cat ${Math.random()}`)).body.id;
    return http()
      .post('/expenses')
      .set(...bearer(ana))
      .send({ categoryId: cat, amountCents: 100, paidAlone: true, spentAt: '2026-11-01', description });
  };

  describe('user names', () => {
    it.each([...INVISIBLE, ...SEPARATORS].map((c) => [label(c), c]))('reject %s', async (_l, c) => {
      expect((await register(`An${c}a`, 'new@example.com')).status).toBe(400);
    });

    it('reject the right to left override U+202E in a name', async () => {
      expect((await register('evil\u202etxt.exe', 'rlo@example.com')).status).toBe(400);
    });

    it('accept a ZWJ emoji sequence', async () => {
      expect((await register(`Fam ${FAMILY}`, 'fam@example.com')).status).toBe(201);
    });
  });

  describe('category names', () => {
    it.each([...INVISIBLE, ...SEPARATORS].map((c) => [label(c), c]))('reject %s', async (_l, c) => {
      expect((await category(`Fo${c}od`)).status).toBe(400);
    });

    it('accept a ZWJ emoji sequence', async () => {
      const res = await category(`${FAMILY} Familia`);
      expect(res.status).toBe(201);
      const stored = await t.prisma.client.category.findUnique({ where: { id: res.body.id } });
      expect(stored?.name).toBe(`${FAMILY} Familia`);
    });
  });

  describe('emails', () => {
    const spaces = ['\u2003', '\u3000', '\u00a0', '\u180e', ZWJ];
    it.each([...INVISIBLE, ...SEPARATORS, ...spaces].map((c) => [label(c), c]))(
      'registration rejects %s',
      async (_l, c) => {
        expect((await register('Bia', `a${c}@example.com`)).status).toBe(400);
      },
    );

    it('registration rejects the spoofed address a<ZWSP>@x.com', async () => {
      expect((await register('Bia', 'a\u200b@x.com')).status).toBe(400);
    });

    it('login rejects an invisible character in the email (400)', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: 'ana\u200b@example.com', password: PASSWORD });
      expect(res.status).toBe(400);
    });
  });

  describe('expense descriptions', () => {
    it.each([...INVISIBLE, ...SEPARATORS].map((c) => [label(c), c]))('reject %s', async (_l, c) => {
      expect((await expenseWith(`a${c}b`)).status).toBe(400);
    });

    it('reject U+2028 specifically', async () => {
      expect((await expenseWith('linha\u2028outra')).status).toBe(400);
    });

    it('accept CRLF and a lone CR (form submissions)', async () => {
      expect((await expenseWith('linha 1\r\nlinha 2\rlinha 3')).status).toBe(201);
    });

    it('still reject other controls such as VT and FF', async () => {
      expect((await expenseWith('a\u000bb')).status).toBe(400);
      expect((await expenseWith('a\u000cb')).status).toBe(400);
    });

    it('accept TAB, LF and a ZWJ emoji', async () => {
      expect((await expenseWith(`a\tb\nc ${FAMILY}`)).status).toBe(201);
    });
  });

  describe('ZWNJ between letters of non Latin scripts', () => {
    const ZWNJ = '\u200c';
    const accepted = [
      ['Persian', 'می‌خواهم'],
      ['Urdu', 'ہم‌سفر'],
      ['Malayalam', 'ക്‌ഷ'],
      ['Hindi', 'क्‌ष'],
    ];
    const rejected = [
      ['Latin', `fo${ZWNJ}od`],
      ['Cyrillic', `до${ZWNJ}ма`],
      ['start', `${ZWNJ}می`],
      ['end', `می${ZWNJ}`],
      ['doubled', `می${ZWNJ}${ZWNJ}خ`],
    ];

    it.each(accepted)('registration accepts %s', async (_n, text) => {
      expect((await register(text, 'zw@example.com')).status).toBe(201);
    });
    it.each(accepted)('category accepts %s', async (_n, text) => {
      const res = await category(text);
      expect(res.status).toBe(201);
      const stored = await t.prisma.client.category.findUnique({ where: { id: res.body.id } });
      expect(stored?.name).toBe(text);
    });
    it.each(accepted)('description accepts %s', async (_n, text) => {
      expect((await expenseWith(`pago: ${text}`)).status).toBe(201);
    });

    it.each(rejected)('registration rejects %s', async (_n, text) => {
      expect((await register(text, 'zw@example.com')).status).toBe(400);
    });
    it.each(rejected)('category rejects %s', async (_n, text) => {
      expect((await category(text)).status).toBe(400);
    });
    it.each(rejected)('description rejects %s', async (_n, text) => {
      expect((await expenseWith(text)).status).toBe(400);
    });

    it('still rejects ZWNJ in the e-mail', async () => {
      expect((await register('Bia', `می${ZWNJ}خ@example.com`)).status).toBe(400);
    });
  });

  describe('email normalization', () => {
    const NFC = 'caf\u00e9@example.com';
    const NFD = 'cafe\u0301@example.com';
    const storedEmails = async () =>
      (await t.prisma.client.user.findMany({ select: { email: true } })).map((u) => u.email).sort();

    it('NFC then NFD registers one account (second is 409)', async () => {
      expect((await register('Bia', NFC)).status).toBe(201);
      expect((await register('Bia', NFD)).status).toBe(409);
      expect(await storedEmails()).toContain(NFC);
    });

    it('full width letters are the same account as ASCII', async () => {
      expect((await register('Bia', 'a@example.com')).status).toBe(201);
      expect((await register('Bia', '\uff41@example.com')).status).toBe(409);
    });

    it('IDN and punycode are the same account, stored as punycode', async () => {
      expect((await register('Bia', 'user@m\u00fcnchen.de')).status).toBe(201);
      expect((await register('Bia', 'user@xn--mnchen-3ya.de')).status).toBe(409);
      expect((await register('Bia', 'user@M\u00dcNCHEN.de')).status).toBe(409);
      expect(await storedEmails()).toContain('user@xn--mnchen-3ya.de');
    });

    it('login with the NFD variant finds the account registered in NFC', async () => {
      await register('Bia', NFC);
      const res = await http().post('/auth/login').send({ email: NFD, password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it('login with the unicode domain finds the punycode account', async () => {
      await register('Bia', 'user@xn--mnchen-3ya.de');
      const res = await http()
        .post('/auth/login')
        .send({ email: 'user@m\u00fcnchen.de', password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it.each(['\u034f', '\u115f', '\u3164', '\u2800', '\u180b', '\ufe0f'].map((c) => [label(c), c]))(
      'registration and login reject the invisible %s (400)',
      async (_l, c) => {
        expect((await register('Bia', `a${c}b@example.com`)).status).toBe(400);
        expect((await register('Bia', `ab@exa${c}mple.com`)).status).toBe(400);
        const res = await http()
          .post('/auth/login')
          .send({ email: `a${c}b@example.com`, password: PASSWORD });
        expect(res.status).toBe(400);
      },
    );
  });

  describe('registration password', () => {
    it('accepts invisible Unicode (only controls are refused)', async () => {
      const res = await register('Caio', 'caio@example.com', `pass\u200bword\u202e long enough`);
      expect(res.status).toBe(201);
    });
  });
});
