import request from 'supertest';
import { bearer, PASSWORD, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('users admin endpoints', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;

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
  });

  const http = () => request(t.app.getHttpServer());

  describe('GET /users', () => {
    it('requires a token (401)', async () => {
      expect((await http().get('/users')).status).toBe(401);
    });

    it('forbids a normal user (403)', async () => {
      expect((await http().get('/users').set(...bearer(ana))).status).toBe(403);
    });

    it('lets the admin list users with explicit fields and never the password hash', async () => {
      const res = await http().get('/users').set(...bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      for (const user of res.body) {
        expect(Object.keys(user).sort()).toEqual(['active', 'createdAt', 'email', 'id', 'name', 'role']);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
      expect(res.body.map((u: { email: string }) => u.email)).toEqual([
        'admin@example.com',
        'ana@example.com',
      ]);
    });
  });

  describe('PATCH /users/:id', () => {
    const patch = (s: Session | null, id: string, body: unknown) => {
      const req = http().patch(`/users/${id}`);
      if (s) req.set(...bearer(s));
      return req.send(body as object);
    };

    it('requires a token (401)', async () => {
      expect((await patch(null, ana.id, { role: 'A' })).status).toBe(401);
    });

    it('forbids a normal user, even on themselves (403)', async () => {
      expect((await patch(ana, ana.id, { role: 'A' })).status).toBe(403);
      const row = await t.prisma.client.user.findUnique({ where: { id: ana.id } });
      expect(row?.role).toBe('N');
    });

    it('lets the admin change another user role, effective on the next request', async () => {
      expect((await http().get('/users').set(...bearer(ana))).status).toBe(403);
      const res = await patch(admin, ana.id, { role: 'A' });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['active', 'createdAt', 'email', 'id', 'name', 'role']);
      expect(res.body.role).toBe('A');
      expect((await http().get('/users').set(...bearer(ana))).status).toBe(200);
    });

    it('denies an admin demoting or deactivating themselves (403)', async () => {
      expect((await patch(admin, admin.id, { role: 'N' })).status).toBe(403);
      expect((await patch(admin, admin.id, { active: false })).status).toBe(403);
      const row = await t.prisma.client.user.findUnique({ where: { id: admin.id } });
      expect(row).toMatchObject({ role: 'A', active: true });
    });

    it('with two admins, one demotes the other but the system keeps an admin', async () => {
      const second = await signUp(t, 'second@example.com', 'A');
      expect((await patch(admin, second.id, { role: 'N' })).status).toBe(200);
      expect((await patch(second, admin.id, { role: 'N' })).status).toBe(403);
      expect(await t.prisma.client.user.count({ where: { role: 'A', active: true } })).toBe(1);
    });

    it('deactivating a user cuts access at once and revokes refresh tokens', async () => {
      expect((await http().get('/auth/me').set(...bearer(ana))).status).toBe(200);
      const res = await patch(admin, ana.id, { active: false });
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);

      // The access token is still cryptographically valid, but the account is inactive.
      expect((await http().get('/auth/me').set(...bearer(ana))).status).toBe(401);
      expect(
        (await http().post('/auth/refresh').send({ refreshToken: ana.refreshToken })).status,
      ).toBe(401);
      expect(
        (await http().post('/auth/login').send({ email: ana.email, password: PASSWORD })).status,
      ).toBe(401);
      expect(
        await t.prisma.client.refreshToken.count({ where: { userId: ana.id, revokedAt: null } }),
      ).toBe(0);
    });

    it('a deactivated admin loses access even with a still valid access token', async () => {
      const second = await signUp(t, 'second@example.com', 'A');
      expect((await http().get('/users').set(...bearer(second))).status).toBe(200);
      expect((await patch(admin, second.id, { active: false })).status).toBe(200);
      expect((await http().get('/users').set(...bearer(second))).status).toBe(401);
      expect(
        await t.prisma.client.refreshToken.count({ where: { userId: second.id, revokedAt: null } }),
      ).toBe(0);
    });

    it('reactivating restores the ability to log in', async () => {
      await patch(admin, ana.id, { active: false });
      await patch(admin, ana.id, { active: true });
      expect(
        (await http().post('/auth/login').send({ email: ana.email, password: PASSWORD })).status,
      ).toBe(200);
    });

    it('rejects unknown fields (400) without changing anything', async () => {
      for (const body of [
        { role: 'A', passwordHash: 'x' },
        { email: 'new@example.com' },
        { id: UUID },
      ]) {
        expect((await patch(admin, ana.id, body)).status).toBe(400);
      }
      const row = await t.prisma.client.user.findUnique({ where: { id: ana.id } });
      expect(row).toMatchObject({ role: 'N', email: 'ana@example.com' });
    });

    it('rejects an empty body and invalid values (400)', async () => {
      expect((await patch(admin, ana.id, {})).status).toBe(400);
      expect((await patch(admin, ana.id, { role: 'X' })).status).toBe(400);
      expect((await patch(admin, ana.id, { role: 'a' })).status).toBe(400);
      expect((await patch(admin, ana.id, { active: 'false' })).status).toBe(400);
      expect((await patch(admin, ana.id, { active: null })).status).toBe(400);
    });

    it('rejects a malformed id (400) and answers 404 for an unknown one', async () => {
      expect((await patch(admin, 'not-a-uuid', { role: 'A' })).status).toBe(400);
      expect((await patch(admin, UUID, { role: 'A' })).status).toBe(404);
    });
  });
});
