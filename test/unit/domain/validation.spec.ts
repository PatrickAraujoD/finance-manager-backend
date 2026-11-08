import { Category } from '../../../src/domain/entities/category';
import { Expense } from '../../../src/domain/entities/expense';
import { Receipt } from '../../../src/domain/entities/receipt';
import { RefreshToken } from '../../../src/domain/entities/refresh-token';
import { User } from '../../../src/domain/entities/user';
import { Email } from '../../../src/domain/email';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';
import { requireCleanText, requireNonBlank } from '../../../src/domain/validation';

const hostile = ['a\u0000b', '\u0000', 'a\ud800b', 'x\udc00', '\ud83d', 'ok\ud83d'];

describe('text validation', () => {
  it.each(hostile)('requireCleanText rejects %j', (v) => {
    expect(() => requireCleanText(v, 'f')).toThrow(ValidationError);
  });

  it.each(hostile)('requireNonBlank rejects %j', (v) => {
    expect(() => requireNonBlank(v, 'f')).toThrow(ValidationError);
  });

  it('accepts ordinary text, accents and well formed surrogate pairs', () => {
    expect(() => requireCleanText('Açaí 😀 日本', 'f')).not.toThrow();
  });
});

describe('entities reject NUL and lone surrogates in every text field', () => {
  const receipt = {
    id: 'r1',
    userId: 'u1',
    storageKey: 'k.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    suggestedAmount: null,
  };
  const token = {
    id: 't1',
    userId: 'u1',
    familyId: 'f1',
    tokenHash: 'h',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  };
  const expense = {
    id: 'e1',
    userId: 'u1',
    categoryId: 'c1',
    receiptId: null,
    amount: Money.fromCents(100),
    paidAlone: true,
    spentAt: new Date('2026-11-01T12:00:00Z'),
  };
  const user = {
    id: 'u1',
    name: 'Ana',
    email: Email.create('a@x.com'),
    passwordHash: 'hash',
    role: 'N' as const,
  };

  it.each(hostile)('for %j', (v) => {
    expect(() => Email.create(`${v}@x.com`)).toThrow(ValidationError);
    expect(() => User.create({ ...user, name: v })).toThrow(ValidationError);
    expect(() => User.create({ ...user, passwordHash: v })).toThrow(ValidationError);
    expect(() => Category.create({ id: 'c1', name: v, ownerId: null })).toThrow(ValidationError);
    expect(() => Category.create({ id: 'c1', name: 'Food', ownerId: v })).toThrow(ValidationError);
    expect(() => Expense.create({ ...expense, description: v })).toThrow(ValidationError);
    expect(() => Expense.create({ ...expense, receiptId: v })).toThrow(ValidationError);
    expect(() => Receipt.create({ ...receipt, storageKey: v })).toThrow(ValidationError);
    expect(() => Receipt.create({ ...receipt, mimeType: v })).toThrow(ValidationError);
    expect(() => RefreshToken.create({ ...token, familyId: v })).toThrow(ValidationError);
    expect(() => RefreshToken.create({ ...token, tokenHash: v })).toThrow(ValidationError);
  });
});
