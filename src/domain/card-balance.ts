import { Money } from './money';

/** Lists of parts, so new kinds of charge can be added without changing the shape. */
export interface CardBalanceInput {
  /** Credit charges dated before the first day of the month. */
  chargesBefore: readonly Money[];
  /** Card bill payments dated before the first day of the month. */
  paymentsBefore: readonly Money[];
  chargesInMonth: readonly Money[];
  paymentsInMonth: readonly Money[];
}

export interface CardBalance {
  /** Owed at the start of the month (charges minus payments before it). */
  openingCents: number;
  chargedCents: number;
  paidCents: number;
  /** Owed at the end of the month; negative when the bill was overpaid. */
  balanceCents: number;
}

function total(parts: readonly Money[]): Money {
  return parts.reduce((sum, part) => sum.add(part), Money.fromCents(0));
}

/** Pure: what is owed on the credit card, accumulated with no limit and no billing cycle. */
export function computeCardBalance(input: CardBalanceInput): CardBalance {
  const opening = total(input.chargesBefore).subtract(total(input.paymentsBefore));
  const charged = total(input.chargesInMonth);
  const paid = total(input.paymentsInMonth);
  return {
    openingCents: opening.cents,
    chargedCents: charged.cents,
    paidCents: paid.cents,
    // Deliberately not clamped at zero: overpaying shows as a negative balance.
    balanceCents: opening.add(charged).subtract(paid).cents,
  };
}
