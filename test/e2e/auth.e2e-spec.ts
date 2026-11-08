import request from 'supertest';
import { cleanTables, startApp, TestApp } from './support/test-app';

const PASSWORD = 'correct horse battery';

describe('auth endpoints', () => {
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
  const register = (email = 'ana@example.com', password = PASSWORD) =>
    http().post('/auth/register').send({ name: 'Ana', email, password });
  const login = (email = 'ana@example.com', password = PASSWORD) =>
    http().post('/auth/login').send({ email, password });

  describe('POST /auth/register', () => {
    it('creates the user and returns only its id', async () => {
      const res = await register();
      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['id']);
      expect(typeof res.body.id).toBe('string');
    });

    it('treats an email with different case as a duplicate (409)', async () => {
      await register('Ana@Example.com');
      const res = await register('ana@example.com');
      expect(res.status).toBe(409);
    });

    it('rejects a short password (400)', async () => {
      expect((await register('ana@example.com', 'short')).status).toBe(400);
    });

    it('rejects an invalid email (400)', async () => {
      expect((await register('not-an-email')).status).toBe(400);
    });

    it('rejects an extra role field (400)', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD, role: 'A' });
      expect(res.status).toBe(400);
      expect(await t.prisma.client.user.count()).toBe(0);
    });
  });

  describe('POST /auth/login', () => {
    it('returns an access and a refresh token', async () => {
      await register();
      const res = await login();
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('answers every failure scenario with the same 401 body', async () => {
      await register('wrong@example.com');
      await register('inactive@example.com');
      await register('locked@example.com');
      await t.prisma.client.user.update({
        where: { email: 'inactive@example.com' },
        data: { active: false },
      });
      for (let i = 0; i < 5; i++) await login('locked@example.com', 'bad password here');

      const unknown = await login('ghost@example.com');
      const wrong = await login('wrong@example.com', 'bad password here');
      const inactive = await login('inactive@example.com');
      const locked = await login('locked@example.com');

      for (const res of [unknown, wrong, inactive, locked]) expect(res.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(inactive.body).toEqual(unknown.body);
      expect(locked.body).toEqual(unknown.body);
    });

    it('locks after 5 failures and keeps refusing the right password', async () => {
      await register();
      for (let i = 0; i < 5; i++) expect((await login('ana@example.com', 'bad one')).status).toBe(401);
      expect((await login()).status).toBe(401);
    });

    it('rejects a password over 128 characters (400)', async () => {
      expect((await login('ana@example.com', 'x'.repeat(129))).status).toBe(400);
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh token', async () => {
      await register();
      const first = (await login()).body;
      const res = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      expect(typeof res.body.accessToken).toBe('string');
    });

    it('revokes the whole family when an old refresh token is reused', async () => {
      await register();
      const first = (await login()).body;
      const second = (await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }))
        .body;
      const reuse = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken });
      expect(reuse.status).toBe(401);
      const newer = await http().post('/auth/refresh').send({ refreshToken: second.refreshToken });
      expect(newer.status).toBe(401);
    });

    it('rejects an unknown refresh token (401) and a missing one (400)', async () => {
      expect((await http().post('/auth/refresh').send({ refreshToken: 'nope' })).status).toBe(401);
      expect((await http().post('/auth/refresh').send({})).status).toBe(400);
    });

    it('logout revokes the session (204)', async () => {
      await register();
      const { refreshToken } = (await login()).body;
      const out = await http().post('/auth/logout').send({ refreshToken });
      expect(out.status).toBe(204);
      expect((await http().post('/auth/refresh').send({ refreshToken })).status).toBe(401);
    });
  });
});
