import { ValidationError } from "./errors";

// Strict pt-BR: optional "R$", thousands with ".", decimals with ",".
// Negatives are rejected on purpose: payment receipts are always positive.
const BRL_PATTERN = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export class Money {
  private constructor(private readonly value: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new ValidationError("Money must be a safe integer amount of cents");
    }
    // `+ 0` turns -0 into 0
    return new Money(cents + 0);
  }

  static parseBRL(text: string): Money | null {
    const match = BRL_PATTERN.exec(text.trim());
    if (!match) return null;
    const reais = Number(match[1].replace(/\./g, ""));
    const centavos = Number((match[2] ?? "").padEnd(2, "0"));
    const cents = reais * 100 + centavos;
    return Number.isSafeInteger(cents) ? Money.fromCents(cents) : null;
  }

  get cents(): number {
    return this.value;
  }

  add(other: Money): Money {
    return Money.fromCents(this.value + other.value);
  }

  subtract(other: Money): Money {
    return Money.fromCents(this.value - other.value);
  }

  isNegative(): boolean {
    return this.value < 0;
  }

  equals(other: Money): boolean {
    return this.value === other.value;
  }
}
