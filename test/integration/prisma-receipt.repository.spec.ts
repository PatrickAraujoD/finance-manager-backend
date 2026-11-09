import { ConflictError } from '../../src/domain/errors';
import { Email } from '../../src/domain/email';
import { Receipt } from '../../src/domain/entities/receipt';
import { User } from '../../src/domain/entities/user';
import { Money } from '../../src/domain/money';
import { PrismaReceiptRepository } from '../../src/infrastructure/prisma/prisma-receipt.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const receipt = (over: Partial<Parameters<typeof Receipt.create>[0]> = {}) =>
  Receipt.create({
    id: 'r1',
    userId: 'u1',
    storageKey: 'abc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    suggestedAmount: Money.fromCents(12345),
    ...over,
  });

describe('PrismaReceiptRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaReceiptRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaReceiptRepository(prisma);
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await new PrismaUserRepository(prisma).save(
      User.create({
        id: 'u1',
        name: 'u1',
        email: Email.create('u1@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
  });
  afterAll(() => prisma.disconnect());

  it('saves and finds a receipt with a suggested amount', async () => {
    await repo.save(receipt());
    const found = await repo.findById('r1');
    expect(found).toMatchObject({
      id: 'r1',
      userId: 'u1',
      storageKey: 'abc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(found?.suggestedAmount?.cents).toBe(12345);
  });

  it('keeps a missing suggestion as null', async () => {
    await repo.save(receipt({ suggestedAmount: null }));
    expect((await repo.findById('r1'))?.suggestedAmount).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('upserts: saving the same id replaces the row', async () => {
    await repo.save(receipt());
    await repo.save(receipt({ suggestedAmount: Money.fromCents(99) }));
    expect((await repo.findById('r1'))?.suggestedAmount?.cents).toBe(99);
  });

  it('never hands a receipt over to another user: saving an existing id as someone else fails', async () => {
    await new PrismaUserRepository(prisma).save(
      User.create({
        id: 'u2',
        name: 'u2',
        email: Email.create('u2@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    await repo.save(receipt());
    await expect(
      repo.save(receipt({ userId: 'u2', suggestedAmount: Money.fromCents(1) })),
    ).rejects.toThrow(ConflictError);
    const stored = await repo.findById('r1');
    expect(stored?.userId).toBe('u1');
    expect(stored?.suggestedAmount?.cents).toBe(12345);
  });

  it('lets exactly one of two concurrent saves of the same id win, and keeps its data', async () => {
    await new PrismaUserRepository(prisma).save(
      User.create({
        id: 'u2',
        name: 'u2',
        email: Email.create('u2@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    for (let round = 0; round < 15; round++) {
      const id = `race-${round}`;
      const results = await Promise.allSettled([
        repo.save(receipt({ id, userId: 'u1', storageKey: `a${round}.pdf`, suggestedAmount: Money.fromCents(111) })),
        repo.save(receipt({ id, userId: 'u2', storageKey: `b${round}.pdf`, suggestedAmount: Money.fromCents(222) })),
      ]);
      const winners = results.filter((r) => r.status === 'fulfilled');
      const losers = results.filter((r) => r.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const stored = await repo.findById(id);
      const winnerIsFirst = results[0].status === 'fulfilled';
      expect(stored?.userId).toBe(winnerIsFirst ? 'u1' : 'u2');
      expect(stored?.suggestedAmount?.cents).toBe(winnerIsFirst ? 111 : 222);
      expect(stored?.storageKey).toBe(winnerIsFirst ? `a${round}.pdf` : `b${round}.pdf`);
    }
  });

  it('rejects a duplicated storage key', async () => {
    await repo.save(receipt());
    await expect(repo.save(receipt({ id: 'r2' }))).rejects.toThrow();
  });

  it('rejects a receipt of an unknown user (foreign key)', async () => {
    await expect(repo.save(receipt({ userId: 'ghost' }))).rejects.toThrow();
  });

  it('enforces a positive suggested amount at the database level', async () => {
    await expect(
      prisma.client.$executeRawUnsafe(
        `INSERT INTO "Receipt" ("id","userId","storageKey","mimeType","sizeBytes","suggestedAmountCents")
         VALUES ('r9','u1','z.pdf','application/pdf',10,0)`,
      ),
    ).rejects.toThrow();
  });

  it('restricts deleting a user that owns receipts', async () => {
    await repo.save(receipt());
    await expect(prisma.client.user.delete({ where: { id: 'u1' } })).rejects.toThrow();
  });

  it('links an expense receiptId to an existing receipt only', async () => {
    await prisma.client.category.create({ data: { id: 'c1', name: 'c', nameKey: 'c', ownerId: 'u1' } });
    const expense = (receiptId: string) =>
      prisma.client.expense.create({
        data: {
          id: `e-${receiptId}`,
          userId: 'u1',
          categoryId: 'c1',
          receiptId,
          amountCents: 100n,
          paidAlone: true,
          paymentMethod: 'PIX',
          spentAt: new Date('2026-11-01'),
        },
      });
    await expect(expense('ghost')).rejects.toThrow();
    await repo.save(receipt());
    await expect(expense('r1')).resolves.toBeDefined();
    await expect(prisma.client.receipt.delete({ where: { id: 'r1' } })).rejects.toThrow();
  });
});
