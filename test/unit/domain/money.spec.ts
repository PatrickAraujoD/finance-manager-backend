import { ValidationError } from "../../../src/domain/errors";
import { Money } from "../../../src/domain/money";

describe("Money", () => {
  it("creates from integer cents", () => {
    expect(Money.fromCents(1050).cents).toBe(1050);
  });

  it("rejects non-integer cents", () => {
    expect(() => Money.fromCents(1.5)).toThrow();
    expect(() => Money.fromCents(Number.NaN)).toThrow();
  });

  it("rejects unsafe integers", () => {
    expect(() => Money.fromCents(1e22)).toThrow();
    expect(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 10)).toThrow();
  });

  it("normalizes negative zero", () => {
    expect(Object.is(Money.fromCents(-0).cents, 0)).toBe(true);
  });

  it("adds and subtracts", () => {
    const a = Money.fromCents(1000);
    const b = Money.fromCents(250);
    expect(a.add(b).cents).toBe(1250);
    expect(a.subtract(b).cents).toBe(750);
  });

  it("rejects add and subtract results that are not safe integers", () => {
    const max = Money.fromCents(Number.MAX_SAFE_INTEGER);
    expect(() => max.add(Money.fromCents(1))).toThrow(ValidationError);
    expect(() =>
      Money.fromCents(-Number.MAX_SAFE_INTEGER).subtract(Money.fromCents(1)),
    ).toThrow(ValidationError);
  });

  it("never yields negative zero from arithmetic", () => {
    const a = Money.fromCents(100);
    expect(Object.is(a.subtract(a).cents, 0)).toBe(true);
    expect(
      Object.is(Money.fromCents(-100).add(Money.fromCents(100)).cents, 0),
    ).toBe(true);
  });

  it("detects negative values and compares equality", () => {
    expect(
      Money.fromCents(100).subtract(Money.fromCents(300)).isNegative(),
    ).toBe(true);
    expect(Money.fromCents(0).isNegative()).toBe(false);
    expect(Money.fromCents(500).equals(Money.fromCents(500))).toBe(true);
    expect(Money.fromCents(500).equals(Money.fromCents(501))).toBe(false);
  });

  describe("parseBRL", () => {
    it.each([
      ["R$ 1.234,56", 123456],
      ["1234,56", 123456],
      ["R$1.234,56", 123456],
      ["10", 1000],
      ["1.234.567,89", 123456789],
      ["0,05", 5],
      ["R$ 0,00", 0],
      ["12,5", 1250],
      ["1.234", 123400],
      [" 10 ", 1000],
    ])("parses %s", (text, cents) => {
      expect(Money.parseBRL(text)?.cents).toBe(cents);
    });

    it.each([
      "abc",
      "",
      "   ",
      "12abc",
      "1234.56",
      "10.00",
      "1.5",
      "R$ 10,999",
      "0,005",
      "1e3",
      "0x10",
      "5%",
      "R$",
      "1.23,45",
      "R$ R$ 5",
      "1 234,56",
      "1,234",
      "-R$ 10,00",
      "(10,00)",
      "R$ -10,00",
    ])("returns null for %p", (text) => {
      expect(Money.parseBRL(text)).toBeNull();
    });
  });

  it("round-trips pt-BR formatted values", () => {
    const fmt = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    for (let i = 0; i < 20000; i++) {
      const c = i < 1000 ? i : Math.floor(Math.random() * 1e11);
      expect(Money.parseBRL(fmt.format(c / 100))?.cents).toBe(c);
    }
  });
});
