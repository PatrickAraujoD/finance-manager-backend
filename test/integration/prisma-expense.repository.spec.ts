import { Expense } from '../../src/domain/entities/expense';
import { ConflictError, NotFoundError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';
import { PrismaCategoryRepository } from '../../src/infrastructure/prisma/prisma-category.repository';
import { PrismaExpenseRepository } from '../../src/infrastructure/prisma/prisma-expense.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { Category } from '../../src/domain/entities/category';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function expense(
  id: string,
  over: Partial<{
    userId: string;
    categoryId: string;
    receiptId: string | null;
    cents: number;
    paidAlone: boolean;
    spentAt: string;
    description: string;
  }> = {},
): Expense {
  return Expense.create({
    id,
    userId: over.userId ?? 'u1',
    categoryId: over.categoryId ?? 'c1',
    receiptId: over.receiptId ?? null,
    amount: Money.fromCents(over.cents ?? 1050),
    paidAlone: over.paidAlone ?? true,
    spentAt: day(over.spentAt ?? '2026-11-01'),
    description: over.description,
  });
}

describe('PrismaExpenseRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaExpenseRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaExpenseRepository(prisma);
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    for (const id of ['u1', 'u2']) {
      await prisma.client.user.create({
        data: { id, name: id, email: `${id}@x.com`, passwordHash: 'h', role: 'N' },
      });
      await prisma.client.category.create({
        data: { id: `c-${id}`, name: id, nameKey: id, ownerId: id },
      });
    }
    await prisma.client.category.create({ data: { id: 'c1', name: 'Food', nameKey: 'food' } });
    await prisma.client.category.create({ data: { id: 'c2', name: 'Fun', nameKey: 'fun' } });
    for (const [id, userId] of [
      ['r1', 'u1'],
      ['r2', 'u1'],
      ['r3', 'u2'],
    ]) {
      await prisma.client.receipt.create({
        data: { id, userId, storageKey: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 5 },
      });
    }
  });
  afterAll(() => prisma.disconnect());

  it('saves and reads back every field, scoped to the owner', async () => {
    await repo.save(expense('e1', { receiptId: 'r1', description: 'Almoço', cents: 123456 }));
    const found = await repo.findById('u1', 'e1');
    expect(found?.amount.cents).toBe(123456);
    expect(found?.receiptId).toBe('r1');
    expect(found?.description).toBe('Almoço');
    expect(found?.paidAlone).toBe(true);
    expect(found?.spentAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(await repo.findById('u2', 'e1')).toBeNull();
    expect(await repo.findById('u1', 'missing')).toBeNull();
  });

  it('fills createdAt on read and keeps it through an update', async () => {
    await repo.save(expense('e1'));
    const stored = await repo.findById('u1', 'e1');
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(Math.abs((stored?.createdAt as Date).getTime() - Date.now())).toBeLessThan(60_000);
    await repo.update(expense('e1', { cents: 5 }));
    expect((await repo.findById('u1', 'e1'))?.createdAt).toEqual(stored?.createdAt);
  });

  it('stores spentAt as a plain calendar date', async () => {
    await repo.save(expense('e1', { spentAt: '2026-03-31' }));
    const rows = await prisma.client.$queryRaw<{ d: string }[]>`
      SELECT "spentAt"::text AS d FROM "Expense" WHERE id = 'e1'`;
    expect(rows[0].d).toBe('2026-03-31');
  });

  it('refuses a repeated id with ConflictError', async () => {
    await repo.save(expense('e1'));
    await expect(repo.save(expense('e1', { cents: 5 }))).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findById('u1', 'e1'))?.amount.cents).toBe(1050);
  });

  it('maps a missing category or receipt (foreign keys) to NotFoundError', async () => {
    await expect(repo.save(expense('e1', { categoryId: 'nope' }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repo.save(expense('e2', { receiptId: 'nope' }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.client.expense.count()).toBe(0);
  });

  describe('one receipt, one expense', () => {
    it('refuses a second expense with the same receipt (ConflictError)', async () => {
      await repo.save(expense('e1', { receiptId: 'r1' }));
      await expect(repo.save(expense('e2', { receiptId: 'r1' }))).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await prisma.client.expense.count()).toBe(1);
    });

    it('allows many expenses without a receipt', async () => {
      await repo.save(expense('e1'));
      await repo.save(expense('e2'));
      await repo.save(expense('e3'));
      expect(await prisma.client.expense.count()).toBe(3);
    });

    it('lets exactly one of two concurrent creations win (repeated)', async () => {
      for (let round = 0; round < 10; round++) {
        await prisma.client.expense.deleteMany();
        const results = await Promise.allSettled([
          repo.save(expense(`a${round}`, { receiptId: 'r1' })),
          repo.save(expense(`b${round}`, { receiptId: 'r1' })),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].reason).toBeInstanceOf(ConflictError);
        expect(await prisma.client.expense.count()).toBe(1);
      }
    });

    it('is enforced by the database itself', async () => {
      await repo.save(expense('e1', { receiptId: 'r1' }));
      await expect(
        prisma.client.$executeRaw`INSERT INTO "Expense"
          ("id","userId","categoryId","receiptId","amountCents","paidAlone","spentAt")
          VALUES ('x','u1','c1','r1',100,true,'2026-11-01')`,
      ).rejects.toThrow();
    });

    it('frees the receipt after the expense is deleted', async () => {
      await repo.save(expense('e1', { receiptId: 'r1' }));
      expect(await repo.delete('u1', 'e1')).toBe(true);
      await repo.save(expense('e2', { receiptId: 'r1' }));
      expect(await prisma.client.receipt.count()).toBe(3);
    });
  });

  describe('update', () => {
    it('changes the editable fields and never userId or receiptId', async () => {
      await repo.save(expense('e1', { receiptId: 'r1', description: 'a' }));
      const changed = Expense.create({
        id: 'e1',
        userId: 'u2',
        categoryId: 'c2',
        receiptId: 'r2',
        amount: Money.fromCents(777),
        paidAlone: false,
        spentAt: day('2026-10-10'),
      });
      expect(await repo.update(changed)).toBe(false);
      const own = Expense.create({
        id: 'e1',
        userId: 'u1',
        categoryId: 'c2',
        receiptId: 'r2',
        amount: Money.fromCents(777),
        paidAlone: false,
        spentAt: day('2026-10-10'),
      });
      expect(await repo.update(own)).toBe(true);
      const stored = await repo.findById('u1', 'e1');
      expect(stored?.categoryId).toBe('c2');
      expect(stored?.amount.cents).toBe(777);
      expect(stored?.paidAlone).toBe(false);
      expect(stored?.spentAt.toISOString()).toBe('2026-10-10T00:00:00.000Z');
      expect(stored?.description).toBeUndefined();
      expect(stored?.receiptId).toBe('r1');
      expect(stored?.userId).toBe('u1');
    });

    it('returns false for a missing id and NotFoundError for a missing category', async () => {
      expect(await repo.update(expense('ghost'))).toBe(false);
      await repo.save(expense('e1'));
      await expect(repo.update(expense('e1', { categoryId: 'nope' }))).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await repo.findById('u1', 'e1'))?.categoryId).toBe('c1');
    });
  });

  describe('delete', () => {
    it('deletes only the owner row and leaves the receipt and category alone', async () => {
      await repo.save(expense('e1', { receiptId: 'r1' }));
      expect(await repo.delete('u2', 'e1')).toBe(false);
      expect(await repo.findById('u1', 'e1')).not.toBeNull();
      expect(await repo.delete('u1', 'e1')).toBe(true);
      expect(await repo.delete('u1', 'e1')).toBe(false);
      expect(await prisma.client.receipt.count({ where: { id: 'r1' } })).toBe(1);
      expect(await prisma.client.category.count({ where: { id: 'c1' } })).toBe(1);
    });
  });

  describe('listing', () => {
    beforeEach(async () => {
      await repo.save(expense('a', { spentAt: '2026-11-01', categoryId: 'c1' }));
      await repo.save(expense('b', { spentAt: '2026-11-05', categoryId: 'c2' }));
      await repo.save(expense('c', { spentAt: '2026-11-05', categoryId: 'c1' }));
      await repo.save(expense('d', { spentAt: '2026-11-05', categoryId: 'c1' }));
      await repo.save(expense('e', { spentAt: '2026-10-20', categoryId: 'c-u1' }));
      await repo.save(expense('z', { userId: 'u2', spentAt: '2026-11-05', categoryId: 'c1' }));
    });

    const ids = (list: Expense[]) => list.map((e) => e.id);

    it('orders by spentAt desc and id desc, stable within one day', async () => {
      expect(ids(await repo.listByUser('u1', {}))).toEqual(['d', 'c', 'b', 'a', 'e']);
      expect(ids(await repo.listByUser('u1', {}))).toEqual(['d', 'c', 'b', 'a', 'e']);
    });

    it('isolates users', async () => {
      expect(ids(await repo.listByUser('u2', {}))).toEqual(['z']);
      expect(await repo.countByUser('u2', {})).toBe(1);
      expect(await repo.countByUser('nobody', {})).toBe(0);
    });

    it('filters by inclusive date range and by category', async () => {
      expect(
        ids(await repo.listByUser('u1', { from: day('2026-11-01'), to: day('2026-11-05') })),
      ).toEqual(['d', 'c', 'b', 'a']);
      expect(
        ids(await repo.listByUser('u1', { from: day('2026-11-05'), to: day('2026-11-05') })),
      ).toEqual(['d', 'c', 'b']);
      expect(ids(await repo.listByUser('u1', { to: day('2026-10-31') }))).toEqual(['e']);
      expect(ids(await repo.listByUser('u1', { from: day('2026-11-02') }))).toEqual([
        'd',
        'c',
        'b',
      ]);
      expect(ids(await repo.listByUser('u1', { categoryId: 'c2' }))).toEqual(['b']);
      expect(
        await repo.countByUser('u1', { categoryId: 'c1', from: day('2026-11-02') }),
      ).toBe(2);
    });

    it('pages with limit/offset in the same stable order and counts the whole set', async () => {
      expect(ids(await repo.listByUser('u1', {}, { limit: 2, offset: 0 }))).toEqual(['d', 'c']);
      expect(ids(await repo.listByUser('u1', {}, { limit: 2, offset: 2 }))).toEqual(['b', 'a']);
      expect(ids(await repo.listByUser('u1', {}, { limit: 2, offset: 4 }))).toEqual(['e']);
      expect(ids(await repo.listByUser('u1', {}, { limit: 2, offset: 40 }))).toEqual([]);
      expect(await repo.countByUser('u1', {})).toBe(5);
    });
  });

  describe('money and the database constraints', () => {
    it('rejects a non positive amount in the database itself (CHECK)', async () => {
      for (const cents of [0, -5]) {
        await expect(
          prisma.client.$executeRawUnsafe(
            `INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","spentAt")
             VALUES ('bad${Math.abs(cents)}','u1','c1',${cents},true,'2026-11-01')`,
          ),
        ).rejects.toThrow();
      }
    });

    it('reads BIGINT back as an exact number', async () => {
      await repo.save(expense('big', { cents: 1_000_000_000 }));
      expect((await repo.findById('u1', 'big'))?.amount.cents).toBe(1_000_000_000);
    });

    it('fails loudly (never rounds) for a stored value beyond the safe integer range', async () => {
      await prisma.client.$executeRawUnsafe(
        `INSERT INTO "Expense" ("id","userId","categoryId","amountCents","paidAlone","spentAt")
         VALUES ('huge','u1','c1',9007199254740993,true,'2026-11-01')`,
      );
      await expect(repo.findById('u1', 'huge')).rejects.toThrow(/safe integer/);
      await expect(repo.listByUser('u1', {})).rejects.toThrow(/safe integer/);
    });
  });

  describe('categories in use', () => {
    it('blocks deleting a category used by an expense and keeps the expense', async () => {
      const categories = new PrismaCategoryRepository(prisma);
      await repo.save(expense('e1', { categoryId: 'c-u1' }));
      await expect(categories.delete('c-u1')).rejects.toBeInstanceOf(ConflictError);
      expect(await categories.isInUse('c-u1')).toBe(true);
      expect(await repo.findById('u1', 'e1')).not.toBeNull();
      expect(await categories.findById('c-u1')).toBeInstanceOf(Category);
      await repo.delete('u1', 'e1');
      await categories.delete('c-u1');
      expect(await categories.findById('c-u1')).toBeNull();
    });
  });
});
