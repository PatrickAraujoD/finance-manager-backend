import { amountFromText } from '../../../src/infrastructure/extraction/amount-from-text';
import { CORPUS, MUST_RECALL } from './amount-corpus';

const cents = (text: string) => amountFromText(text, 'native').amount?.cents ?? null;

describe('amount corpus (adversarial receipt texts)', () => {
  it('has the expected size', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(150);
  });

  it.each(CORPUS)('%j is never read as a wrong amount (expected %j)', (text, expected) => {
    const got = cents(text);
    if (expected === null) {
      expect(got).toBeNull();
    } else {
      expect([expected, null]).toContain(got);
    }
  });

  it('still finds the amount in every MUST_RECALL row', () => {
    for (const text of MUST_RECALL) {
      const expected = CORPUS.find(([t]) => t === text)?.[1];
      expect({ text, got: cents(text) }).toEqual({ text, got: expected });
    }
  });
});
