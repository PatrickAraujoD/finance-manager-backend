import { Expense } from '../../src/domain/entities/expense';
import { ConflictError, NotFoundError } from '../../src/domain/errors';
import { PrismaExpenseRepository } from '../../src/infrastructure/prisma/prisma-expense.repository';
import { PrismaLoanRepository } from '../../src/infrastructure/prisma/prisma-loan.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { describeLoanRepositoryContract, loan } from '../support/loan-repository-contract';
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
  await prisma.client.category.create({ data: { id: 'c1', name: 'Food', nameKey: 'food' } });
  for (const id of ['e1', 'e2']) {
    await prisma.client.expense.create({
      data: {
        id,
        userId: 'u1',
        categoryId: 'c1',
        amountCents: 5000n,
        paidAlone: true,
        paymentMethod: 'PIX',
        spentAt: new Date('2026-11-01T00:00:00Z'),
      },
    });
  }
}

// The very same contract the in-memory fake must honor.
describeLoanRepositoryContract('PrismaLoanRepository', async () => ({
  repo: new PrismaLoanRepository(prisma),
  ready: seed,
}));

describe('PrismaLoanRepository (Postgres specifics)', () => {
  let repo: PrismaLoanRepository;
  beforeEach(async () => {
    repo = new PrismaLoanRepository(prisma);
    await seed();
  });

  it('answers NotFoundError for an unknown user or expense (foreign key)', async () => {
    await expect(repo.save(loan('l1', { userId: 'ghost' }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.save(loan('l2', { expenseId: 'ghost' }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('stores the amount as BIGINT and the due date as a plain DATE', async () => {
    await repo.save(loan('l1', { cents: 987_654_321, dueDate: '2026-02-28' }));
    const [row] = await prisma.client.$queryRawUnsafe<
      { amountCents: bigint; dueDate: string }[]
    >(`SELECT "amountCents", "dueDate"::text AS "dueDate" FROM "Loan"`);
    expect(row.amountCents).toBe(987_654_321n);
    expect(row.dueDate).toBe('2026-02-28');
  });

  it('refuses, in the database itself, an amount of zero or above the ceiling', async () => {
    const insert = (cents: bigint) =>
      prisma.client.loan.create({
        data: {
          id: `x-${cents}`,
          userId: 'u1',
          borrowerName: 'Carlos',
          amountCents: cents,
          dueDate: new Date('2026-12-10T00:00:00Z'),
          paymentMethod: 'PIX',
          lentAt: new Date('2026-11-08T00:00:00Z'),
        },
      });
    await expect(insert(0n)).rejects.toThrow();
    await expect(insert(-1n)).rejects.toThrow();
    await expect(insert(1_000_000_001n)).rejects.toThrow();
    await expect(insert(1_000_000_000n)).resolves.toBeDefined();
  });

  it('refuses, in the database itself, a payment method and a lent date out of step with the expense', async () => {
    const insert = (
      id: string,
      expenseId: string | null,
      paymentMethod: 'PIX' | null,
      lentAt: string | null,
    ) =>
      prisma.client.loan.create({
        data: {
          id,
          userId: 'u1',
          borrowerName: 'Carlos',
          amountCents: 100n,
          dueDate: new Date('2026-12-10T00:00:00Z'),
          expenseId,
          paymentMethod,
          lentAt: lentAt ? new Date(`${lentAt}T00:00:00Z`) : null,
        },
      });
    // Direct loan: both are mandatory, one is not enough.
    await expect(insert('x1', null, null, null)).rejects.toThrow();
    await expect(insert('x2', null, 'PIX', null)).rejects.toThrow();
    await expect(insert('x3', null, null, '2026-11-08')).rejects.toThrow();
    // Loan from an expense: neither is allowed.
    await expect(insert('x4', 'e1', 'PIX', null)).rejects.toThrow();
    await expect(insert('x5', 'e1', null, '2026-11-08')).rejects.toThrow();
    await expect(insert('x6', 'e1', 'PIX', '2026-11-08')).rejects.toThrow();
    // The two valid shapes still go in.
    await expect(insert('ok1', null, 'PIX', '2026-11-08')).resolves.toBeDefined();
    await expect(insert('ok2', 'e1', null, null)).resolves.toBeDefined();
  });

  it('keeps an expense that has a loan: deleting it answers ConflictError', async () => {
    await repo.save(loan('l1', { expenseId: 'e1' }));
    const expenses = new PrismaExpenseRepository(prisma);
    await expect(expenses.delete('u1', 'e1')).rejects.toBeInstanceOf(ConflictError);
    expect(await expenses.findById('u1', 'e1')).toBeInstanceOf(Expense);
    // An expense without a loan is still deletable.
    expect(await expenses.delete('u1', 'e2')).toBe(true);
  });

  it('answers ConflictError when a payment lands right after the check (foreign key race)', async () => {
    await repo.save(loan('l1'));
    // Written straight to the table, as a payment racing past DeleteLoan's "no payments" check.
    await prisma.client.loanPayment.create({
      data: {
        id: 'p1',
        loanId: 'l1',
        userId: 'u1',
        amountCents: 100n,
        method: 'CASH',
        paidAt: new Date('2026-11-08T00:00:00Z'),
      },
    });
    await expect(repo.delete('u1', 'l1')).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.findById('u1', 'l1')).not.toBeNull();
  });

  it('keeps a user that has loans (Restrict)', async () => {
    await repo.save(loan('l1'));
    await expect(prisma.client.user.delete({ where: { id: 'u1' } })).rejects.toThrow();
  });
});
