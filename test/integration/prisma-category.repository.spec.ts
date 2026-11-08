import { Email } from '../../src/domain/email';
import { Category } from '../../src/domain/entities/category';
import { User } from '../../src/domain/entities/user';
import { ConflictError } from '../../src/domain/errors';
import { PrismaCategoryRepository } from '../../src/infrastructure/prisma/prisma-category.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const cat = (id: string, name: string, ownerId: string | null) =>
  Category.create({ id, name, ownerId });

describe('PrismaCategoryRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaCategoryRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaCategoryRepository(prisma);
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    const users = new PrismaUserRepository(prisma);
    for (const id of ['u1', 'u2']) {
      await users.save(
        User.create({
          id,
          name: id,
          email: Email.create(`${id}@x.com`),
          passwordHash: 'h',
          role: 'N',
        }),
      );
    }
  });
  afterAll(() => prisma.disconnect());

  const insertExpense = (id: string, userId: string, categoryId: string) =>
    prisma.client.expense.create({
      data: {
        id,
        userId,
        categoryId,
        amountCents: 1050n,
        paidAlone: true,
        spentAt: new Date('2026-11-01T00:00:00Z'),
      },
    });

  it('saves, finds and updates (upsert) a category', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await repo.save(cat('c1', 'Supermercado', 'u1'));
    const found = await repo.findById('c1');
    expect(found?.name).toBe('Supermercado');
    expect(found?.ownerId).toBe('u1');
    expect(await repo.findById('nope')).toBeNull();
  });

  it('keeps global categories global (ownerId null)', async () => {
    await repo.save(cat('g1', 'Food', null));
    expect((await repo.findById('g1'))?.isGlobal()).toBe(true);
  });

  it('rejects the same name per owner ignoring case and spaces (ConflictError)', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await expect(repo.save(cat('c2', '  MERCADO ', 'u1'))).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.findById('c2')).toBeNull();
  });

  it('rejects duplicate global names ignoring case (partial unique index)', async () => {
    await repo.save(cat('g1', 'Food', null));
    await expect(repo.save(cat('g2', 'fOOd', null))).rejects.toBeInstanceOf(ConflictError);
  });

  it('enforces the global uniqueness in the database itself, not only in the adapter', async () => {
    await repo.save(cat('g1', 'Food', null));
    await expect(
      prisma.client.$executeRaw`INSERT INTO "Category" ("id","name","nameKey") VALUES ('g9','x','food')`,
    ).rejects.toThrow();
  });

  it('allows the same name for different owners and for global vs personal', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await repo.save(cat('c2', 'Mercado', 'u2'));
    await repo.save(cat('g1', 'Mercado', null));
    expect(await prisma.client.category.count()).toBe(3);
  });

  it('rejects renaming into an existing name of the same scope', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await repo.save(cat('c2', 'Lazer', 'u1'));
    await expect(repo.save(cat('c2', 'mercado', 'u1'))).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findById('c2'))?.name).toBe('Lazer');
  });

  it('listVisibleTo returns globals plus own, ordered by name, never others', async () => {
    await repo.save(cat('c1', 'Zebra', 'u1'));
    await repo.save(cat('c2', 'Other user', 'u2'));
    await repo.save(cat('g1', 'Food', null));
    await repo.save(cat('c3', 'alpha', 'u1'));
    const names = (await repo.listVisibleTo('u1')).map((c) => c.name);
    expect(names).toEqual(['alpha', 'Food', 'Zebra']);
  });

  it('countOwnedBy counts only the personal categories of that user', async () => {
    await repo.save(cat('c1', 'A', 'u1'));
    await repo.save(cat('c2', 'B', 'u1'));
    await repo.save(cat('c3', 'C', 'u2'));
    await repo.save(cat('g1', 'Food', null));
    expect(await repo.countOwnedBy('u1')).toBe(2);
    expect(await repo.countOwnedBy('u2')).toBe(1);
    expect(await repo.countOwnedBy('nobody')).toBe(0);
  });

  it('isInUse is true only while an expense references the category', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    expect(await repo.isInUse('c1')).toBe(false);
    await insertExpense('e1', 'u1', 'c1');
    expect(await repo.isInUse('c1')).toBe(true);
  });

  it('refuses to delete a category in use (ConflictError) and keeps the expenses', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await insertExpense('e1', 'u1', 'c1');
    await expect(repo.delete('c1')).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.findById('c1')).not.toBeNull();
    expect(await prisma.client.expense.count()).toBe(1);
  });

  it('the database restricts the delete even when bypassing the adapter', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await insertExpense('e1', 'u1', 'c1');
    await expect(prisma.client.category.delete({ where: { id: 'c1' } })).rejects.toThrow();
    expect(await prisma.client.expense.count()).toBe(1);
  });

  it('deletes an unused category and ignores a missing one', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await repo.delete('c1');
    expect(await repo.findById('c1')).toBeNull();
    await expect(repo.delete('c1')).resolves.toBeUndefined();
  });

  it('rejects non-positive expense amounts at the database level', async () => {
    await repo.save(cat('c1', 'Mercado', 'u1'));
    await expect(
      prisma.client.expense.create({
        data: {
          id: 'e0',
          userId: 'u1',
          categoryId: 'c1',
          amountCents: 0n,
          paidAlone: true,
          spentAt: new Date('2026-11-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });
});
