import {
  ratioBasisPoints,
  shareBasisPoints,
} from '../../../src/domain/basis-points';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('shareBasisPoints (largest remainder)', () => {
  it('splits 1/3 + 1/3 + 1/3 into 3334 + 3333 + 3333', () => {
    expect(shareBasisPoints([100, 100, 100])).toEqual([3334, 3333, 3333]);
  });

  it('gives the single item all 10000', () => {
    expect(shareBasisPoints([777])).toEqual([10000]);
  });

  it('returns an empty list for no items and zeros when the whole is zero', () => {
    expect(shareBasisPoints([])).toEqual([]);
    expect(shareBasisPoints([0, 0])).toEqual([0, 0]);
  });

  it('hands the leftover to the largest remainders, ties to the earlier item', () => {
    // 1/6, 1/6, 4/6 -> 1666.67, 1666.67, 6666.67: floors 1666,1666,6666 = 9998, two left.
    // Remainders are all .67: the first two win.
    expect(shareBasisPoints([1, 1, 4])).toEqual([1667, 1667, 6666]);
  });

  it.each([
    [[1, 1, 1, 1, 1, 1, 1]],
    [[5, 3, 2]],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]],
    [[999_999_999, 1, 1]],
    [[1_000_000_000, 1_000_000_000, 1_000_000_000]],
  ])('always sums to exactly 10000 for %j', (totals) => {
    const bp = shareBasisPoints(totals);
    expect(sum(bp)).toBe(10000);
    for (const x of bp) expect(Number.isInteger(x)).toBe(true);
  });

  it('stays exact when the totals are huge (no 2^53 overflow in the intermediate product)', () => {
    const big = 4_000_000_000_000_000; // 4e15 cents each: 4e15 * 10000 > 2^53
    expect(shareBasisPoints([big, big, big])).toEqual([3334, 3333, 3333]);
    expect(sum(shareBasisPoints([big, big / 2, 1]))).toBe(10000);
  });

  it('is a pure function of the amounts: random inputs always sum to 10000', () => {
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 200; round++) {
      const n = 1 + (next() % 12);
      const totals = Array.from({ length: n }, () => 1 + (next() % 100000));
      expect(sum(shareBasisPoints(totals))).toBe(10000);
    }
  });
});

describe('ratioBasisPoints (half up)', () => {
  it.each([
    [1, 3, 3333],
    [2, 3, 6667],
    [1, 2, 5000],
    [0, 5, 0],
    [5, 5, 10000],
    [15, 10, 15000],
    [1, 20000, 1], // 0.5 bp rounds up
    [1, 40000, 0],
  ])('%d of %d is %d basis points', (part, whole, expected) => {
    expect(ratioBasisPoints(part, whole)).toBe(expected);
  });

  it('is exact for huge amounts', () => {
    expect(ratioBasisPoints(4_000_000_000_000_000, 8_000_000_000_000_000)).toBe(5000);
  });

  it('rejects a non-positive whole', () => {
    expect(() => ratioBasisPoints(1, 0)).toThrow();
  });
});
