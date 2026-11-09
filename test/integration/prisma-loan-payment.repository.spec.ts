import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors';
import { PrismaLoanPaymentRepository } from '../../src/infrastructure/prisma/prisma-loan-payment.repository';
import { PrismaLoanRepository } from '../../src/infrastructure/prisma/prisma-loan.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { describeLoanPaymentRepositoryContract, payment } from '../support/loan-payment-repository-contract';
import { loan } from '../support/loan-repository-contract';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

let prisma: PrismaService;

beforeAll(() => {
  prisma = createPrismaService();
});
afterAll(() => prisma.disconnect());

async function seed(): Promise<void> {
  await cleanDatabase(prisma);
  for (const id of ['u1', 'u2']) {
    await prisma.client.user.create({
      data: { id, name: id, email: `${id}@x.com`, passwordHash: 'h', role: 'N' },
    });
  }
  for (let i = 1; i <= 6; i++) {
    await prisma.client.receipt.create({
      data: { id: `r${i}`, userId: 'u1', storageKey: `k${i}`, mimeType: 'application/pdf', sizeBytes: 10 },
    });
  }
}

// The very same contract the in-memory fake must honor.
describeLoanPaymentRepositoryContract('PrismaLoanPaymentRepository', async () => ({
  repo: new PrismaLoanPaymentRepository(prisma),
  loans: new PrismaLoanRepository(prisma),
  ready: seed,
}));

describe('PrismaLoanPaymentRepository (Postgres specifics)', () => {
  let repo: PrismaLoanPaymentRepository;
  let loans: PrismaLoanRepository;
  beforeEach(async () => {
    repo = new PrismaLoanPaymentRepository(prisma);
    loans = new PrismaLoanRepository(prisma);
    await seed();
    await loans.save(loan('l1', { cents: 10_000 }));
  });

  const insert = (over: Record<string, unknown>) =>
    prisma.client.loanPayment.create({
      data: {
        id: `x-${Math.random()}`,
        loanId: 'l1',
        userId: 'u1',
        amountCents: 100n,
        method: 'CASH',
        paidAt: new Date('2026-11-08T00:00:00Z'),
        ...over,
      } as never,
    });

  it('stores the amount as BIGINT and the date as a plain DATE', async () => {
    await repo.add(payment('p1', { cents: 987_654, paidAt: '2026-02-28' }));
    const [row] = await prisma.client.$queryRawUnsafe<{ amountCents: bigint; paidAt: string }[]>(
      `SELECT "amountCents", "paidAt"::text AS "paidAt" FROM "LoanPayment"`,
    );
    expect(row.amountCents).toBe(987_654n);
    expect(row.paidAt).toBe('2026-02-28');
  });

  it('refuses, in the database itself, an amount of zero or above the ceiling', async () => {
    await expect(insert({ amountCents: 0n })).rejects.toThrow();
    await expect(insert({ amountCents: -1n })).rejects.toThrow();
    await expect(insert({ amountCents: 1_000_000_001n })).rejects.toThrow();
  });

  it('refuses, in the database itself, a PIX without receipt and a CASH with receipt', async () => {
    await expect(insert({ method: 'PIX', receiptId: null })).rejects.toThrow();
    await expect(insert({ method: 'CASH', receiptId: 'r1' })).rejects.toThrow();
    await expect(insert({ method: 'PIX', receiptId: 'r1' })).resolves.toBeDefined();
    await expect(insert({ method: 'CASH', receiptId: null })).resolves.toBeDefined();
  });

  it('enforces the unique receipt in the database itself', async () => {
    await insert({ method: 'PIX', receiptId: 'r1' });
    await expect(insert({ method: 'PIX', receiptId: 'r1' })).rejects.toThrow();
  });

  it('answers NotFoundError for an unknown receipt (foreign key)', async () => {
    await expect(repo.add(payment('p1', { receiptId: 'ghost' }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps a loan that has payments: deleting it answers ConflictError', async () => {
    await repo.add(payment('p1'));
    await expect(loans.delete('u1', 'l1')).rejects.toBeInstanceOf(ConflictError);
    expect(await loans.findById('u1', 'l1')).not.toBeNull();
    expect(await prisma.client.loanPayment.count()).toBe(1);
  });

  it('keeps a user and a receipt that have payments (Restrict)', async () => {
    await repo.add(payment('p1', { receiptId: 'r1' }));
    await expect(prisma.client.user.delete({ where: { id: 'u1' } })).rejects.toThrow();
    await expect(prisma.client.receipt.delete({ where: { id: 'r1' } })).rejects.toThrow();
  });

  it('never lets concurrent payments overshoot, round after round', async () => {
    for (let round = 0; round < 5; round++) {
      await prisma.client.loanPayment.deleteMany();
      // 20 requests of 700 against 10000: exactly 14 fit (9800), the other 6 are refused.
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => repo.add(payment(`r${round}-${i}`, { cents: 700 }))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(14);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ValidationError);
      }
      const [{ sum }] = await prisma.client.$queryRaw<{ sum: bigint }[]>`
        SELECT COALESCE(SUM("amountCents"), 0)::bigint AS sum FROM "LoanPayment"`;
      expect(sum).toBe(9_800n);
    }
  });

  it('serializes payments per loan only: another loan is not blocked or mixed up', async () => {
    await loans.save(loan('l2', { cents: 1_000 }));
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, (_, i) => repo.add(payment(`a${i}`, { cents: 2_000 }))),
      ...Array.from({ length: 6 }, (_, i) => repo.add(payment(`b${i}`, { loanId: 'l2', cents: 400 }))),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5 + 2);
    const sums = await repo.sumPaidByLoans('u1');
    expect(Object.fromEntries(sums)).toEqual({ l1: 10_000, l2: 800 });
  });
});
