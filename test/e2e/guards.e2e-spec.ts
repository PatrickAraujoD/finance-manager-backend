import { Controller, Get, UseGuards } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Roles } from '../../src/presentation/http/decorators/roles.decorator';
import { JwtAuthGuard } from '../../src/presentation/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/presentation/http/guards/roles.guard';
import { ACCESS_SECRET, cleanTables, startApp, TestApp } from './support/test-app';

const PASSWORD = 'correct horse battery';

@Controller('probe')
class ProbeController {
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('A')
  admin(): { ok: true } {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail at /srv/app/db.ts');
  }
}

describe('authentication and authorization guards', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp({}, [ProbeController]);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await cleanTables(t.prisma);
  });

  const http = () => request(t.app.getHttpServer());

  async function signUp(email = 'ana@example.com') {
    const { body } = await http().post('/auth/register').send({ name: 'Ana', email, password: PASSWORD });
    const login = await http().post('/auth/login').send({ email, password: PASSWORD });
    return { id: body.id as string, accessToken: login.body.accessToken as string };
  }

  describe('GET /auth/me', () => {
    it('rejects a request without a token (401)', async () => {
      expect((await http().get('/auth/me')).status).toBe(401);
    });

    it('returns the profile without the password hash', async () => {
      const { id, accessToken } = await signUp();
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, name: 'Ana', email: 'ana@example.com', role: 'N' });
      expect(JSON.stringify(res.body)).not.toMatch(/hash|argon/i);
    });

    it('rejects a tampered token (401)', async () => {
      const { accessToken } = await signUp();
      const tampered = `${accessToken.slice(0, -3)}${accessToken.endsWith('aaa') ? 'bbb' : 'aaa'}`;
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });

    it('rejects a token signed with another secret (401)', async () => {
      const { id } = await signUp();
      const forged = jwt.sign({ role: 'A' }, 'z'.repeat(48), { subject: id, expiresIn: 600 });
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token (401)', async () => {
      const { id } = await signUp();
      const iat = Math.floor(Date.now() / 1000) - 3600;
      const expired = jwt.sign({ role: 'N', iat }, ACCESS_SECRET, { subject: id, expiresIn: 60 });
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('rejects a deactivated user whose access token is still valid (401)', async () => {
      const { accessToken } = await signUp();
      await t.prisma.client.user.update({
        where: { email: 'ana@example.com' },
        data: { active: false },
      });
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });

    it('rejects a valid token whose user no longer exists (401)', async () => {
      const { accessToken } = await signUp();
      await cleanTables(t.prisma);
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe('@Roles', () => {
    it('answers 403 to a normal user and 200 to an admin', async () => {
      const normal = await signUp('normal@example.com');
      const admin = await signUp('admin@example.com');
      await t.prisma.client.user.update({ where: { email: 'admin@example.com' }, data: { role: 'A' } });

      const forbidden = await http()
        .get('/probe/admin')
        .set('Authorization', `Bearer ${normal.accessToken}`);
      const allowed = await http()
        .get('/probe/admin')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(forbidden.status).toBe(403);
      expect(allowed.status).toBe(200);
    });

    it('answers 401 without a token', async () => {
      expect((await http().get('/probe/admin')).status).toBe(401);
    });
  });

  describe('unexpected errors', () => {
    it('returns a generic 500 without stack or internal message', async () => {
      const res = await http().get('/probe/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal Server Error',
      });
      expect(res.text).not.toMatch(/secret|stack|\.ts|at /);
    });
  });
});
