import { BRL, add, dinero, equal, subtract, toSnapshot, type Dinero } from 'dinero.js';
import numbro from 'numbro';
import ptBR from 'numbro/languages/pt-BR';
import { ValidationError } from './errors';

numbro.registerLanguage(ptBR, true);

export class Money {
  private constructor(private readonly value: Dinero<number>) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new ValidationError('Money must be an integer amount of cents');
    }
    return new Money(dinero({ amount: cents, currency: BRL }));
  }

  static parseBRL(text: string): Money | null {
    const reais = numbro.unformat(text);
    if (typeof reais !== 'number' || !Number.isFinite(reais)) return null;
    return Money.fromCents(Math.round(reais * 100));
  }

  get cents(): number {
    return toSnapshot(this.value).amount;
  }

  add(other: Money): Money {
    return new Money(add(this.value, other.value));
  }

  subtract(other: Money): Money {
    return new Money(subtract(this.value, other.value));
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  equals(other: Money): boolean {
    return equal(this.value, other.value);
  }
}
