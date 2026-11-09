import { LoanPaymentRepository } from '../../src/application/ports/loan-payment-repository';
import { LoanRepository } from '../../src/application/ports/loan-repository';
import { LoanPayment } from '../../src/domain/entities/loan-payment';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors';
import { LoanPaymentMethod } from '../../src/domain/loan-payment-method';
import { Money } from '../../src/domain/money';
import { loan } from './loan-repository-contract';

/**
 * What a LoanPaymentRepository implementation must do, run against the in-memory fake (unit) and
 * the real Prisma repository (integration) so the two cannot drift apart.
 */
export interface LoanPaymentRepositoryHarness {
  repo: LoanPaymentRepository;
  loans: LoanRepository;
  /** Makes sure the users u1 and u2 and the receipts r1..r6 (owned by u1) exist. */
  ready(): Promise<void>;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function payment(
  id: string,
  over: Partial<{
    loanId: string;
    userId: string;
    cents: number;
    method: LoanPaymentMethod;
    receiptId: string | null;
    paidAt: string;
  }> = {},
): LoanPayment {
  const method = over.method ?? (over.receiptId ? 'PIX' : 'CASH');
  return LoanPayment.create({
    id,
    loanId: over.loanId ?? 'l1',
    userId: over.userId ?? 'u1',
    amount: Money.fromCents(over.cents ?? 1000),
    method,
    receiptId: over.receiptId ?? null,
    paidAt: day(over.paidAt ?? '2026-11-08'),
  });
}

export function describeLoanPaymentRepositoryContract(
  name: string,
  make: () => Promise<LoanPaymentRepositoryHarness>,
): void {
  describe(`${name} loan payment repository contract`, () => {
    let repo: LoanPaymentRepository;
    let loans: LoanRepository;

    beforeEach(async () => {
      const harness = await make();
      await harness.ready();
      repo = harness.repo;
      loans = harness.loans;
      // l1 and l2 are Ana's (u1) loans of 10000 and 5000 cents; l3 belongs to u2.
      await loans.save(loan('l1', { cents: 10_000 }));
      await loans.save(loan('l2', { cents: 5_000 }));
      await loans.save(loan('l3', { userId: 'u2', cents: 10_000 }));
    });

    it('adds a payment and reads back every field, scoped to the owner of the loan', async () => {
      await repo.add(payment('p1', { cents: 1234, receiptId: 'r1', paidAt: '2026-11-05' }));
      const [found] = await repo.listByLoan('u1', 'l1');
      expect(found.id).toBe('p1');
      expect(found.loanId).toBe('l1');
      expect(found.userId).toBe('u1');
      expect(found.amount.cents).toBe(1234);
      expect(found.method).toBe('PIX');
      expect(found.receiptId).toBe('r1');
      expect(found.paidAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
      expect(found.createdAt).toBeInstanceOf(Date);
      expect(await repo.listByLoan('u2', 'l1')).toEqual([]);
      expect(await repo.listByLoan('u1', 'missing')).toEqual([]);
    });

    it('lists by paidAt then id, ascending, and only the payments of that loan', async () => {
      await repo.add(payment('b', { paidAt: '2026-11-02' }));
      await repo.add(payment('c', { paidAt: '2026-11-01' }));
      await repo.add(payment('a', { paidAt: '2026-11-02' }));
      await repo.add(payment('z', { loanId: 'l2', paidAt: '2026-10-01' }));
      expect((await repo.listByLoan('u1', 'l1')).map((p) => p.id)).toEqual(['c', 'a', 'b']);
      expect((await repo.listByLoan('u1', 'l2')).map((p) => p.id)).toEqual(['z']);
    });

    it('rejects a duplicate id with ConflictError', async () => {
      await repo.add(payment('p1'));
      await expect(repo.add(payment('p1', { cents: 5 }))).rejects.toBeInstanceOf(ConflictError);
      expect(await repo.listByLoan('u1', 'l1')).toHaveLength(1);
    });

    it('lets a receipt back only one payment (ConflictError)', async () => {
      await repo.add(payment('p1', { receiptId: 'r1' }));
      await expect(repo.add(payment('p2', { receiptId: 'r1', loanId: 'l2' }))).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await repo.listByLoan('u1', 'l2')).toEqual([]);
    });

    it('accepts any number of cash payments (no receipt)', async () => {
      await repo.add(payment('p1'));
      await repo.add(payment('p2'));
      expect(await repo.listByLoan('u1', 'l1')).toHaveLength(2);
    });

    it('answers NotFoundError for a missing loan or one that belongs to another user', async () => {
      await expect(repo.add(payment('p1', { loanId: 'nope' }))).rejects.toBeInstanceOf(NotFoundError);
      await expect(repo.add(payment('p2', { loanId: 'l3' }))).rejects.toBeInstanceOf(NotFoundError);
      expect(await repo.listByLoan('u2', 'l3')).toEqual([]);
    });

    it('refuses a payment above the remaining balance and stores nothing', async () => {
      await repo.add(payment('p1', { cents: 9_000 }));
      await expect(repo.add(payment('p2', { cents: 1_001 }))).rejects.toBeInstanceOf(ValidationError);
      expect(await repo.listByLoan('u1', 'l1')).toHaveLength(1);
      expect((await repo.sumPaidByLoans('u1', ['l1'])).get('l1')).toBe(9_000);
    });

    it('accepts the payment that settles the loan exactly, and none after it', async () => {
      await repo.add(payment('p1', { cents: 4_000 }));
      await repo.add(payment('p2', { cents: 6_000 }));
      expect((await repo.sumPaidByLoans('u1', ['l1'])).get('l1')).toBe(10_000);
      await expect(repo.add(payment('p3', { cents: 1 }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not let simultaneous payments overshoot the loan', async () => {
      // 8 x 3000 against 10000: exactly three fit, whatever the interleaving.
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => repo.add(payment(`c${i}`, { cents: 3_000 }))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ValidationError);
      }
      expect((await repo.sumPaidByLoans('u1', ['l1'])).get('l1')).toBe(9_000);
      expect(await repo.listByLoan('u1', 'l1')).toHaveLength(3);
    });

    it('does not let simultaneous payments sharing a receipt both pass', async () => {
      const results = await Promise.allSettled([
        repo.add(payment('p1', { receiptId: 'r2', cents: 100 })),
        repo.add(payment('p2', { receiptId: 'r2', cents: 100 })),
        repo.add(payment('p3', { receiptId: 'r2', cents: 100, loanId: 'l2' })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
      }
    });

    describe('sumPaidByLoans', () => {
      beforeEach(async () => {
        await repo.add(payment('p1', { cents: 1_000 }));
        await repo.add(payment('p2', { cents: 2_500, receiptId: 'r3' }));
        await repo.add(payment('p3', { cents: 700, loanId: 'l2' }));
        await repo.add(payment('p4', { cents: 9_000, loanId: 'l3', userId: 'u2' }));
      });

      it('sums per loan in one go and leaves out loans without payments', async () => {
        await loans.save(loan('l4', { cents: 100 }));
        const sums = await repo.sumPaidByLoans('u1', ['l1', 'l2', 'l4']);
        expect(Object.fromEntries(sums)).toEqual({ l1: 3_500, l2: 700 });
      });

      it('covers every loan of the user when no ids are given', async () => {
        expect(Object.fromEntries(await repo.sumPaidByLoans('u1'))).toEqual({ l1: 3_500, l2: 700 });
        expect(Object.fromEntries(await repo.sumPaidByLoans('u2'))).toEqual({ l3: 9_000 });
      });

      it('covers none for an empty list and ignores loans of other users', async () => {
        expect((await repo.sumPaidByLoans('u1', [])).size).toBe(0);
        expect((await repo.sumPaidByLoans('u1', ['l3'])).size).toBe(0);
        expect((await repo.sumPaidByLoans('u2', ['l1'])).size).toBe(0);
      });
    });

    it('tells whether a receipt backs a payment', async () => {
      expect(await repo.isReceiptUsed('r4')).toBe(false);
      await repo.add(payment('p1', { receiptId: 'r4' }));
      expect(await repo.isReceiptUsed('r4')).toBe(true);
      expect(await repo.isReceiptUsed('r5')).toBe(false);
    });
  });
}
