/**
 * Percentages as integer basis points (1/100 of a percent, 10000 = 100.00%). All arithmetic is
 * done with BigInt: `cents * 10000` can pass 2^53 for large sums, and no float is accumulated.
 */

/**
 * Splits 10000 basis points among `totals` proportionally (largest remainder method), so the
 * result sums to EXACTLY 10000. Ties in the remainder go to the earlier item. An empty list or a
 * zero whole gives zeros.
 */
export function shareBasisPoints(totals: number[]): number[] {
  const values = totals.map((t) => BigInt(t));
  const whole = values.reduce((a, b) => a + b, 0n);
  if (whole <= 0n) return totals.map(() => 0);

  const shares = values.map((v, index) => ({
    index,
    floor: (v * 10000n) / whole,
    remainder: (v * 10000n) % whole,
  }));
  let leftover = 10000n - shares.reduce((a, s) => a + s.floor, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const result = shares.map((s) => s.floor);
  for (const s of byRemainder) {
    if (leftover <= 0n) break;
    result[s.index] += 1n;
    leftover -= 1n;
  }
  return result.map((r) => Number(r));
}

/** `part / whole` in basis points, rounded half up. `whole` must be positive. */
export function ratioBasisPoints(part: number, whole: number): number {
  const w = BigInt(whole);
  if (w <= 0n) throw new Error('whole must be positive');
  return Number((BigInt(part) * 20000n + w) / (2n * w));
}

/** Basis points as a percentage with two decimals (3333 -> 33.33). */
export function toPercentage(basisPoints: number): number {
  return basisPoints / 100;
}
