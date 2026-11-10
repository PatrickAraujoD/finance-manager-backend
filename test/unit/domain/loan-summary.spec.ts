import { Loan } from '../../../src/domain/entities/loan';
import { computeLoanBalance } from '../../../src/domain/loan-balance';
import { MAX_SUMMARY_BORROWERS, summarizeLoansByBorrower } from '../../../src/domain/loan-summary';
import { Money } from '../../../src/domain/money';

// "Today" is 2026-11-09.
const NOW = new Date('2026-11-09T12:00:00Z');

let seq = 0;
function entry(name: string, dueDate: string, cents: number, paid = 0, createdAt?: string) {
  seq += 1;
  const loan = Loan.create({
    id: `l${seq}`,
    userId: 'u1',
    borrowerName: name,
    amount: Money.fromCents(cents),
    dueDate: new Date(`${dueDate}T00:00:00Z`),
    expenseId: null,
    paymentMethod: 'PIX',
    lentAt: new Date('2026-11-01T00:00:00Z'),
    createdAt: createdAt ? new Date(createdAt) : null,
  });
  return { loan, balance: computeLoanBalance(loan, Money.fromCents(paid), NOW) };
}

describe('summarizeLoansByBorrower', () => {
  it('is empty with zero totals when there are no loans', () => {
    const summary = summarizeLoansByBorrower([]);
    expect(summary.items).toEqual([]);
    expect(summary.truncated).toBe(false);
    expect(summary.totals).toEqual({
      totalLentCents: 0,
      paidCents: 0,
      owedCents: 0,
      upcomingCents: 0,
      overdueCents: 0,
    });
  });

  it('sums one person: upcoming, overdue (partial) and settled loans', () => {
    const summary = summarizeLoansByBorrower([
      entry('Carlos', '2026-12-10', 5_000, 1_000), // open, 4000 left
      entry('Carlos', '2026-11-01', 3_000, 500), // overdue, 2500 left
      entry('Carlos', '2026-10-01', 2_000, 2_000), // settled long ago
    ]);
    expect(summary.items).toHaveLength(1);
    const carlos = summary.items[0];
    expect(carlos).toEqual({
      borrowerName: 'Carlos',
      loansCount: 3,
      totalLentCents: 10_000,
      paidCents: 3_500,
      owedCents: 6_500,
      upcomingCents: 4_000,
      overdueCents: 2_500,
      overdueLoansCount: 1,
      nextDueDate: new Date('2026-11-01T00:00:00Z'),
    });
    expect(summary.totals).toEqual({
      totalLentCents: 10_000,
      paidCents: 3_500,
      owedCents: 6_500,
      upcomingCents: 4_000,
      overdueCents: 2_500,
    });
  });

  it('counts a loan due today as upcoming, not overdue', () => {
    const [item] = summarizeLoansByBorrower([entry('Ana', '2026-11-09', 1_000)]).items;
    expect(item.upcomingCents).toBe(1_000);
    expect(item.overdueCents).toBe(0);
    expect(item.overdueLoansCount).toBe(0);
  });

  it('has a null nextDueDate when everything is settled', () => {
    const [item] = summarizeLoansByBorrower([entry('Ana', '2026-11-01', 1_000, 1_000)]).items;
    expect(item.owedCents).toBe(0);
    expect(item.nextDueDate).toBeNull();
    expect(item.loansCount).toBe(1);
  });

  it('ignores a settled loan when picking nextDueDate', () => {
    const [item] = summarizeLoansByBorrower([
      entry('Ana', '2026-01-01', 1_000, 1_000),
      entry('Ana', '2026-12-31', 1_000),
    ]).items;
    expect(item.nextDueDate).toEqual(new Date('2026-12-31T00:00:00Z'));
  });

  it('groups names that differ only by case or spaces at the ends', () => {
    const summary = summarizeLoansByBorrower([
      entry('carlos', '2026-12-10', 1_000, 0, '2026-03-01T00:00:00Z'),
      entry('Carlos', '2026-12-11', 2_000, 0, '2026-01-01T00:00:00Z'),
      entry(' CARLOS ', '2026-12-12', 4_000, 0, '2026-02-01T00:00:00Z'),
    ]);
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].loansCount).toBe(3);
    expect(summary.items[0].totalLentCents).toBe(7_000);
    // The displayed name is the one of the oldest loan of the group.
    expect(summary.items[0].borrowerName).toBe('Carlos');
  });

  it('keeps the first seen name when the creation dates are unknown or tie', () => {
    const summary = summarizeLoansByBorrower([
      entry('bia', '2026-12-10', 1_000),
      entry('BIA', '2026-12-11', 1_000),
    ]);
    expect(summary.items[0].borrowerName).toBe('bia');
  });

  it('does not merge different people', () => {
    const summary = summarizeLoansByBorrower([
      entry('Carlos', '2026-12-10', 1_000),
      entry('Carla', '2026-12-10', 1_000),
    ]);
    expect(summary.items.map((i) => i.borrowerName).sort()).toEqual(['Carla', 'Carlos']);
  });

  it('orders by overdueCents descending, then borrowerName ascending', () => {
    const summary = summarizeLoansByBorrower([
      entry('Zeca', '2026-12-10', 1_000),
      entry('Ana', '2026-12-10', 1_000),
      entry('Bia', '2026-11-01', 500),
      entry('Davi', '2026-11-01', 9_000),
    ]);
    expect(summary.items.map((i) => i.borrowerName)).toEqual(['Davi', 'Bia', 'Ana', 'Zeca']);
  });

  it('keeps the invariants for every person and for the totals', () => {
    const summary = summarizeLoansByBorrower([
      entry('A', '2026-12-10', 5_000, 1_000),
      entry('A', '2026-11-01', 3_000, 3_000),
      entry('B', '2026-11-01', 7_000, 2_500),
      entry('C', '2026-11-09', 100, 1),
    ]);
    for (const row of [...summary.items, summary.totals]) {
      expect(row.owedCents).toBe(row.upcomingCents + row.overdueCents);
      expect(row.owedCents).toBe(row.totalLentCents - row.paidCents);
    }
  });

  it('truncates by the worst debtors, flags it and keeps the totals of everyone', () => {
    const entries = [
      entry('Pessoa 1', '2026-11-01', 100),
      entry('Pessoa 2', '2026-11-01', 300),
      entry('Pessoa 3', '2026-11-01', 200),
    ];
    const summary = summarizeLoansByBorrower(entries, 2);
    expect(summary.truncated).toBe(true);
    expect(summary.items.map((i) => i.borrowerName)).toEqual(['Pessoa 2', 'Pessoa 3']);
    expect(summary.totals.overdueCents).toBe(600);
    expect(summarizeLoansByBorrower(entries, 3).truncated).toBe(false);
  });

  it('has a documented default ceiling of 500 people', () => {
    expect(MAX_SUMMARY_BORROWERS).toBe(500);
  });

  it('refuses to sum past the safe integer range instead of going wrong', () => {
    const huge = (name: string) => ({
      loan: entry(name, '2026-12-10', 1_000).loan,
      balance: {
        paid: Money.fromCents(0),
        remaining: Money.fromCents(Number.MAX_SAFE_INTEGER),
        status: 'OPEN' as const,
      },
    });
    expect(() => summarizeLoansByBorrower([huge('A'), huge('A')])).toThrow();
  });
});
