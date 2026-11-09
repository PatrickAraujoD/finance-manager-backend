import { Expense } from '../../../../src/domain/entities/expense';
import { Money } from '../../../../src/domain/money';
import { Role } from '../../../../src/domain/role';
import { FakeExpenseRepository } from '../../../support/fakes/fake-expense-repository';
import { FakeLoanRepository } from '../../../support/fakes/fake-loan-repository';
import { FixedClock } from '../../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

export const ana = { id: 'ana', role: 'N' as Role };
export const bob = { id: 'bob', role: 'N' as Role };
export const admin = { id: 'admin', role: 'A' as Role };

/** Clock: 2026-11-08T12:00Z, so "today" is 2026-11-08. Ana owns the expenses e-ana and e-ana-2. */
export async function loansWorld() {
  const loans = new FakeLoanRepository();
  const expenses = new FakeExpenseRepository();
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock();
  for (const [id, userId, cents] of [
    ['e-ana', 'ana', 4_200],
    ['e-ana-2', 'ana', 900],
    ['e-bob', 'bob', 700],
  ] as const) {
    await expenses.save(
      Expense.create({
        id,
        userId,
        categoryId: 'c1',
        receiptId: null,
        amount: Money.fromCents(cents),
        paidAlone: false,
        paymentMethod: 'PIX',
        spentAt: new Date('2026-11-01T00:00:00Z'),
      }),
    );
  }
  return { loans, expenses, ids, clock };
}
