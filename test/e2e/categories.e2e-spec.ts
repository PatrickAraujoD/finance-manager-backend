import request from 'supertest';
import { bearer, Session, signUp } from './support/auth-helpers';
import { cleanTables, startApp, TestApp } from './support/test-app';

const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('categories endpoints', () => {
  let t: TestApp;
  let admin: Session;
  let ana: Session;
  let bob: Session;

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
    bob = await signUp(t, 'bob@example.com');
  });

  const http = () => request(t.app.getHttpServer());
  const create = (s: Session, body: object) => http().post('/categories').set(...bearer(s)).send(body);
  const list = (s: Session) => http().get('/categories').set(...bearer(s));

  it('rejects every route without a token (401)', async () => {
    expect((await http().get('/categories')).status).toBe(401);
    expect((await http().post('/categories').send({ name: 'x' })).status).toBe(401);
    expect((await http().patch(`/categories/${UUID}`).send({ name: 'x' })).status).toBe(401);
    expect((await http().delete(`/categories/${UUID}`)).status).toBe(401);
  });

  describe('create and list', () => {
    it('creates a personal category and lists it with explicit fields', async () => {
      const res = await create(ana, { name: '  Mercado ' });
      expect(res.status).toBe(201);
      expect(typeof res.body.id).toBe('string');
      const listed = await list(ana);
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([{ id: res.body.id, name: 'Mercado', global: false }]);
    });

    it('lets the admin create a global category visible to everyone', async () => {
      const res = await create(admin, { name: 'Alimentacao', global: true });
      expect(res.status).toBe(201);
      for (const s of [admin, ana, bob]) {
        const body = (await list(s)).body as { name: string; global: boolean }[];
        expect(body).toEqual([expect.objectContaining({ name: 'Alimentacao', global: true })]);
      }
    });

    it('does not let a normal user create a global category (403)', async () => {
      expect((await create(ana, { name: 'Food', global: true })).status).toBe(403);
      expect((await list(bob)).body).toEqual([]);
    });

    it('keeps personal categories private', async () => {
      await create(ana, { name: 'Ana only' });
      expect((await list(bob)).body).toEqual([]);
      expect((await list(admin)).body).toEqual([]);
    });

    it('answers 409 for a duplicate name in the same scope, ignoring case', async () => {
      await create(ana, { name: 'Mercado' });
      expect((await create(ana, { name: 'MERCADO ' })).status).toBe(409);
      await create(admin, { name: 'Food', global: true });
      expect((await create(admin, { name: 'food', global: true })).status).toBe(409);
      // Another user may reuse the name.
      expect((await create(bob, { name: 'Mercado' })).status).toBe(201);
    });

    it('rejects extra fields, bad types and bad names (400)', async () => {
      const bad = [
        { name: 'x', ownerId: ana.id },
        { name: 'x', global: 'true' },
        { name: 'x', id: UUID },
        {},
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(61) },
        { name: 42 },
        { name: 'nul\u0000byte' },
        { name: 'lone\ud800surrogate' },
      ];
      for (const body of bad) expect((await create(ana, body)).status).toBe(400);
      expect((await list(ana)).body).toEqual([]);
    });
  });

  describe('PATCH /categories/:id', () => {
    const patch = (s: Session, id: string, body: object) =>
      http().patch(`/categories/${id}`).set(...bearer(s)).send(body);

    it('lets the owner rename their category', async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      const res = await patch(ana, id, { name: 'Supermercado' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, name: 'Supermercado', global: false });
    });

    it("answers 404 when user B edits user A's category", async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      expect((await patch(bob, id, { name: 'Hacked' })).status).toBe(404);
      expect((await patch(admin, id, { name: 'Hacked' })).status).toBe(404);
      expect((await patch(ana, UUID, { name: 'x' })).status).toBe(404);
      expect((await list(ana)).body[0].name).toBe('Mercado');
    });

    it('only the admin edits a global category (403 for others)', async () => {
      const { id } = (await create(admin, { name: 'Food', global: true })).body;
      expect((await patch(ana, id, { name: 'Hacked' })).status).toBe(403);
      const res = await patch(admin, id, { name: 'Alimentacao' });
      expect(res.status).toBe(200);
      expect(res.body.global).toBe(true);
    });

    it('answers 409 when renaming into an existing name', async () => {
      await create(ana, { name: 'Mercado' });
      const { id } = (await create(ana, { name: 'Lazer' })).body;
      expect((await patch(ana, id, { name: 'mercado' })).status).toBe(409);
    });

    it('rejects extra fields, a missing name and a malformed id (400)', async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      expect((await patch(ana, id, { name: 'x', ownerId: bob.id })).status).toBe(400);
      expect((await patch(ana, id, { name: 'x', global: true })).status).toBe(400);
      expect((await patch(ana, id, {})).status).toBe(400);
      expect((await patch(ana, 'not-a-uuid', { name: 'x' })).status).toBe(400);
    });
  });

  describe('DELETE /categories/:id', () => {
    const remove = (s: Session, id: string) =>
      http().delete(`/categories/${id}`).set(...bearer(s));

    it('deletes an unused category (204)', async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      expect((await remove(ana, id)).status).toBe(204);
      expect((await list(ana)).body).toEqual([]);
    });

    it("answers 404 for another user's category and keeps it", async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      expect((await remove(bob, id)).status).toBe(404);
      expect((await remove(admin, id)).status).toBe(404);
      expect((await list(ana)).body).toHaveLength(1);
    });

    it('only the admin deletes a global category', async () => {
      const { id } = (await create(admin, { name: 'Food', global: true })).body;
      expect((await remove(ana, id)).status).toBe(403);
      expect((await remove(admin, id)).status).toBe(204);
    });

    it('answers 409 for a category in use and keeps category and expenses', async () => {
      const { id } = (await create(ana, { name: 'Mercado' })).body;
      await t.prisma.client.expense.create({
        data: {
          id: 'e1',
          userId: ana.id,
          categoryId: id,
          amountCents: 1050n,
          paidAlone: true,
          paymentMethod: 'PIX',
          spentAt: new Date('2026-11-01T00:00:00Z'),
        },
      });
      expect((await remove(ana, id)).status).toBe(409);
      expect((await list(ana)).body).toHaveLength(1);
      expect(await t.prisma.client.expense.count()).toBe(1);
    });

    it('rejects a malformed id (400) and answers 404 for an unknown one', async () => {
      expect((await remove(ana, 'not-a-uuid')).status).toBe(400);
      expect((await remove(ana, UUID)).status).toBe(404);
    });
  });
});
