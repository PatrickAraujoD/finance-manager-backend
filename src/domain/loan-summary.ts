import { Loan } from './entities/loan';
import { LoanBalance } from './loan-balance';
import { Money } from './money';

/**
 * Ceiling on the people in a summary. The rest is not dropped silently: the result says
 * `truncated: true` and the totals still cover everyone.
 */
export const MAX_SUMMARY_BORROWERS = 500;

export interface LoanSummaryEntry {
  loan: Loan;
  balance: LoanBalance;
}

export interface LoanSummaryTotals {
  totalLentCents: number;
  paidCents: number;
  /** `totalLentCents - paidCents`, which is also `upcomingCents + overdueCents`. */
  owedCents: number;
  /** Remaining balance of the loans not yet due (status OPEN). */
  upcomingCents: number;
  /** Remaining balance of the loans past due (status OVERDUE). */
  overdueCents: number;
}

export interface BorrowerSummary extends LoanSummaryTotals {
  borrowerName: string;
  loansCount: number;
  overdueLoansCount: number;
  /** Earliest due date among the loans that still have a balance; null when all are settled. */
  nextDueDate: Date | null;
}

export interface LoanSummary {
  items: BorrowerSummary[];
  /** Over every person, even the ones cut off by the ceiling. */
  totals: LoanSummaryTotals;
  truncated: boolean;
}

/** Names are stored trimmed, so the key only has to fold the case. */
const keyOf = (name: string): string => name.trim().toLowerCase();

interface Group {
  name: string;
  nameCreatedAt: Date | null;
  loansCount: number;
  overdueLoansCount: number;
  lent: Money;
  paid: Money;
  upcoming: Money;
  overdue: Money;
  nextDue: Date | null;
}

const ZERO = Money.fromCents(0);

function toTotals(lent: Money, paid: Money, upcoming: Money, overdue: Money): LoanSummaryTotals {
  return {
    totalLentCents: lent.cents,
    paidCents: paid.cents,
    owedCents: lent.subtract(paid).cents,
    upcomingCents: upcoming.cents,
    overdueCents: overdue.cents,
  };
}

/**
 * Pure grouping of loans (already with their balance) by person. People are told apart by
 * `borrowerName` ignoring letter case and spaces at the ends; the name shown is the one of the
 * OLDEST loan of the group (by `createdAt`; unknown or equal dates keep the first one given).
 *
 * Order: `overdueCents` descending, then name ascending (ignoring case). Past `maxPeople` the worst debtors stay
 * and `truncated` is true. The sums use `Money`, which throws on leaving the safe integer range
 * instead of returning a wrong number (each loan is at most 1e9 cents, so that takes millions).
 */
export function summarizeLoansByBorrower(
  entries: readonly LoanSummaryEntry[],
  maxPeople: number = MAX_SUMMARY_BORROWERS,
): LoanSummary {
  const groups = new Map<string, Group>();
  for (const { loan, balance } of entries) {
    const key = keyOf(loan.borrowerName);
    let group = groups.get(key);
    if (!group) {
      group = {
        name: loan.borrowerName,
        nameCreatedAt: loan.createdAt,
        loansCount: 0,
        overdueLoansCount: 0,
        lent: ZERO,
        paid: ZERO,
        upcoming: ZERO,
        overdue: ZERO,
        nextDue: null,
      };
      groups.set(key, group);
    } else if (
      loan.createdAt !== null &&
      group.nameCreatedAt !== null &&
      loan.createdAt.getTime() < group.nameCreatedAt.getTime()
    ) {
      group.name = loan.borrowerName;
      group.nameCreatedAt = loan.createdAt;
    }
    group.loansCount += 1;
    group.lent = group.lent.add(loan.amount);
    group.paid = group.paid.add(balance.paid);
    if (balance.status === 'OPEN') group.upcoming = group.upcoming.add(balance.remaining);
    if (balance.status === 'OVERDUE') {
      group.overdue = group.overdue.add(balance.remaining);
      group.overdueLoansCount += 1;
    }
    if (balance.remaining.cents > 0 && (!group.nextDue || loan.dueDate < group.nextDue)) {
      group.nextDue = loan.dueDate;
    }
  }

  const all = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      row: {
        borrowerName: g.name,
        loansCount: g.loansCount,
        ...toTotals(g.lent, g.paid, g.upcoming, g.overdue),
        overdueLoansCount: g.overdueLoansCount,
        nextDueDate: g.nextDue,
      } satisfies BorrowerSummary,
    }))
    .sort(
      (a, b) =>
        b.row.overdueCents - a.row.overdueCents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

  let lent = ZERO;
  let paid = ZERO;
  let upcoming = ZERO;
  let overdue = ZERO;
  for (const { row } of all) {
    lent = lent.add(Money.fromCents(row.totalLentCents));
    paid = paid.add(Money.fromCents(row.paidCents));
    upcoming = upcoming.add(Money.fromCents(row.upcomingCents));
    overdue = overdue.add(Money.fromCents(row.overdueCents));
  }

  return {
    items: all.slice(0, maxPeople).map(({ row }) => row),
    totals: toTotals(lent, paid, upcoming, overdue),
    truncated: all.length > maxPeople,
  };
}
