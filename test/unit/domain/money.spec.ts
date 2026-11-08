import { Money } from '../../../src/domain/money';

describe('Money', () => {
  it('creates from integer cents', () => {
    expect(Money.fromCents(1050).cents).toBe(1050);
  });

  it('rejects non-integer cents', () => {
    expect(() => Money.fromCents(1.5)).toThrow();
    expect(() => Money.fromCents(Number.NaN)).toThrow();
  });

  it('adds and subtracts', () => {
    const a = Money.fromCents(1000);
    const b = Money.fromCents(250);
    expect(a.add(b).cents).toBe(1250);
    expect(a.subtract(b).cents).toBe(750);
  });

  it('detects negative values and compares equality', () => {
    expect(Money.fromCents(100).subtract(Money.fromCents(300)).isNegative()).toBe(true);
    expect(Money.fromCents(0).isNegative()).toBe(false);
    expect(Money.fromCents(500).equals(Money.fromCents(500))).toBe(true);
    expect(Money.fromCents(500).equals(Money.fromCents(501))).toBe(false);
  });

  describe('parseBRL', () => {
    it.each([
      ['R$ 1.234,56', 123456],
      ['1234,56', 123456],
      ['R$1.234,56', 123456],
      ['10', 1000],
    ])('parses %s', (text, cents) => {
      expect(Money.parseBRL(text)?.cents).toBe(cents);
    });

    it.each(['abc', '', '12abc'])('returns null for %p', (text) => {
      expect(Money.parseBRL(text)).toBeNull();
    });
  });
});
