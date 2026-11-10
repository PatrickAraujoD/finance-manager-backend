import { Email } from '../../../src/domain/email';
import { Category } from '../../../src/domain/entities/category';
import { Expense } from '../../../src/domain/entities/expense';
import { Loan } from '../../../src/domain/entities/loan';
import { LoanPayment } from '../../../src/domain/entities/loan-payment';
import { MonthlyIncome } from '../../../src/domain/entities/monthly-income';
import { RefreshToken } from '../../../src/domain/entities/refresh-token';
import { User } from '../../../src/domain/entities/user';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';
import { FakeCategoryRepository } from '../../support/fakes/fake-category-repository';
import { FakeExpenseRepository } from '../../support/fakes/fake-expense-repository';
import { FakeFileStorage } from '../../support/fakes/fake-file-storage';
import { FakeLoanPaymentRepository } from '../../support/fakes/fake-loan-payment-repository';
import { FakeLoanRepository } from '../../support/fakes/fake-loan-repository';
import { FakeIncomeRepository } from '../../support/fakes/fake-income-repository';
import { FakePasswordHasher } from '../../support/fakes/fake-password-hasher';
import { FakeReceiptExtractor } from '../../support/fakes/fake-receipt-extractor';
import { FakeRefreshTokenRepository } from '../../support/fakes/fake-refresh-token-repository';
import { FakeReportRepository } from '../../support/fakes/fake-report-repository';
import { FakeTokenService } from '../../support/fakes/fake-token-service';
import { FakeUserRepository } from '../../support/fakes/fake-user-repository';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

const expense = (id: string, userId: string, categoryId: string, cents: number, at: string) =>
  Expense.create({
    id,
    userId,
    categoryId,
    receiptId: null,
    amount: Money.fromCents(cents),
    paidAlone: true,
    paymentMethod: 'PIX',
    isCardPayment: false,
    spentAt: new Date(at),
  });

