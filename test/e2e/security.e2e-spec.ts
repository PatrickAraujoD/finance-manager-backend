import request from 'supertest';
import { startApp, TestApp } from './support/test-app';

describe('http security', () => {
  describe('defaults', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp();
    });
    afterAll(async () => {
      await t.close();
    });
    const http = () => request(t.app.getHttpServer());

    it('sends helmet headers and hides x-powered-by', async () => {
      const res = await http().get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('sends no CORS headers when CORS_ORIGINS is empty', async () => {
      const res = await http().get('/health').set('Origin', 'https://evil.example.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects a body over the limit with 413', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: 'a@example.com', password: 'x'.repeat(200_000) });
      expect(res.status).toBe(413);
      expect(res.body.message).toBe('Payload Too Large');
    });

    it('rejects malformed JSON with 400 and a generic body', async () => {
      const res = await http()
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.text).not.toMatch(/Unexpected|JSON/);
    });

    it('answers unknown routes with a generic 404', async () => {
      const res = await http().get('/nope');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Not Found');
    });
  });

  describe('CORS allow list', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp({ corsOrigins: ['https://app.example.com'] });
    });
    afterAll(async () => {
      await t.close();
    });

    it('allows only the listed origins', async () => {
      const http = () => request(t.app.getHttpServer());
      const ok = await http().get('/health').set('Origin', 'https://app.example.com');
      const bad = await http().get('/health').set('Origin', 'https://evil.example.com');
      expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limiting', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp({ authThrottleLimit: 5, throttleLimit: 1000 });
    });
    afterAll(async () => {
      await t.close();
    });

    it('answers 429 to the 6th login from the same IP', async () => {
      const http = () => request(t.app.getHttpServer());
      const body = { email: 'ghost@example.com', password: 'whatever it is' };
      for (let i = 0; i < 5; i++) expect((await http().post('/auth/login').send(body)).status).toBe(401);
      expect((await http().post('/auth/login').send(body)).status).toBe(429);
    });

    it('does not apply the strict limit to other routes', async () => {
      const http = () => request(t.app.getHttpServer());
      for (let i = 0; i < 8; i++) expect((await http().get('/health')).status).toBe(200);
    });
  });

  describe('rate limiting behind spoofed X-Forwarded-For', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp({ authThrottleLimit: 5, throttleLimit: 1000, trustProxy: false });
    });
    afterAll(async () => {
      await t.close();
    });

    it('does not let a varying X-Forwarded-For bypass the limit (429 on the 6th)', async () => {
      const http = () => request(t.app.getHttpServer());
      const body = { email: 'ghost@example.com', password: 'whatever it is' };
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await http().post('/auth/login').set('X-Forwarded-For', `203.0.113.${i + 1}`).send(body);
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it('does not let a varying X-Forwarded-For bypass the limit with different emails', async () => {
      const http = () => request(t.app.getHttpServer());
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await http()
          .post('/auth/register')
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .send({ name: 'x', email: `bad${i}`, password: 'short' });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    });
  });

  describe('login throttle keyed by IP and email', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp({
        authThrottleLimit: 30,
        loginEmailThrottleLimit: 5,
        throttleLimit: 1000,
      });
    });
    afterAll(async () => {
      await t.close();
    });
    const http = () => request(t.app.getHttpServer());
    const attempt = (email: string) =>
      http().post('/auth/login').send({ email, password: 'whatever it is' });

    it('answers 429 to the 6th attempt on the same email', async () => {
      for (let i = 0; i < 5; i++) expect((await attempt('victim@example.com')).status).toBe(401);
      expect((await attempt('victim@example.com')).status).toBe(429);
    });

    it('normalizes the email (case and spaces) when counting', async () => {
      for (let i = 0; i < 5; i++) expect((await attempt('norm@example.com')).status).toBe(401);
      expect((await attempt('  NORM@Example.com ')).status).toBe(429);
    });

    it('still serves another email from the same IP within the per-IP limit', async () => {
      expect((await attempt('other@example.com')).status).toBe(401);
    });

    it('does not break on a missing, non string or huge email', async () => {
      for (const email of [undefined, 123, 'a'.repeat(50_000)]) {
        const res = await http().post('/auth/login').send({ email, password: 'x' });
        expect(res.status).toBeLessThan(500);
      }
    });
  });

  describe('login per-IP limit with the email limit out of the way', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startApp({ authThrottleLimit: 8, loginEmailThrottleLimit: 5, throttleLimit: 1000 });
    });
    afterAll(async () => {
      await t.close();
    });

    it('still enforces the per-IP limit across different emails', async () => {
      const http = () => request(t.app.getHttpServer());
      const statuses: number[] = [];
      for (let i = 0; i < 9; i++) {
        const res = await http()
          .post('/auth/login')
          .send({ email: `spray${i}@example.com`, password: 'whatever it is' });
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    });
  });
});
