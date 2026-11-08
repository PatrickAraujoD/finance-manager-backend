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
          spentAt: new Date('2026-11-01'),
        },
      });
    await expect(expense('ghost')).rejects.toThrow();
    await repo.save(receipt());
    await expect(expense('r1')).resolves.toBeDefined();
    await expect(prisma.client.receipt.delete({ where: { id: 'r1' } })).rejects.toThrow();
  });
});
