import { inspect } from 'util';
import { Category } from '../../../src/domain/entities/category';
import { Expense, MAX_EXPENSE_CENTS } from '../../../src/domain/entities/expense';
import { MonthlyIncome } from '../../../src/domain/entities/monthly-income';
import { Receipt } from '../../../src/domain/entities/receipt';
import { RefreshToken } from '../../../src/domain/entities/refresh-token';
import { User } from '../../../src/domain/entities/user';
import { Email } from '../../../src/domain/email';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';

const expenseProps = {
  id: 'e1',
  userId: 'u1',
  categoryId: 'c1',
  receiptId: null,
  amount: Money.fromCents(1050),
  paidAlone: true,
  paymentMethod: 'PIX' as const,
  spentAt: new Date('2026-11-01T12:00:00Z'),
};

const userProps = {
  id: 'u1',
  name: 'Ana',
  email: Email.create('Ana@x.com'),
  passwordHash: 'hash',
  role: 'N' as const,
};

describe('Expense', () => {
  it('creates with a positive amount', () => {
    const e = Expense.create(expenseProps);
    expect(e.amount.cents).toBe(1050);
    expect(e.description).toBeUndefined();
  });

  it.each(['CREDIT', 'DEBIT', 'PIX', 'CASH'] as const)('keeps the payment method %s', (paymentMethod) => {
    expect(Expense.create({ ...expenseProps, paymentMethod }).paymentMethod).toBe(paymentMethod);
  });

  it.each(['', 'CHEQUE', 'cash', 'pix', undefined, null])('rejects the payment method %p', (v) => {
    expect(() => Expense.create({ ...expenseProps, paymentMethod: v as never })).toThrow(
      ValidationError,
    );
  });

  it.each([0, -1])('rejects amount of %i cents', (cents) => {
    expect(() => Expense.create({ ...expenseProps, amount: Money.fromCents(cents) })).toThrow(
      ValidationError,
    );
  });

  it('accepts exactly MAX_EXPENSE_CENTS (R$ 10 million) and rejects one cent more', () => {
    expect(MAX_EXPENSE_CENTS).toBe(1_000_000_000);
    expect(
      Expense.create({ ...expenseProps, amount: Money.fromCents(MAX_EXPENSE_CENTS) }).amount.cents,
    ).toBe(MAX_EXPENSE_CENTS);
    expect(() =>
      Expense.create({ ...expenseProps, amount: Money.fromCents(MAX_EXPENSE_CENTS + 1) }),
    ).toThrow(ValidationError);
  });

  it('has no createdAt until it is persisted, and carries the stored one', () => {
    expect(Expense.create(expenseProps).createdAt).toBeNull();
    const at = new Date('2026-11-02T10:00:00Z');
    expect(Expense.create({ ...expenseProps, createdAt: at }).createdAt).toEqual(at);
    expect(Expense.create({ ...expenseProps, createdAt: at }).createdAt).not.toBe(at);
  });

  it('rejects an invalid spentAt date', () => {
    expect(() => Expense.create({ ...expenseProps, spentAt: new Date('nope') })).toThrow(
      ValidationError,
    );
  });
});