describe('FakeUserRepository', () => {
  it('finds by id and by case-insensitive email, and lists', async () => {
    const repo = new FakeUserRepository();
    const u = User.create({
      id: 'u1',
      name: 'Ana',
      email: Email.create('Ana@x.com'),
      passwordHash: 'h',
      role: 'N',
    });
    await repo.save(u);
    expect(await repo.findById('u1')).toBe(u);
    expect(await repo.findByEmail(Email.create('ANA@x.com'))).toBe(u);
    expect(await repo.findByEmail(Email.create('b@x.com'))).toBeNull();
    expect(await repo.list()).toEqual([u]);
  });

  it('save throws ConflictError when the email belongs to another id', async () => {
    const repo = new FakeUserRepository();
    const mk = (id: string, email: string) =>
      User.create({ id, name: 'Ana', email: Email.create(email), passwordHash: 'h', role: 'N' });
    await repo.save(mk('u1', 'ana@x.com'));
    await expect(repo.save(mk('u2', 'ANA@x.com'))).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.save(mk('u1', 'ana@x.com'))).resolves.toBeUndefined();
  });

  it('mutate applies fn to the current value and returns the updated user', async () => {
    const repo = new FakeUserRepository();
    await repo.save(
      User.create({
        id: 'u1',
        name: 'Ana',
        email: Email.create('a@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    const updated = await repo.mutate('u1', (u) => u.withActive(false));
    expect(updated?.active).toBe(false);
    expect((await repo.findById('u1'))?.active).toBe(false);
    expect(await repo.mutate('missing', (u) => u)).toBeNull();
  });

  it('mutate serializes concurrent mutations (no lost updates)', async () => {
    const repo = new FakeUserRepository();
    await repo.save(
      User.create({
        id: 'u1',
        name: 'Ana',
        email: Email.create('a@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    const now = new Date('2026-11-08T00:00:00Z');
    await Promise.all(
      Array.from({ length: 4 }, () =>
        repo.mutate('u1', (u) => u.registerFailedLogin(now, 100, 15)),
      ),
    );
    expect((await repo.findById('u1'))?.failedLogins).toBe(4);
  });
});

describe('FakeCategoryRepository', () => {
  it('listVisibleTo returns global and own categories only', async () => {
    const repo = new FakeCategoryRepository(new FakeExpenseRepository());
    const global = Category.create({ id: 'g', name: 'Food', ownerId: null });
    const mine = Category.create({ id: 'm', name: 'Mine', ownerId: 'u1' });
    const theirs = Category.create({ id: 't', name: 'Theirs', ownerId: 'u2' });
    for (const c of [global, mine, theirs]) await repo.save(c);
    expect(await repo.listVisibleTo('u1')).toEqual([global, mine]);
  });

  it('save throws ConflictError for the same nameKey in the same scope, not across scopes', async () => {
    const repo = new FakeCategoryRepository(new FakeExpenseRepository());
    await repo.save(Category.create({ id: 'g', name: 'Food', ownerId: null }));
    await repo.save(Category.create({ id: 'm', name: 'Food', ownerId: 'u1' }));
    await repo.save(Category.create({ id: 'o', name: 'Food', ownerId: 'u2' }));
    await expect(
      repo.save(Category.create({ id: 'g2', name: ' FOOD ', ownerId: null })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repo.save(Category.create({ id: 'm2', name: 'food', ownerId: 'u1' })),
    ).rejects.toBeInstanceOf(ConflictError);
    // Re-saving the same id (rename to itself) is an update, not a duplicate.
    await expect(repo.save(Category.create({ id: 'm', name: 'FOOD', ownerId: 'u1' }))).resolves.toBeUndefined();
  });

  it('delete throws ConflictError while expenses reference the category (FK restrict)', async () => {
    const expenses = new FakeExpenseRepository();
    const repo = new FakeCategoryRepository(expenses);
    await repo.save(Category.create({ id: 'g', name: 'Food', ownerId: null }));
    await expenses.save(expense('e1', 'u1', 'g', 100, '2026-11-01T00:00:00Z'));
    await expect(repo.delete('g')).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.findById('g')).not.toBeNull();
  });

  it('isInUse reflects expenses and delete removes the category', async () => {
    const expenses = new FakeExpenseRepository();
    const repo = new FakeCategoryRepository(expenses);
    await repo.save(Category.create({ id: 'g', name: 'Food', ownerId: null }));
    expect(await repo.isInUse('g')).toBe(false);
    await expenses.save(expense('e1', 'u1', 'g', 100, '2026-11-01T00:00:00Z'));
    expect(await repo.isInUse('g')).toBe(true);
    expect(await expenses.delete('u1', 'e1')).toBe(true);
    await repo.delete('g');
    expect(await repo.findById('g')).toBeNull();
  });
});

describe('FakeExpenseRepository', () => {
  it('listByUser filters by owner, inclusive date range and category', async () => {
    const repo = new FakeExpenseRepository();
    const a = expense('a', 'u1', 'c1', 100, '2026-11-01T00:00:00Z');
    const b = expense('b', 'u1', 'c2', 200, '2026-11-10T00:00:00Z');
    const c = expense('c', 'u2', 'c1', 300, '2026-11-01T00:00:00Z');
    for (const e of [a, b, c]) await repo.save(e);
    expect(await repo.listByUser('u1', {})).toHaveLength(2);
    expect(await repo.listByUser('u1', { categoryId: 'c2' })).toEqual([b]);
    expect(
      await repo.listByUser('u1', {
        from: new Date('2026-11-01T00:00:00Z'),
        to: new Date('2026-11-01T00:00:00Z'),
      }),
    ).toEqual([a]);
  });
});

describe('FakeExpenseRepository ordering', () => {
  it('listByUser orders by spentAt desc, then id desc', async () => {
    const repo = new FakeExpenseRepository();
    const old = expense('z', 'u1', 'c1', 100, '2026-11-01T00:00:00Z');
    const newA = expense('a', 'u1', 'c1', 100, '2026-11-05T00:00:00Z');
    const newB = expense('b', 'u1', 'c1', 100, '2026-11-05T00:00:00Z');
    for (const e of [old, newA, newB]) await repo.save(e);
    expect((await repo.listByUser('u1', {})).map((e) => e.id)).toEqual(['b', 'a', 'z']);
  });
});

describe('FakeExpenseRepository port contract', () => {
  const withReceipt = (id: string, receiptId: string | null, userId = 'u1') =>
    Expense.create({
      id,
      userId,
      categoryId: 'c1',
      receiptId,
      amount: Money.fromCents(100),
      paidAlone: true,
      paymentMethod: 'PIX',
      isCardPayment: false,
      spentAt: new Date('2026-11-01T00:00:00Z'),
    });

  it('findById and delete are scoped to the owner', async () => {
    const repo = new FakeExpenseRepository();
    await repo.save(withReceipt('a', null));
    expect(await repo.findById('u1', 'a')).not.toBeNull();
    expect(await repo.findById('u2', 'a')).toBeNull();
    expect(await repo.delete('u2', 'a')).toBe(false);
    expect(await repo.findById('u1', 'a')).not.toBeNull();
    expect(await repo.delete('u1', 'a')).toBe(true);
    expect(await repo.delete('u1', 'a')).toBe(false);
  });

  it('save refuses a repeated id and a receipt that is already used', async () => {
    const repo = new FakeExpenseRepository();
    await repo.save(withReceipt('a', 'r1'));
    await expect(repo.save(withReceipt('a', null))).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.save(withReceipt('b', 'r1'))).rejects.toBeInstanceOf(ConflictError);
    await repo.save(withReceipt('c', null));
    await repo.save(withReceipt('d', null));
  });

  it('update changes the editable fields only and reports a missing row', async () => {
    const repo = new FakeExpenseRepository();
    await repo.save(withReceipt('a', 'r1'));
    const changed = Expense.create({
      id: 'a',
      userId: 'u2',
      categoryId: 'c9',
      receiptId: 'other',
      amount: Money.fromCents(999),
      paidAlone: false,
      paymentMethod: 'PIX',
      isCardPayment: false,
      spentAt: new Date('2026-10-01T00:00:00Z'),
      description: 'x',
    });
    expect(await repo.update(changed)).toBe(false);
    expect(await repo.update(withReceipt('zzz', null))).toBe(false);
    const own = Expense.create({
      id: 'a',
      userId: 'u1',
      categoryId: 'c9',
      receiptId: 'other',
      amount: Money.fromCents(999),
      paidAlone: false,
      paymentMethod: 'PIX',
      isCardPayment: false,
      spentAt: new Date('2026-10-01T00:00:00Z'),
      description: 'x',
    });
    expect(await repo.update(own)).toBe(true);
    const stored = await repo.findById('u1', 'a');
    expect(stored?.categoryId).toBe('c9');
    expect(stored?.amount.cents).toBe(999);
    expect(stored?.receiptId).toBe('r1');
    expect(stored?.userId).toBe('u1');
  });

  it('pages the listing and counts the full filtered set', async () => {
    const repo = new FakeExpenseRepository();
    for (const id of ['a', 'b', 'c', 'd']) await repo.save(withReceipt(id, null));
    await repo.save(withReceipt('x', null, 'u2'));
    expect((await repo.listByUser('u1', {}, { limit: 2, offset: 1 })).map((e) => e.id)).toEqual([
      'c',
      'b',
    ]);
    expect(await repo.countByUser('u1', {})).toBe(4);
    expect(await repo.countByUser('u1', { categoryId: 'nope' })).toBe(0);
  });
});

describe('FakeIncomeRepository', () => {
  it('upsert replaces the value for the same user and month', async () => {
    const repo = new FakeIncomeRepository();
    const mk = (c: number) =>
      MonthlyIncome.create({ userId: 'u1', month: '2026-11', amount: Money.fromCents(c) });
    await repo.upsert(mk(100));
    await repo.upsert(mk(200));
    expect((await repo.find('u1', '2026-11'))?.amount.cents).toBe(200);
    expect(await repo.find('u1', '2026-10')).toBeNull();
  });
});

describe('FakeRefreshTokenRepository', () => {
  it('revokeFamily revokes only tokens of that family', async () => {
    const repo = new FakeRefreshTokenRepository();
    const mk = (id: string, familyId: string) =>
      RefreshToken.create({
        id,
        userId: 'u1',
        familyId,
        tokenHash: `h-${id}`,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      });
    await repo.save(mk('1', 'f1'));
    await repo.save(mk('2', 'f1'));
    await repo.save(mk('3', 'f2'));
    await repo.revokeFamily('f1');
    expect((await repo.findByHash('h-1'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('h-2'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('h-3'))?.revokedAt).toBeNull();
    expect(await repo.findByHash('missing')).toBeNull();
  });

  it('revokeAllByUser revokes every active token of that user only', async () => {
    const repo = new FakeRefreshTokenRepository();
    const mk = (id: string, userId: string) =>
      RefreshToken.create({
        id,
        userId,
        familyId: `f-${id}`,
        tokenHash: `h-${id}`,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      });
    await repo.save(mk('1', 'u1'));
    await repo.save(mk('2', 'u1'));
    await repo.save(mk('3', 'u2'));
    await repo.revokeAllByUser('u1');
    expect((await repo.findByHash('h-1'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('h-2'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('h-3'))?.revokedAt).toBeNull();
  });
});

describe('FakeRefreshTokenRepository.rotate', () => {
  const mk = (id: string, hash = `h-${id}`) =>
    RefreshToken.create({
      id,
      userId: 'u1',
      familyId: 'f1',
      tokenHash: hash,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
  const now = new Date('2026-11-08T00:00:00Z');

  it('revokes the old token and stores the replacement', async () => {
    const repo = new FakeRefreshTokenRepository();
    await repo.save(mk('1'));
    expect(await repo.rotate('1', mk('2'), now)).toBe(true);
    expect((await repo.findByHash('h-1'))?.revokedAt).toEqual(now);
    expect((await repo.findByHash('h-2'))?.revokedAt).toBeNull();
  });

  it('returns false and stores nothing when the old token is already revoked', async () => {
    const repo = new FakeRefreshTokenRepository();
    await repo.save(mk('1'));
    await repo.rotate('1', mk('2'), now);
    expect(await repo.rotate('1', mk('3'), new Date())).toBe(false);
    expect(await repo.findByHash('h-3')).toBeNull();
    expect((await repo.findByHash('h-1'))?.revokedAt).toEqual(now);
  });

  it('returns false for an unknown id', async () => {
    const repo = new FakeRefreshTokenRepository();
    expect(await repo.rotate('nope', mk('2'), now)).toBe(false);
    expect(await repo.findByHash('h-2')).toBeNull();
  });

  it('lets exactly one of many concurrent rotations win', async () => {
    const repo = new FakeRefreshTokenRepository();
    await repo.save(mk('1'));
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => repo.rotate('1', mk(`n${i}`), now)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    let stored = 0;
    for (let i = 0; i < 5; i++) if (await repo.findByHash(`h-n${i}`)) stored++;
    expect(stored).toBe(1);
  });

  it('rolls back when the replacement cannot be stored (duplicate hash)', async () => {
    const repo = new FakeRefreshTokenRepository();
    await repo.save(mk('1'));
    await repo.save(mk('2', 'dup'));
    await expect(repo.rotate('1', mk('3', 'dup'), now)).rejects.toThrow();
    expect((await repo.findByHash('h-1'))?.revokedAt).toBeNull();
  });
});

describe('FakeReportRepository', () => {
  it('aggregates only the requested user and month', async () => {
    const expenses = new FakeExpenseRepository();
    const categories = new FakeCategoryRepository(expenses);
    await categories.save(Category.create({ id: 'c1', name: 'Food', ownerId: null }));
    await categories.save(Category.create({ id: 'c2', name: 'Bus', ownerId: null }));
    for (const e of [
      expense('1', 'u1', 'c1', 100, '2026-11-01T10:00:00Z'),
      expense('2', 'u1', 'c1', 50, '2026-11-01T20:00:00Z'),
      expense('3', 'u1', 'c2', 25, '2026-11-02T10:00:00Z'),
      expense('4', 'u1', 'c2', 10, '2026-10-02T10:00:00Z'),
      expense('5', 'u2', 'c1', 999, '2026-11-01T10:00:00Z'),
    ]) {
      await expenses.save(e);
    }
    const repo = new FakeReportRepository(
      expenses,
      categories,
      new FakeLoanPaymentRepository(new FakeLoanRepository()),
    );
    const byCat = await repo.totalsByCategory('u1', '2026-11');
    expect(byCat.map((r) => [r.categoryName, r.total.cents])).toEqual([
      ['Food', 150],
      ['Bus', 25],
    ]);
    const byDay = await repo.totalsByDay('u1', '2026-11');
    expect(byDay.map((r) => [r.date, r.total.cents])).toEqual([
      ['2026-11-01', 150],
      ['2026-11-02', 25],
    ]);
    const byMonth = await repo.totalsByMonth('u1', '2026-10', '2026-11');
    expect(byMonth.map((r) => [r.month, r.total.cents])).toEqual([
      ['2026-10', 10],
      ['2026-11', 175],
    ]);
    expect((await repo.accountOutflow('u1', '2026-11')).cents).toBe(175);
    expect((await repo.accountOutflow('u1', '2025-01')).cents).toBe(0);
  });

  it('aggregates the account and card figures like the SQL does, per user and month', async () => {
    const expenses = new FakeExpenseRepository();
    const categories = new FakeCategoryRepository(expenses);
    const loans = new FakeLoanRepository();
    const payments = new FakeLoanPaymentRepository(loans);
    const spent = (
      id: string,
      userId: string,
      cents: number,
      at: string,
      how: { paymentMethod?: 'CREDIT' | 'PIX'; isCardPayment?: boolean } = {},
    ) =>
      Expense.create({
        id,
        userId,
        categoryId: 'c1',
        receiptId: null,
        amount: Money.fromCents(cents),
        paidAlone: true,
        paymentMethod: how.paymentMethod ?? 'PIX',
        isCardPayment: how.isCardPayment ?? false,
        spentAt: new Date(`${at}T00:00:00Z`),
      });
    for (const e of [
      spent('a', 'u1', 10, '2026-11-01'),
      spent('b', 'u1', 1000, '2026-11-02', { paymentMethod: 'CREDIT' }),
      spent('c', 'u1', 100, '2026-11-30', { isCardPayment: true }),
      spent('d', 'u1', 300, '2026-10-31', { paymentMethod: 'CREDIT' }),
      spent('e', 'u1', 40, '2026-10-15', { isCardPayment: true }),
      spent('f', 'u1', 7, '2026-12-01', { paymentMethod: 'CREDIT' }),
      spent('g', 'u2', 999, '2026-11-02', { paymentMethod: 'CREDIT' }),
    ]) {
      await expenses.save(e);
    }
    await loans.save(
      Loan.create({
        id: 'l1',
        userId: 'u1',
        borrowerName: 'Zé',
        amount: Money.fromCents(10000),
        dueDate: new Date('2027-01-01T00:00:00Z'),
        expenseId: null,
      }),
    );
    for (const [id, cents, at] of [
      ['p1', 25, '2026-11-30'],
      ['p2', 50, '2026-12-01'],
    ] as const) {
      await payments.add(
        LoanPayment.create({
          id,
          loanId: 'l1',
          userId: 'u1',
          amount: Money.fromCents(cents),
          method: 'CASH',
          receiptId: null,
          paidAt: new Date(`${at}T00:00:00Z`),
        }),
      );
    }
    const repo = new FakeReportRepository(expenses, categories, payments);

    expect((await repo.accountOutflow('u1', '2026-11')).cents).toBe(110);
    expect((await repo.creditSpent('u1', '2026-11')).cents).toBe(1000);
    expect((await repo.loanPaymentsReceived('u1', '2026-11')).cents).toBe(25);
    const charges = await repo.cardCharges('u1', '2026-11');
    expect([charges.beforeMonth.cents, charges.inMonth.cents]).toEqual([300, 1000]);
    const paid = await repo.cardPayments('u1', '2026-11');
    expect([paid.beforeMonth.cents, paid.inMonth.cents]).toEqual([40, 100]);
    expect((await repo.accountOutflow('u2', '2026-11')).cents).toBe(0);
    expect((await repo.loanPaymentsReceived('u2', '2026-11')).cents).toBe(0);
  });
});

describe('FakePasswordHasher', () => {
  it('does not keep the plain password and verifies', async () => {
    const hasher = new FakePasswordHasher();
    const hash = await hasher.hash('secret123');
    expect(hash).toBe('hashed:' + Buffer.from('secret123').toString('base64'));
    expect(hash).not.toContain('secret123');
    expect(await hasher.verify(hash, 'secret123')).toBe(true);
    expect(await hasher.verify(hash, 'other')).toBe(false);
  });
});

describe('FakeTokenService', () => {
  it('round-trips access tokens and rejects garbage', async () => {
    const svc = new FakeTokenService();
    const token = await svc.signAccess({ sub: 'u1', role: 'A' });
    expect(await svc.verifyAccess(token)).toEqual({ sub: 'u1', role: 'A' });
    await expect(svc.verifyAccess('garbage')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('generates distinct refresh tokens whose hash differs from the token', () => {
    const svc = new FakeTokenService();
    const a = svc.generateRefresh();
    const b = svc.generateRefresh();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(a.token);
  });

  it('hashes a presented refresh token to the same value generateRefresh returned', () => {
    const svc = new FakeTokenService();
    const a = svc.generateRefresh();
    expect(svc.hashRefresh(a.token)).toBe(a.hash);
  });
});

describe('FakeFileStorage', () => {
  it('saves, reads and deletes; reading a missing key throws NotFoundError', async () => {
    const storage = new FakeFileStorage();
    const key = await storage.save(Buffer.from('abc'), 'pdf');
    expect(key.endsWith('pdf')).toBe(true);
    expect((await storage.read(key)).toString()).toBe('abc');
    await storage.delete(key);
    await expect(storage.read(key)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('FakeFileStorage ext validation', () => {
  it.each(['.pdf', '', 'PDF', 'toolong', 'p/f', 'p df'])('rejects ext %p', async (ext) => {
    await expect(new FakeFileStorage().save(Buffer.from('x'), ext)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('FakeReceiptExtractor', () => {
  it('returns the configured result and records calls', async () => {
    const extractor = new FakeReceiptExtractor({ amount: Money.fromCents(500), confidence: 0.9 });
    const buf = Buffer.from('x');
    expect((await extractor.extract(buf, 'image/png')).amount?.cents).toBe(500);
    extractor.result = { amount: null, confidence: 0 };
    expect((await extractor.extract(buf, 'application/pdf')).amount).toBeNull();
    expect(extractor.calls.map((c) => c.mimeType)).toEqual(['image/png', 'application/pdf']);
  });
});

describe('FixedClock and SequentialIdGenerator', () => {
  it('clock returns the fixed date and can advance', () => {
    const clock = new FixedClock(new Date('2026-11-08T00:00:00Z'));
    expect(clock.now()).toEqual(new Date('2026-11-08T00:00:00Z'));
    clock.advanceMinutes(15);
    expect(clock.now()).toEqual(new Date('2026-11-08T00:15:00Z'));
  });

  it('ids are sequential', () => {
    const ids = new SequentialIdGenerator();
    expect([ids.next(), ids.next()]).toEqual(['id-1', 'id-2']);
  });
});

describe('FakeExpenseRepository.isReceiptUsed', () => {
  it('is true only while an expense backs the receipt', async () => {
    const repo = new FakeExpenseRepository();
    await repo.save(
      Expense.create({
        id: 'e1',
        userId: 'u1',
        categoryId: 'c1',
        receiptId: 'r1',
        amount: Money.fromCents(100),
        paidAlone: true,
        paymentMethod: 'PIX',
        isCardPayment: false,
        spentAt: new Date('2026-11-01T00:00:00Z'),
      }),
    );
    expect(await repo.isReceiptUsed('r1')).toBe(true);
    expect(await repo.isReceiptUsed('r2')).toBe(false);
    await repo.delete('u1', 'e1');
    expect(await repo.isReceiptUsed('r1')).toBe(false);
  });
});
