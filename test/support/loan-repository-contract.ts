import { LoanRepository } from '../../src/application/ports/loan-repository';
import { Loan } from '../../src/domain/entities/loan';
import { ConflictError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';

/**
 * What a LoanRepository implementation must do, run against the in-memory fake (unit) and the
 * real Prisma repository (integration) so the two cannot drift apart.
 */
export interface LoanRepositoryHarness {
  repo: LoanRepository;
  /** Makes sure the users u1 and u2 and the expenses e1, e2 (owned by u1) exist. */
  ready(): Promise<void>;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function loan(
  id: string,
  over: Partial<{
    userId: string;
    borrowerName: string;
    cents: number;
    dueDate: string;
    expenseId: string | null;
  }> = {},
): Loan {
  return Loan.create({
    id,
    userId: over.userId ?? 'u1',
    borrowerName: over.borrowerName ?? 'Carlos',
    amount: Money.fromCents(over.cents ?? 5000),
    dueDate: day(over.dueDate ?? '2026-12-10'),
    expenseId: over.expenseId ?? null,
  });
}

export function describeLoanRepositoryContract(
  name: string,
  make: () => Promise<LoanRepositoryHarness>,
): void {
  describe(`${name} loan repository contract`, () => {
    let repo: LoanRepository;

    beforeEach(async () => {
      const harness = await make();
      await harness.ready();
      repo = harness.repo;
    });

    it('saves and reads back every field, scoped to the owner', async () => {
      await repo.save(loan('l1', { cents: 123_456, expenseId: 'e1', borrowerName: 'João' }));
      const found = await repo.findById('u1', 'l1');
      expect(found?.amount.cents).toBe(123_456);
      expect(found?.borrowerName).toBe('João');
      expect(found?.expenseId).toBe('e1');
      expect(found?.userId).toBe('u1');
      expect(found?.dueDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(await repo.findById('u2', 'l1')).toBeNull();
      expect(await repo.findById('u1', 'missing')).toBeNull();
    });

    it('rejects a duplicate id with ConflictError', async () => {
      await repo.save(loan('l1'));
      await expect(repo.save(loan('l1'))).rejects.toBeInstanceOf(ConflictError);
    });

    it('lets an expense back only one loan (ConflictError)', async () => {
      await repo.save(loan('l1', { expenseId: 'e1' }));
      await expect(repo.save(loan('l2', { expenseId: 'e1' }))).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await repo.findById('u1', 'l2')).toBeNull();
    });

    it('accepts any number of loans without an expense', async () => {
      await repo.save(loan('l1'));
      await repo.save(loan('l2'));
      expect(await repo.listByUser('u1', {})).toHaveLength(2);
    });

    it('updates only the borrower name and the due date', async () => {
      await repo.save(loan('l1', { expenseId: 'e1', cents: 5000 }));
      const changed = loan('l1', {
        borrowerName: 'Maria',
        dueDate: '2027-01-31',
        cents: 9999,
        expenseId: null,
      });
      expect(await repo.update(changed)).toBe(true);
      const found = await repo.findById('u1', 'l1');
      expect(found?.borrowerName).toBe('Maria');
      expect(found?.dueDate.toISOString()).toBe('2027-01-31T00:00:00.000Z');
      expect(found?.amount.cents).toBe(5000);
      expect(found?.expenseId).toBe('e1');
    });

    it('does not update a missing loan or one of another user', async () => {
      await repo.save(loan('l1'));
      expect(await repo.update(loan('nope'))).toBe(false);
      expect(await repo.update(loan('l1', { userId: 'u2', borrowerName: 'Hacked' }))).toBe(false);
      expect((await repo.findById('u1', 'l1'))?.borrowerName).toBe('Carlos');
    });

    it('lists only the loans of the user, by due date then id, ascending', async () => {
      await repo.save(loan('b', { dueDate: '2026-12-01' }));
      await repo.save(loan('c', { dueDate: '2026-11-01' }));
      await repo.save(loan('a', { dueDate: '2026-12-01' }));
      await repo.save(loan('z', { dueDate: '2026-10-01', userId: 'u2' }));
      expect((await repo.listByUser('u1', {})).map((l) => l.id)).toEqual(['c', 'a', 'b']);
      expect((await repo.listByUser('u2', {})).map((l) => l.id)).toEqual(['z']);
    });

    it('filters by borrower ignoring letter case, exact otherwise', async () => {
      await repo.save(loan('l1', { borrowerName: 'Carlos' }));
      await repo.save(loan('l2', { borrowerName: 'CARLOS' }));
      await repo.save(loan('l3', { borrowerName: 'Carlos Eduardo' }));
      await repo.save(loan('l4', { borrowerName: 'João' }));
      await repo.save(loan('l5', { borrowerName: 'Carlos', userId: 'u2' }));
      const ids = async (borrower: string) =>
        (await repo.listByUser('u1', { borrower })).map((l) => l.id).sort();
      expect(await ids('carlos')).toEqual(['l1', 'l2']);
      expect(await ids('JOÃO')).toEqual(['l4']);
      expect(await ids('nobody')).toEqual([]);
    });

    it('treats SQL wildcards in the borrower filter as plain characters', async () => {
      await repo.save(loan('l1', { borrowerName: 'Carlos' }));
      await repo.save(loan('l2', { borrowerName: '100%_' }));
      expect(await repo.listByUser('u1', { borrower: '%' })).toEqual([]);
      expect(await repo.listByUser('u1', { borrower: 'C_rlos' })).toEqual([]);
      expect((await repo.listByUser('u1', { borrower: '100%_' })).map((l) => l.id)).toEqual(['l2']);
    });

    it('deletes only the loan of the owner', async () => {
      await repo.save(loan('l1', { expenseId: 'e1' }));
      expect(await repo.delete('u2', 'l1')).toBe(false);
      expect(await repo.findById('u1', 'l1')).not.toBeNull();
      expect(await repo.delete('u1', 'l1')).toBe(true);
      expect(await repo.findById('u1', 'l1')).toBeNull();
      expect(await repo.delete('u1', 'l1')).toBe(false);
      // The expense is free again.
      await expect(repo.save(loan('l2', { expenseId: 'e1' }))).resolves.toBeUndefined();
    });

    it('round-trips an amount at the ceiling', async () => {
      await repo.save(loan('l1', { cents: 1_000_000_000 }));
      expect((await repo.findById('u1', 'l1'))?.amount.cents).toBe(1_000_000_000);
    });
  });
}
