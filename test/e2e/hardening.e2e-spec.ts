import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { listRoutes, RouteInfo } from './support/routes';
import { cleanTables, startApp, TestApp } from './support/test-app';

@Controller('probe')
class FailingProbeController {
  @Get('boom')
  boom(): never {
    throw new Error(
      'PrismaClientKnownRequestError: SELECT * FROM "User" at /Users/dev/app/src/db.ts:10:5',
    );
  }
}

const LEAKS: [string, RegExp][] = [
  ['stack frame', /\bat\s+\S+.*:\d+:\d+/],
  ['stack word', /stack/i],
  ['prisma', /prisma/i],
  ['postgres', /postgres/i],
  ['sql', /\b(SELECT|INSERT|UPDATE|DELETE)\b.*\b(FROM|INTO|SET)\b/i],
  ['absolute path', /(\/Users\/|\/home\/|\/srv\/|\/app\/|\/var\/|node_modules|[A-Za-z]:\\)/],
  ['source file', /\.(ts|js):\d+/],
];

function expectNoLeak(label: string, text: string): void {
  for (const [name, re] of LEAKS) {
    if (re.test(text)) throw new Error(`${label}: body leaks ${name}: ${text.slice(0, 200)}`);
  }
}

const UUID = '3f1c2b7e-9a4d-4c55-8e0b-6d2a1f9c7b10';