describe('User', () => {
  const now = new Date('2026-11-08T10:00:00Z');

  it('starts active, with no failed logins and unlocked', () => {
    const u = User.create(userProps);
    expect(u.active).toBe(true);
    expect(u.failedLogins).toBe(0);
    expect(u.lockedUntil).toBeNull();
    expect(u.isLocked(now)).toBe(false);
  });

  it('has no createdAt until persisted, and keeps it through changes', () => {
    expect(User.create(userProps).createdAt).toBeNull();
    const created = new Date('2026-01-02T03:04:05Z');
    const u = User.create({ ...userProps, createdAt: created });
    expect(u.createdAt).toEqual(created);
    expect(u.createdAt).not.toBe(created);
    expect(u.withRole('A').withActive(false).createdAt).toEqual(created);
  });

  it('rejects blank name', () => {
    expect(() => User.create({ ...userProps, name: '  ' })).toThrow(ValidationError);
  });

  it('counts failures without locking below the limit and does not mutate', () => {
    const u = User.create(userProps);
    const after = u.registerFailedLogin(now, 5, 15);
    expect(after.failedLogins).toBe(1);
    expect(after.isLocked(now)).toBe(false);
    expect(u.failedLogins).toBe(0);
  });

  it('locks when the limit is reached and unlocks after lockedUntil', () => {
    let u = User.create(userProps);
    for (let i = 0; i < 5; i++) u = u.registerFailedLogin(now, 5, 15);
    expect(u.lockedUntil).toEqual(new Date('2026-11-08T10:15:00Z'));
    expect(u.isLocked(new Date('2026-11-08T10:14:59Z'))).toBe(true);
    expect(u.isLocked(new Date('2026-11-08T10:15:00Z'))).toBe(false);
    expect(u.isLocked(new Date('2026-11-08T11:00:00Z'))).toBe(false);
  });

  it('does not lock on 4 failures and locks on the 5th', () => {
    let u = User.create(userProps);
    for (let i = 0; i < 4; i++) u = u.registerFailedLogin(now, 5, 15);
    expect(u.failedLogins).toBe(4);
    expect(u.lockedUntil).toBeNull();
    u = u.registerFailedLogin(now, 5, 15);
    expect(u.isLocked(now)).toBe(true);
  });

  it('ignores failures during the lock without sliding it', () => {
    let u = User.create(userProps);
    for (let i = 0; i < 5; i++) u = u.registerFailedLogin(now, 5, 15);
    const later = new Date('2026-11-08T10:10:00Z');
    const after = u.registerFailedLogin(later, 5, 15);
    expect(after.lockedUntil).toEqual(u.lockedUntil);
    expect(after.failedLogins).toBe(u.failedLogins);
  });

  it('restarts the counter after the lock expires', () => {
    let u = User.create(userProps);
    for (let i = 0; i < 5; i++) u = u.registerFailedLogin(now, 5, 15);
    const expired = new Date('2026-11-08T10:15:00Z');
    const after = u.registerFailedLogin(expired, 5, 15);
    expect(after.failedLogins).toBe(1);
    expect(after.lockedUntil).toBeNull();
    expect(after.isLocked(expired)).toBe(false);
  });

  it('resets failed logins and the lock', () => {
    let u = User.create(userProps);
    for (let i = 0; i < 5; i++) u = u.registerFailedLogin(now, 5, 15);
    const reset = u.resetFailedLogins();
    expect(reset.failedLogins).toBe(0);
    expect(reset.lockedUntil).toBeNull();
    expect(reset.isLocked(now)).toBe(false);
  });
});

describe('User secrecy and updates', () => {
  const secret = 'SENTINEL-HASH-9f8e7d';

  it('never leaks the password hash through serialization', () => {
    const u = User.create({ ...userProps, passwordHash: secret });
    expect(JSON.stringify(u)).not.toContain(secret);
    expect(String(u)).not.toContain(secret);
    expect(inspect(u, { depth: 5 })).not.toContain(secret);
    expect(inspect(u.registerFailedLogin(new Date(), 5, 15), { depth: 5 })).not.toContain(secret);
  });

  it('still exposes the hash through the explicit getter', () => {
    expect(User.create({ ...userProps, passwordHash: secret }).passwordHash).toBe(secret);
  });

  it('withRole returns a new instance with the role changed', () => {
    const u = User.create(userProps);
    const admin = u.withRole('A');
    expect(admin.role).toBe('A');
    expect(u.role).toBe('N');
    expect(admin.id).toBe(u.id);
  });

  it('withActive returns a new instance with active changed', () => {
    const u = User.create(userProps);
    const off = u.withActive(false);
    expect(off.active).toBe(false);
    expect(u.active).toBe(true);
  });
});

