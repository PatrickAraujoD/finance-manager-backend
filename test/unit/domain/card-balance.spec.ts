import { computeCardBalance } from '../../../src/domain/card-balance';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';

const m = (cents: number) => Money.fromCents(cents);
const empty = { chargesBefore: [], paymentsBefore: [], chargesInMonth: [], paymentsInMonth: [] };

describe('computeCardBalance', () => {
  it('a month without movement is all zeros', () => {
    expect(computeCardBalance(empty)).toEqual({
      openingCents: 0,
      chargedCents: 0,
      paidCents: 0,
      balanceCents: 0,
    });
  });

  it('a credit purchase raises the balance', () => {
    expect(computeCardBalance({ ...empty, chargesInMonth: [m(100000)] })).toEqual({
      openingCents: 0,
      chargedCents: 100000,
      paidCents: 0,
      balanceCents: 100000,
    });
  });

  it('paying the whole bill brings the balance back to zero', () => {
    const r = computeCardBalance({
      ...empty,
      chargesInMonth: [m(100000)],
      paymentsInMonth: [m(100000)],
    });
    expect(r.balanceCents).toBe(0);
  });

  it('the opening balance is what was charged minus what was paid before the month', () => {
    expect(
      computeCardBalance({
        chargesBefore: [m(5000), m(3000)],
        paymentsBefore: [m(2000)],
        chargesInMonth: [m(700)],
        paymentsInMonth: [m(100)],
      }),
    ).toEqual({ openingCents: 6000, chargedCents: 700, paidCents: 100, balanceCents: 6600 });
  });

  it('may be negative: paying more than was charged is not blocked or truncated', () => {
    expect(
      computeCardBalance({ ...empty, chargesInMonth: [m(1000)], paymentsInMonth: [m(1500)] }),
    ).toEqual({ openingCents: 0, chargedCents: 1000, paidCents: 1500, balanceCents: -500 });
    expect(computeCardBalance({ ...empty, paymentsBefore: [m(300)] })).toMatchObject({
      openingCents: -300,
      balanceCents: -300,
    });
  });

  it('refuses sums outside the safe integer range instead of wrapping', () => {
    const big = m(Number.MAX_SAFE_INTEGER);
    expect(() => computeCardBalance({ ...empty, chargesBefore: [big, m(1)] })).toThrow(
      ValidationError,
    );
    expect(() =>
      computeCardBalance({ ...empty, chargesBefore: [big], chargesInMonth: [m(1)] }),
    ).toThrow(ValidationError);
  });
});
