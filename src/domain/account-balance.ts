import { ratioBasisPoints, toPercentage } from './basis-points';
import { Money } from './money';

/**
 * Every bucket is a list of parts, not one total, so a new kind of movement (for example a loan
 * given in cash) is added as one more part without changing this function or its callers' shape.
 */
export interface AccountBalanceInput {
  /** The month's income; `null` when none is registered. */
  income: Money | null;
  /** Everything that left the account in the month (debit, Pix, cash, card bill payments). */
  outflows: readonly Money[];
  /** Everything that came into the account in the month (loan payments received). */
  inflows: readonly Money[];
  /** Credit card purchases of the month: informative, they never leave the account. */
  creditPurchases: readonly Money[];
}

export interface AccountBalance {
  /** `null` when no income is registered for the month. */
  incomeCents: number | null;
  spentCents: number;
  receivedCents: number;
  creditSpentCents: number;
  /** Income minus spent plus received; negative when more left than came in. */
  remainingCents: number | null;
  /** Spent over income with two decimals (may pass 100); `null` without income. */
  percentSpent: number | null;
}

function total(parts: readonly Money[]): Money {
  // Money.add refuses results outside the safe integer range, so nothing wraps silently.
  return parts.reduce((sum, part) => sum.add(part), Money.fromCents(0));
}

/** Pure: what is left of the month's income in the account. */
export function computeAccountBalance(input: AccountBalanceInput): AccountBalance {
  const spent = total(input.outflows);
  const received = total(input.inflows);
  const creditSpent = total(input.creditPurchases);
  const base = {
    spentCents: spent.cents,
    receivedCents: received.cents,
    creditSpentCents: creditSpent.cents,
  };
  if (!input.income) {
    return { incomeCents: null, ...base, remainingCents: null, percentSpent: null };
  }
  return {
    incomeCents: input.income.cents,
    ...base,
    remainingCents: input.income.subtract(spent).add(received).cents,
    // Received money lowers what is left but is not "spending less", so it stays out of the ratio.
    percentSpent: toPercentage(ratioBasisPoints(spent.cents, input.income.cents)),
  };
}
