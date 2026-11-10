import { computeAccountBalance } from '../../../src/domain/account-balance';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';

const m = (cents: number) => Money.fromCents(cents);
const none = { outflows: [], inflows: [], creditPurchases: [] };

describe('computeAccountBalance', () => {
  it('a month without movement and without income is all zeros and nulls', () => {
    expect(computeAccountBalance({ income: null, ...none })).toEqual({
      incomeCents: null,
      spentCents: 0,
      receivedCents: 0,
      creditSpentCents: 0,
      remainingCents: null,
      percentSpent: null,
    });
  });

  it('without income, remaining and percent stay null but the totals are reported', () => {
    expect(
      computeAccountBalance({
        income: null,
        outflows: [m(1000)],
        inflows: [m(300)],
        creditPurchases: [m(70)],
      }),
    ).toEqual({
      incomeCents: null,
      spentCents: 1000,
      receivedCents: 300,
      creditSpentCents: 70,
      remainingCents: null,
      percentSpent: null,
    });
  });

  it('remaining is income minus outflow plus received; credit purchases do not touch it', () => {
    expect(
      computeAccountBalance({
        income: m(500000),
        outflows: [m(20000), m(10000)],
        inflows: [m(10000)],
        creditPurchases: [m(100000)],
      }),
    ).toEqual({
      incomeCents: 500000,
      spentCents: 30000,
      receivedCents: 10000,
      creditSpentCents: 100000,
      remainingCents: 480000,
      percentSpent: 6,
    });
  });

  it('the percentage ignores what was received', () => {
    const r = computeAccountBalance({
      income: m(1000),
      outflows: [m(250)],
      inflows: [m(900)],
      creditPurchases: [],
    });
    expect(r.percentSpent).toBe(25);
    expect(r.remainingCents).toBe(1650);
  });

  it('spending more than the income gives a negative remainder and more than 100 percent', () => {
    const r = computeAccountBalance({
      income: m(100000),
      outflows: [m(150000)],
      inflows: [],
      creditPurchases: [],
    });
    expect(r.remainingCents).toBe(-50000);
    expect(r.percentSpent).toBe(150);
  });

  it.each([
    [1, 3, 33.33],
    [2, 3, 66.67],
    [1, 20000, 0.01],
    [1, 40000, 0],
  ])('rounds %d of %d to two decimals (%d) using integers', (spent, income, expected) => {
    expect(
      computeAccountBalance({
        income: m(income),
        outflows: [m(spent)],
        inflows: [],
        creditPurchases: [],
      }).percentSpent,
    ).toBe(expected);
  });

  it('adds any number of parts per bucket (extensible for new kinds of movement)', () => {
    const r = computeAccountBalance({
      income: m(1000),
      outflows: [m(1), m(2), m(3)],
      inflows: [m(10), m(20)],
      creditPurchases: [m(5), m(5)],
    });
    expect([r.spentCents, r.receivedCents, r.creditSpentCents, r.remainingCents]).toEqual([
      6, 30, 10, 1024,
    ]);
  });

  it('refuses sums outside the safe integer range instead of wrapping', () => {
    const big = m(Number.MAX_SAFE_INTEGER);
    expect(() =>
      computeAccountBalance({ income: null, outflows: [big, m(1)], inflows: [], creditPurchases: [] }),
    ).toThrow(ValidationError);
    expect(() =>
      computeAccountBalance({ income: big, outflows: [], inflows: [big], creditPurchases: [] }),
    ).toThrow(ValidationError);
  });
});