describe('final hardening', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;

  beforeAll(async () => {
    t = await startApp({}, [FailingProbeController]);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
    admin = await signUp(t, 'admin@example.com', 'A');
    ana = await signUp(t, 'ana@example.com');
  });

  const http = () => request(t.app.getHttpServer());

  describe('caching of authenticated and personal responses', () => {
    const personal: [string, (s: Session) => request.Test][] = [
      ['POST /auth/login', () => http().post('/auth/login').send({ email: 'ana@example.com', password: 'correct horse battery' })],
      ['POST /auth/refresh', (s) => http().post('/auth/refresh').send({ refreshToken: s.refreshToken })],
      ['GET /auth/me', (s) => http().get('/auth/me').set(...bearer(s))],
      ['GET /categories', (s) => http().get('/categories').set(...bearer(s))],
      ['GET /expenses', (s) => http().get('/expenses').set(...bearer(s))],
      ['GET /income/2026-11', (s) => http().get('/income/2026-11').set(...bearer(s))],
      ['GET /reports/by-category', (s) => http().get('/reports/by-category?month=2026-11').set(...bearer(s))],
      ['GET /users', () => http().get('/users').set(...bearer(admin))],
      ['GET /auth/me without token (401)', () => http().get('/auth/me')],
      ['POST /auth/register', () => http().post('/auth/register').send({ name: 'Bia', email: 'bia@example.com', password: 'correct horse battery' })],
    ];

    it.each(personal)('%s is sent with Cache-Control: no-store and no ETag', async (_n, call) => {
      const res = await call(ana);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.headers['etag']).toBeUndefined();
    });

    it('never answers 304 to a conditional request', async () => {
      const first = await http().get('/categories').set(...bearer(ana));
      const res = await http()
        .get('/categories')
        .set(...bearer(ana))
        .set('If-None-Match', (first.headers['etag'] as string | undefined) ?? 'W/"x"')
        .set('If-Modified-Since', new Date(Date.now() + 86_400_000).toUTCString());
      expect(res.status).toBe(200);
    });
  });

  describe('conditional request headers are ignored', () => {
    const conditions: [string, string][] = [
      ['If-None-Match', '*'],
      ['If-None-Match', 'W/"x"'],
      ['If-None-Match', '"abc", W/"def"'],
      ['If-Match', '*'],
      ['If-Modified-Since', new Date(Date.now() + 86_400_000).toUTCString()],
      ['If-Unmodified-Since', new Date(0).toUTCString()],
      ['If-Range', 'W/"x"'],
    ];
    const gets: [string, (s: Session) => request.Test][] = [
      ['/categories', (s) => http().get('/categories').set(...bearer(s))],
      ['/expenses', (s) => http().get('/expenses').set(...bearer(s))],
      ['/auth/me', (s) => http().get('/auth/me').set(...bearer(s))],
      ['/health', () => http().get('/health')],
    ];

    it.each(conditions.flatMap(([h, v]) => gets.map(([r, call]) => [h, v, r, call] as const)))(
      '%s: %s on GET %s never gives 304 or 412',
      async (header, value, _route, call) => {
        const res = await call(ana).set(header, value);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toMatch(/no-store/);
      },
    );

    it('does not turn a write into 412 either', async () => {
      const res = await http()
        .post('/categories')
        .set(...bearer(ana))
        .set('If-Match', '"nope"')
        .set('If-Unmodified-Since', new Date(0).toUTCString())
        .send({ name: 'Cond' });
      expect(res.status).toBe(201);
    });
  });

  describe('CORS preflight', () => {
    it('gives an unlisted origin no allow headers (CORS_ORIGINS empty)', async () => {
      const res = await http()
        .options('/expenses')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('error bodies never leak internals', () => {
    it('answers a generic 500 for an unexpected error', async () => {
      const res = await http().get('/probe/boom').set(...bearer(ana));
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal Server Error',
      });
    });

    const bodies: [string, unknown][] = [
      ['empty object', {}],
      ['array', [1, 2]],
      ['proto pollution', { __proto__: { admin: true }, constructor: { prototype: { x: 1 } } }],
      ['wrong types', { name: 1, email: [], password: {}, amountCents: 'x', categoryId: 5, refreshToken: 7 }],
      ['long strings', { name: 'x'.repeat(5000), description: 'y'.repeat(5000) }],
      ['deep nesting', JSON.parse('{"a":'.repeat(40) + '1' + '}'.repeat(40)) as unknown],
    ];
    const queries = [
      '',
      '?month=%00&limit=-1&offset=abc',
      '?month[]=2026-11&month[]=2026-12&__proto__[x]=1',
      `?from=${'9'.repeat(300)}&categoryId=%27%3BDROP%20TABLE%20%22User%22--`,
    ];
    const params = ['not-a-uuid', '../../etc/passwd', '%00', UUID, '2026-13', "1'%3B--"];

    function expand(r: RouteInfo, param: string): string {
      return r.path.replace(/:\w+/g, param);
    }

    it('sweeps every registered route with invalid input and finds no leak and no 5xx', async () => {
      const routes = listRoutes(t).filter((r) => !r.route.includes('/probe/'));
      expect(routes.length).toBeGreaterThanOrEqual(25);
      const sessions: (Session | null)[] = [null, ana, admin];
      let checked = 0;
      for (const r of routes) {
        for (const param of params) {
          for (const query of queries) {
            for (const who of sessions) {
              const url = expand(r, param) + query;
              const send = async (body?: unknown) => {
                let req = http()[r.method.toLowerCase() as 'get'](url);
                if (who) req = req.set(...bearer(who));
                return body === undefined ? req : req.send(body as object);
              };
              const withBody = ['POST', 'PUT', 'PATCH'].includes(r.method);
              const attempts = withBody ? bodies.map(([, b]) => b) : [undefined];
              for (const body of attempts) {
                const res = await send(body);
                const label = `${r.route} as ${who?.email ?? 'anon'} ${url}`;
                if (res.status >= 500) throw new Error(`${label}: got ${res.status}`);
                if (res.status >= 400) expectNoLeak(label, res.text);
                checked++;
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    }, 240_000);

    it('keeps the 404 for unknown paths and wrong methods generic', async () => {
      for (const res of [await http().get('/nope/../x'), await http().delete('/health'), await http().get('/.env')]) {
        expect(res.status).toBe(404);
        expectNoLeak('unknown', res.text);
      }
    });
  });
});