describe('Category', () => {
  it('is global when ownerId is null', () => {
    expect(Category.create({ id: 'c1', name: 'Food', ownerId: null }).isGlobal()).toBe(true);
    expect(Category.create({ id: 'c2', name: 'Mine', ownerId: 'u1' }).isGlobal()).toBe(false);
  });

  it('rejects blank name', () => {
    expect(() => Category.create({ id: 'c1', name: ' ', ownerId: null })).toThrow(ValidationError);
  });

  it('exposes a case-insensitive, trimmed nameKey for uniqueness', () => {
    const a = Category.create({ id: 'c1', name: '  Alimentação ', ownerId: null });
    const b = Category.create({ id: 'c2', name: 'ALIMENTAÇÃO', ownerId: null });
    expect(a.nameKey).toBe(b.nameKey);
    expect(a.name).toBe('Alimentação');
  });

  it('gives canonically equivalent names the same nameKey', () => {
    const composed = Category.create({ id: 'c1', name: 'Caf\u00e9', ownerId: null });
    const decomposed = Category.create({ id: 'c2', name: 'Cafe\u0301', ownerId: null });
    expect(composed.nameKey).toBe(decomposed.nameKey);
  });

  it('stores the name in NFC with repeated inner whitespace collapsed to one space', () => {
    const c = Category.create({ id: 'c1', name: '  Cafe\u0301 \u00a0  da   \u2003 manha  ', ownerId: null });
    expect(c.name).toBe('Caf\u00e9 da manha');
    expect(c.name).toBe(c.name.normalize('NFC'));
  });

  it('makes names that differ only by inner spacing collide', () => {
    const a = Category.create({ id: 'c1', name: 'a  b', ownerId: null });
    const b = Category.create({ id: 'c2', name: 'a b', ownerId: null });
    expect(a.nameKey).toBe(b.nameKey);
    expect(a.name).toBe('a b');
  });

  it('measures the 60 limit in code points, so emoji are not penalized', () => {
    const sixty = '\u{1F600}'.repeat(60);
    expect(Category.create({ id: 'c1', name: sixty, ownerId: null }).name).toBe(sixty);
    expect(() => Category.create({ id: 'c1', name: sixty + '\u{1F600}', ownerId: null })).toThrow(
      ValidationError,
    );
  });

  it('measures the limit after normalization', () => {
    const padded = 'x'.repeat(30) + ' '.repeat(40) + 'y'.repeat(29);
    expect(Category.create({ id: 'c1', name: padded, ownerId: null }).name).toHaveLength(60);
  });

  it('rejects names over 60 characters', () => {
    expect(() => Category.create({ id: 'c1', name: 'x'.repeat(61), ownerId: null })).toThrow(
      ValidationError,
    );
    expect(Category.create({ id: 'c1', name: 'x'.repeat(60), ownerId: null }).name).toHaveLength(60);
  });
});

describe('Receipt', () => {
  const props = {
    id: 'r1',
    userId: 'u1',
    storageKey: 'abc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    suggestedAmount: null,
  };

  it('creates with a null suggestion', () => {
    expect(Receipt.create(props).suggestedAmount).toBeNull();
  });

  it.each([0, -5, 1.5])('rejects size %p', (sizeBytes) => {
    expect(() => Receipt.create({ ...props, sizeBytes })).toThrow(ValidationError);
  });
});

describe('MonthlyIncome', () => {
  const amount = Money.fromCents(500000);

  it('accepts a valid month', () => {
    expect(MonthlyIncome.create({ userId: 'u1', month: '2026-11', amount }).month).toBe('2026-11');
  });

  it.each(['0050-01', '0000-01', '1899-12', '9999-12'])('rejects the out of range month %p', (month) => {
    expect(() => MonthlyIncome.create({ userId: 'u1', month, amount })).toThrow(ValidationError);
  });

  it.each(['1900-01', '9998-12'])('accepts the boundary month %p', (month) => {
    expect(MonthlyIncome.create({ userId: 'u1', month, amount }).month).toBe(month);
  });

  it.each(['2026-13', '2026-00', '26-1', '2026-1', '2026-11-01', '', 'abcd-ef'])(
    'rejects month %p',
    (month) => {
      expect(() => MonthlyIncome.create({ userId: 'u1', month, amount })).toThrow(ValidationError);
    },
  );

  it.each([0, -1])('rejects income of %i cents', (cents) => {
    expect(() =>
      MonthlyIncome.create({ userId: 'u1', month: '2026-11', amount: Money.fromCents(cents) }),
    ).toThrow(ValidationError);
  });
});

