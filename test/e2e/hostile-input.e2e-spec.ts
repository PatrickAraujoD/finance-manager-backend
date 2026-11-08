import request from 'supertest';
import { cleanTables, startApp, TestApp } from './support/test-app';

const PASSWORD = 'correct horse battery';

describe('hostile text input never causes a 500', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
  });

  const http = () => request(t.app.getHttpServer());
  const raw = (path: string, json: string) =>
    http().post(path).set('Content-Type', 'application/json').send(json);

  describe('POST /auth/register', () => {
    it('rejects a NUL in the name (400)', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'An\u0000a', email: 'ana@example.com', password: PASSWORD });
      expect(res.status).toBe(400);
      expect(await t.prisma.client.user.count()).toBe(0);
    });

    it('rejects a lone surrogate in the name sent as a raw JSON escape (400)', async () => {
      const res = await raw(
        '/auth/register',
        `{"name":"An\\ud800a","email":"ana@example.com","password":"${PASSWORD}"}`,
      );
      expect(res.status).toBe(400);
      expect(await t.prisma.client.user.count()).toBe(0);
    });

    it('rejects a lone low surrogate in the name (400)', async () => {
      const res = await raw(
        '/auth/register',
        `{"name":"\\udc00","email":"ana@example.com","password":"${PASSWORD}"}`,
      );
      expect(res.status).toBe(400);
    });

    it('rejects a NUL in the email (400)', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Ana', email: 'ana\u0000@example.com', password: PASSWORD });
      expect(res.status).toBe(400);
    });

    it('does not answer 500 to a NUL in the password', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: `${PASSWORD}\u0000x` });
      expect(res.status).toBeLessThan(500);
    });

    it('still accepts accents and emoji in the name', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Zoë 😀', email: 'zoe@example.com', password: PASSWORD });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /auth/login', () => {
    it('does not answer 500 to a NUL in the email', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: 'a\u0000@example.com', password: PASSWORD });
      expect(res.status).toBe(400);
    });

    it('does not answer 500 to a NUL in the password', async () => {
      await http()
        .post('/auth/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: PASSWORD });
      const res = await http()
        .post('/auth/login')
        .send({ email: 'ana@example.com', password: `${PASSWORD}\u0000` });
      expect([400, 401]).toContain(res.status);
    });

    it('does not answer 500 to a lone surrogate in the password', async () => {
      const res = await raw(
        '/auth/login',
        '{"email":"ana@example.com","password":"abc\\ud800def"}',
      );
      expect([400, 401]).toContain(res.status);
    });
  });

  describe('POST /auth/refresh and /auth/logout', () => {
    it.each(['/auth/refresh', '/auth/logout'])('%s does not answer 500 to NUL', async (path) => {
      const res = await http().post(path).send({ refreshToken: 'abc\u0000def' });
      expect(res.status).toBeLessThan(500);
    });

    it.each(['/auth/refresh', '/auth/logout'])('%s does not answer 500 to a lone surrogate', async (path) => {
      const res = await raw(path, '{"refreshToken":"abc\\ud800"}');
      expect(res.status).toBeLessThan(500);
    });
  });
});
