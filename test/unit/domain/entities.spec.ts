import { inspect } from 'util';
import { Category } from '../../../src/domain/entities/category';
import { Expense } from '../../../src/domain/entities/expense';
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

  it.each([0, -1])('rejects amount of %i cents', (cents) => {
    expect(() => Expense.create({ ...expenseProps, amount: Money.fromCents(cents) })).toThrow(
      ValidationError,
    );
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

  it.each(['2026-13', '2026-00', '26-1', '2026-1', '2026-11-01', '', 'abcd-ef'])(
    'rejects month %p',
    (month) => {
      expect(() => MonthlyIncome.create({ userId: 'u1', month, amount })).toThrow(ValidationError);
    },
  );

  it('rejects negative income', () => {
    expect(() =>
      MonthlyIncome.create({ userId: 'u1', month: '2026-11', amount: Money.fromCents(-1) }),
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