describe('RefreshToken', () => {
  const props = {
    id: 't1',
    userId: 'u1',
    familyId: 'f1',
    tokenHash: 'h',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  };

  it('starts not revoked', () => {
    expect(RefreshToken.create(props).revokedAt).toBeNull();
  });

  it('revoke returns a new revoked instance', () => {
    const t = RefreshToken.create(props);
    const now = new Date('2026-11-08T00:00:00Z');
    const r = t.revoke(now);
    expect(r.revokedAt).toEqual(now);
    expect(t.revokedAt).toBeNull();
  });
});

describe('Date immutability', () => {
  it('Expense.spentAt is protected from outside mutation', () => {
    const input = new Date('2026-11-01T00:00:00Z');
    const e = Expense.create({ ...expenseProps, spentAt: input });
    input.setUTCFullYear(2000);
    e.spentAt.setUTCFullYear(1999);
    expect(e.spentAt).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('User.lockedUntil is protected from outside mutation', () => {
    const input = new Date('2026-11-08T10:15:00Z');
    const u = User.create({ ...userProps, lockedUntil: input });
    input.setUTCFullYear(2000);
    u.lockedUntil?.setUTCFullYear(1999);
    expect(u.lockedUntil).toEqual(new Date('2026-11-08T10:15:00Z'));
  });

  it('RefreshToken dates are protected from outside mutation', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    const revokedAt = new Date('2026-11-08T00:00:00Z');
    const t = RefreshToken.create({
      id: 't1',
      userId: 'u1',
      familyId: 'f1',
      tokenHash: 'h',
      expiresAt,
      revokedAt,
    });
    expiresAt.setUTCFullYear(2000);
    revokedAt.setUTCFullYear(2000);
    t.expiresAt.setUTCFullYear(1999);
    t.revokedAt?.setUTCFullYear(1999);
    expect(t.expiresAt).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(t.revokedAt).toEqual(new Date('2026-11-08T00:00:00Z'));
    const now = new Date('2026-11-09T00:00:00Z');
    const r = t.revoke(now);
    now.setUTCFullYear(2000);
    expect(r.revokedAt).toEqual(new Date('2026-11-09T00:00:00Z'));
  });
});

describe('Required identifiers', () => {
  const blanks = ['', '   '];

  it.each(blanks)('rejects blank ids on Expense (%p)', (v) => {
    expect(() => Expense.create({ ...expenseProps, id: v })).toThrow(ValidationError);
    expect(() => Expense.create({ ...expenseProps, userId: v })).toThrow(ValidationError);
    expect(() => Expense.create({ ...expenseProps, categoryId: v })).toThrow(ValidationError);
  });

  it.each(blanks)('rejects blank ids on User, Category, Receipt, RefreshToken, Income (%p)', (v) => {
    expect(() => User.create({ ...userProps, id: v })).toThrow(ValidationError);
    expect(() => Category.create({ id: v, name: 'Food', ownerId: null })).toThrow(ValidationError);
    const receipt = {
      id: 'r1',
      userId: 'u1',
      storageKey: 'k.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      suggestedAmount: null,
    };
    expect(() => Receipt.create({ ...receipt, id: v })).toThrow(ValidationError);
    expect(() => Receipt.create({ ...receipt, userId: v })).toThrow(ValidationError);
    const token = {
      id: 't1',
      userId: 'u1',
      familyId: 'f1',
      tokenHash: 'h',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    };
    expect(() => RefreshToken.create({ ...token, id: v })).toThrow(ValidationError);
    expect(() => RefreshToken.create({ ...token, userId: v })).toThrow(ValidationError);
    expect(() =>
      MonthlyIncome.create({ userId: v, month: '2026-11', amount: Money.fromCents(1) }),
    ).toThrow(ValidationError);
  });

  it('limits Expense.description to 500 characters', () => {
    expect(
      Expense.create({ ...expenseProps, description: 'a'.repeat(500) }).description,
    ).toHaveLength(500);
    expect(() => Expense.create({ ...expenseProps, description: 'a'.repeat(501) })).toThrow(
      ValidationError,
    );
  });

  it('normalizes spentAt to 00:00 UTC of the same UTC calendar day', () => {
    const e = Expense.create({ ...expenseProps, spentAt: new Date('2026-03-31T23:30:00Z') });
    expect(e.spentAt).toEqual(new Date('2026-03-31T00:00:00Z'));
  });
});
