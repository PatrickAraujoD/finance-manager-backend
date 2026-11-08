import { Email } from '../../src/domain/email';
import { MonthlyIncome } from '../../src/domain/entities/monthly-income';
import { User } from '../../src/domain/entities/user';
import { Money } from '../../src/domain/money';
import { PrismaIncomeRepository } from '../../src/infrastructure/prisma/prisma-income.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const income = (userId: string, month: string, cents: number) =>
  MonthlyIncome.create({ userId, month, amount: Money.fromCents(cents) });

describe('PrismaIncomeRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaIncomeRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaIncomeRepository(prisma);
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

  it('upserts and finds an income', async () => {
    await repo.upsert(income('u1', '2026-11', 500000));
    const found = await repo.find('u1', '2026-11');
    expect(found?.userId).toBe('u1');
    expect(found?.month).toBe('2026-11');
    expect(found?.amount.cents).toBe(500000);
    expect(await repo.find('u1', '2026-10')).toBeNull();
  });

  it('overwrites the same user and month, keeping a single row', async () => {
    await repo.upsert(income('u1', '2026-11', 500000));
    await repo.upsert(income('u1', '2026-11', 650000));
    expect((await repo.find('u1', '2026-11'))?.amount.cents).toBe(650000);
    expect(await prisma.client.monthlyIncome.count()).toBe(1);
  });

  it('keeps users and months apart', async () => {
    await repo.upsert(income('u1', '2026-11', 100));
    await repo.upsert(income('u2', '2026-11', 200));
    await repo.upsert(income('u1', '2026-12', 300));
    expect((await repo.find('u1', '2026-11'))?.amount.cents).toBe(100);
    expect((await repo.find('u2', '2026-11'))?.amount.cents).toBe(200);
    expect((await repo.find('u1', '2026-12'))?.amount.cents).toBe(300);
  });

  it('two concurrent upserts of the same month both succeed and one value wins', async () => {
    for (let round = 0; round < 10; round++) {
      await prisma.client.monthlyIncome.deleteMany();
      const results = await Promise.allSettled([
        repo.upsert(income('u1', '2026-11', 111)),
        repo.upsert(income('u1', '2026-11', 222)),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect([111, 222]).toContain((await repo.find('u1', '2026-11'))?.amount.cents);
      expect(await prisma.client.monthlyIncome.count()).toBe(1);
    }
  });

  it('round-trips the largest accepted amount', async () => {
    await repo.upsert(income('u1', '2026-11', 100_000_000_000));
    expect((await repo.find('u1', '2026-11'))?.amount.cents).toBe(100_000_000_000);
  });

  it('refuses to read a stored value beyond the safe integer range', async () => {
    await prisma.client.$executeRaw`INSERT INTO "MonthlyIncome" ("userId","month","amountCents","updatedAt") VALUES ('u1','2026-11',9007199254740993,now())`;
    await expect(repo.find('u1', '2026-11')).rejects.toThrow(/safe integer/);
  });

  describe('database constraints (bypassing the adapter)', () => {
    const insert = (userId: string, month: string, cents: bigint) =>
      prisma.client.monthlyIncome.create({ data: { userId, month, amountCents: cents } });

    it('rejects a non-positive amount', async () => {
      await expect(insert('u1', '2026-11', 0n)).rejects.toThrow();
      await expect(insert('u1', '2026-11', -5n)).rejects.toThrow();
    });

    it.each(['2026-13', '2026-00', '26-1', '2026-1', '2026-111', 'abcd-ef', '2026-11 '])(
      'rejects the malformed month %p',
      async (month) => {
        await expect(insert('u1', month, 100n)).rejects.toThrow();
      },
    );

    it('accepts a well formed month', async () => {
      await expect(insert('u1', '2026-12', 100n)).resolves.toBeDefined();
    });

    it('rejects a user that does not exist', async () => {
      await expect(insert('ghost', '2026-11', 100n)).rejects.toThrow();
    });

    it('rejects a duplicated (user, month) pair', async () => {
      await insert('u1', '2026-11', 100n);
      await expect(insert('u1', '2026-11', 200n)).rejects.toThrow();
    });
  });

  it('removes the incomes together with their user (ON DELETE CASCADE)', async () => {
    await repo.upsert(income('u1', '2026-11', 100));
    await prisma.client.user.delete({ where: { id: 'u1' } });
    expect(await prisma.client.monthlyIncome.count()).toBe(0);
  });

  it('rejects an income above the ceiling in the database itself (CHECK)', async () => {
    const insert = (month: string, cents: number) =>
      prisma.client.$executeRawUnsafe(
        `INSERT INTO "MonthlyIncome" ("userId","month","amountCents","updatedAt")
         VALUES ('u1','${month}',${cents},now())`,
      );
    await expect(insert('2026-01', 100_000_000_000)).resolves.toBe(1);
    await expect(insert('2026-02', 100_000_000_001)).rejects.toThrow();
    await expect(insert('2026-03', 9007199254740993)).rejects.toThrow();
  });
});
