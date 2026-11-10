import { CreateExpense } from '../../../../src/application/use-cases/expenses/create-expense';
import { DeleteExpense } from '../../../../src/application/use-cases/expenses/delete-expense';
import { GetExpense } from '../../../../src/application/use-cases/expenses/get-expense';
import {
  ListExpenses,
  MAX_EXPENSE_OFFSET,
  MAX_EXPENSE_PAGE,
} from '../../../../src/application/use-cases/expenses/list-expenses';
import { UpdateExpense } from '../../../../src/application/use-cases/expenses/update-expense';
import { Category } from '../../../../src/domain/entities/category';
import { MAX_EXPENSE_CENTS } from '../../../../src/domain/entities/expense';
import { LoanPayment } from '../../../../src/domain/entities/loan-payment';
import { Receipt } from '../../../../src/domain/entities/receipt';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { Money } from '../../../../src/domain/money';
import { loan } from '../../../support/loan-repository-contract';
import { Role } from '../../../../src/domain/role';
import { FakeCategoryRepository } from '../../../support/fakes/fake-category-repository';
import { FakeExpenseRepository } from '../../../support/fakes/fake-expense-repository';
import { FakeLoanPaymentRepository } from '../../../support/fakes/fake-loan-payment-repository';
import { FakeLoanRepository } from '../../../support/fakes/fake-loan-repository';
import { FakeReceiptRepository } from '../../../support/fakes/fake-receipt-repository';
import { FixedClock } from '../../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const ana = { id: 'ana', role: 'N' as Role };
const bob = { id: 'bob', role: 'N' as Role };
const admin = { id: 'admin', role: 'A' as Role };

// Clock: 2026-11-08T12:00Z, so the latest accepted spentAt is 2026-11-09.
async function setup() {
  const expenses = new FakeExpenseRepository();
  const categories = new FakeCategoryRepository(expenses);
  const receipts = new FakeReceiptRepository();
  const loans = new FakeLoanRepository();
  const payments = new FakeLoanPaymentRepository(loans);
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock();
  await categories.save(Category.create({ id: 'g-food', name: 'Food', ownerId: null }));
  await categories.save(Category.create({ id: 'ana-cat', name: 'Mine', ownerId: 'ana' }));
  await categories.save(Category.create({ id: 'bob-cat', name: 'Bobs', ownerId: 'bob' }));
  for (const [id, userId] of [
    ['r-ana', 'ana'],
    ['r-ana-2', 'ana'],
    ['r-bob', 'bob'],
  ]) {
    await receipts.save(
      Receipt.create({
        id,
        userId,
        storageKey: `${id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 10,
        suggestedAmount: Money.fromCents(9999),
      }),
    );
  }
  return {
    expenses,
    clock,
    loans,
    payments,
    create: new CreateExpense(expenses, categories, receipts, ids, clock, payments),
    update: new UpdateExpense(expenses, categories, clock),
    remove: new DeleteExpense(expenses),
    get: new GetExpense(expenses),
    list: new ListExpenses(expenses),
  };
}

const valid = {
  categoryId: 'g-food',
  amountCents: 2550,
  paidAlone: true,
  paymentMethod: 'PIX' as const,
  spentAt: '2026-11-05',
};

describe('CreateExpense', () => {
  it('creates with a global category, stores the user amount and returns the id', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, { ...valid, description: 'Lunch' });
    const expense = await get.execute(ana, id);
    expect(expense.amount.cents).toBe(2550);
    expect(expense.userId).toBe('ana');
    expect(expense.receiptId).toBeNull();
    expect(expense.spentAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(expense.description).toBe('Lunch');
  });

  it('creates with a personal category', async () => {
    const { create } = await setup();
    await expect(create.execute(ana, { ...valid, categoryId: 'ana-cat' })).resolves.toHaveProperty(
      'id',
    );
  });

  it('allows a manual entry (no receipt) with paidAlone true or false', async () => {
    const { create, expenses } = await setup();
    await create.execute(ana, { ...valid, paidAlone: true });
    await create.execute(ana, { ...valid, paidAlone: false });
    expect(expenses.all().map((e) => e.paidAlone)).toEqual([true, false]);
  });

  it('keeps the amount the user confirmed, never the receipt suggestion', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, { ...valid, receiptId: 'r-ana', amountCents: 12345 });
    const expense = await get.execute(ana, id);
    expect(expense.amount.cents).toBe(12345);
    expect(expense.receiptId).toBe('r-ana');
  });

  it('rejects another user category with NotFoundError (no leak)', async () => {
    const { create, expenses } = await setup();
    await expect(
      create.execute(ana, { ...valid, categoryId: 'bob-cat' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      create.execute(ana, { ...valid, categoryId: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(expenses.all()).toHaveLength(0);
  });

  it('rejects another user receipt and a missing receipt with NotFoundError', async () => {
    const { create, expenses } = await setup();
    await expect(create.execute(ana, { ...valid, receiptId: 'r-bob' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(create.execute(ana, { ...valid, receiptId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(expenses.all()).toHaveLength(0);
  });

  it('does not let an admin use someone else receipt or category either', async () => {
    const { create } = await setup();
    await expect(create.execute(admin, { ...valid, receiptId: 'r-ana' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      create.execute(admin, { ...valid, categoryId: 'ana-cat' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a receipt that already backs a loan payment (ConflictError), not another one', async () => {
    const { create, loans, payments, expenses } = await setup();
    await loans.save(loan('l1', { userId: 'ana', cents: 5000 }));
    await payments.add(
      LoanPayment.create({
        id: 'p1',
        loanId: 'l1',
        userId: 'ana',
        amount: Money.fromCents(100),
        method: 'PIX',
        receiptId: 'r-ana',
        paidAt: new Date('2026-11-08T00:00:00Z'),
      }),
    );
    await expect(create.execute(ana, { ...valid, receiptId: 'r-ana' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(expenses.all()).toHaveLength(0);
    await expect(create.execute(ana, { ...valid, receiptId: 'r-ana-2' })).resolves.toBeDefined();
  });

  it('lets one receipt back only one expense (ConflictError)', async () => {
    const { create, expenses } = await setup();
    await create.execute(ana, { ...valid, receiptId: 'r-ana' });
    await expect(create.execute(ana, { ...valid, receiptId: 'r-ana' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(expenses.all()).toHaveLength(1);
  });

  it.each([0, -1, -2550, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, MAX_EXPENSE_CENTS + 1])(
    'rejects amountCents %p',
    async (amountCents) => {
      const { create } = await setup();
      await expect(create.execute(ana, { ...valid, amountCents })).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );

  it.each([undefined, null, '2550', true])('rejects a missing or non numeric amount %p', async (v) => {
    const { create } = await setup();
    await expect(
      create.execute(ana, { ...valid, amountCents: v as unknown as number }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires the amount even when paidAlone is false (the extractor is not a source)', async () => {
    const { create } = await setup();
    const { amountCents: _omit, ...withoutAmount } = valid;
    void _omit;
    await expect(
      create.execute(ana, { ...withoutAmount, paidAlone: false } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts exactly MAX_EXPENSE_CENTS and the minimum of 1 cent', async () => {
    const { create } = await setup();
    await create.execute(ana, { ...valid, amountCents: MAX_EXPENSE_CENTS });
    await create.execute(ana, { ...valid, amountCents: 1 });
  });

  it.each(['2026-02-30', '2026-13-01', '26-1-1', '2026-11-5', '', 'hoje', '2026-11-05T10:00:00Z'])(
    'rejects the invalid spentAt %p',
    async (spentAt) => {
      const { create } = await setup();
      await expect(create.execute(ana, { ...valid, spentAt })).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );

  it('allows today and tomorrow (UTC) but not later', async () => {
    const { create } = await setup();
    await create.execute(ana, { ...valid, spentAt: '2026-11-08' });
    await create.execute(ana, { ...valid, spentAt: '2026-11-09' });
    await expect(create.execute(ana, { ...valid, spentAt: '2026-11-10' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(create.execute(ana, { ...valid, spentAt: '2030-01-01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('follows the clock for the future limit', async () => {
    const { create, clock } = await setup();
    clock.set(new Date('2026-11-08T23:59:59Z'));
    await create.execute(ana, { ...valid, spentAt: '2026-11-09' });
    await expect(create.execute(ana, { ...valid, spentAt: '2026-11-10' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    clock.set(new Date('2026-11-09T00:00:00Z'));
    await create.execute(ana, { ...valid, spentAt: '2026-11-10' });
  });

  it('limits the description to 500 characters and rejects unsafe text', async () => {
    const { create } = await setup();
    await create.execute(ana, { ...valid, description: 'a'.repeat(500) });
    await expect(
      create.execute(ana, { ...valid, description: 'a'.repeat(501) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create.execute(ana, { ...valid, description: 'a\u0000b' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create.execute(ana, { ...valid, description: 'a\ud800b' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create.execute(ana, { ...valid, description: 5 as unknown as string }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores a blank description as no description', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, { ...valid, description: '   ' });
    expect((await get.execute(ana, id)).description).toBeUndefined();
  });

  it.each(['CREDIT', 'DEBIT', 'PIX', 'CASH'] as const)('stores the payment method %s', async (paymentMethod) => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, { ...valid, paymentMethod });
    expect((await get.execute(ana, id)).paymentMethod).toBe(paymentMethod);
  });

  it.each([undefined, null, '', 'CHEQUE', 'cash', 5])('rejects the payment method %p', async (v) => {
    const { create, expenses } = await setup();
    await expect(
      create.execute(ana, { ...valid, paymentMethod: v as unknown as 'PIX' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(expenses.all()).toHaveLength(0);
  });

  it('is not a card payment when isCardPayment is left out', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, valid);
    expect((await get.execute(ana, id)).isCardPayment).toBe(false);
  });

  it.each(['PIX', 'DEBIT', 'CASH'] as const)('stores a card bill payment made with %s', async (paymentMethod) => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, { ...valid, paymentMethod, isCardPayment: true });
    expect((await get.execute(ana, id)).isCardPayment).toBe(true);
  });

  it('rejects a card bill payment made on credit (400) and saves nothing', async () => {
    const { create, expenses } = await setup();
    await expect(
      create.execute(ana, { ...valid, paymentMethod: 'CREDIT', isCardPayment: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(expenses.all()).toHaveLength(0);
  });

  it.each([null, 'true', 1, 0, [], {}])('rejects the non boolean isCardPayment %p', async (v) => {
    const { create, expenses } = await setup();
    await expect(
      create.execute(ana, { ...valid, isCardPayment: v as unknown as boolean }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(expenses.all()).toHaveLength(0);
  });

  it('rejects a non boolean paidAlone', async () => {
    const { create } = await setup();
    await expect(
      create.execute(ana, { ...valid, paidAlone: 'true' as unknown as boolean }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('GetExpense / UpdateExpense / DeleteExpense ownership', () => {
  async function withExpense() {
    const s = await setup();
    const { id } = await s.create.execute(ana, { ...valid, receiptId: 'r-ana', description: 'x' });
    return { ...s, id };
  }

  it('B and the admin cannot read, edit or delete the expense of A (identical NotFoundError)', async () => {
    const { get, update, remove, id } = await withExpense();
    for (const other of [bob, admin]) {
      await expect(get.execute(other, id)).rejects.toThrow(new NotFoundError('Expense not found'));
      await expect(update.execute(other, id, { amountCents: 1 })).rejects.toThrow(
        new NotFoundError('Expense not found'),
      );
      await expect(remove.execute(other, id)).rejects.toThrow(
        new NotFoundError('Expense not found'),
      );
    }
    await expect(get.execute(ana, 'missing')).rejects.toThrow(
      new NotFoundError('Expense not found'),
    );
    expect((await get.execute(ana, id)).amount.cents).toBe(2550);
  });

  it('updates only the given fields and keeps the receipt', async () => {
    const { update, id } = await withExpense();
    const updated = await update.execute(ana, id, { amountCents: 999, categoryId: 'ana-cat' });
    expect(updated.amount.cents).toBe(999);
    expect(updated.categoryId).toBe('ana-cat');
    expect(updated.paidAlone).toBe(true);
    expect(updated.description).toBe('x');
    expect(updated.receiptId).toBe('r-ana');
    expect(updated.spentAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('updates the date, paidAlone and clears the description with a blank one', async () => {
    const { update, id } = await withExpense();
    const updated = await update.execute(ana, id, {
      spentAt: '2026-10-31',
      paidAlone: false,
      description: '',
    });
    expect(updated.spentAt.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(updated.paidAlone).toBe(false);
    expect(updated.description).toBeUndefined();
  });

  it('changes the payment method and keeps the other fields', async () => {
    const { update, id } = await withExpense();
    const updated = await update.execute(ana, id, { paymentMethod: 'CREDIT' });
    expect(updated.paymentMethod).toBe('CREDIT');
    expect(updated.amount.cents).toBe(2550);
  });

  it('rejects an invalid payment method on update', async () => {
    const { update, id } = await withExpense();
    for (const paymentMethod of ['CHEQUE', '', null, 3]) {
      await expect(
        update.execute(ana, id, { paymentMethod: paymentMethod as unknown as 'PIX' }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  describe('isCardPayment', () => {
    it('turns a PIX expense into a card bill payment and back, keeping the other fields', async () => {
      const { update, get, id } = await withExpense();
      const paid = await update.execute(ana, id, { isCardPayment: true });
      expect(paid.isCardPayment).toBe(true);
      expect(paid.paymentMethod).toBe('PIX');
      expect(paid.amount.cents).toBe(2550);
      expect((await get.execute(ana, id)).isCardPayment).toBe(true);
      expect((await update.execute(ana, id, { isCardPayment: false })).isCardPayment).toBe(false);
    });

    it('counts as a field: it alone satisfies the at least one field rule', async () => {
      const { update, id } = await withExpense();
      await expect(update.execute(ana, id, { isCardPayment: false })).resolves.toBeDefined();
    });

    it('keeps the flag when other fields change', async () => {
      const { update, id } = await withExpense();
      await update.execute(ana, id, { isCardPayment: true });
      expect((await update.execute(ana, id, { amountCents: 5 })).isCardPayment).toBe(true);
    });

    it('rejects flagging an expense that is on credit (400) and keeps it unchanged', async () => {
      const { update, create, get } = await withExpense();
      const { id } = await create.execute(ana, { ...valid, paymentMethod: 'CREDIT' });
      await expect(update.execute(ana, id, { isCardPayment: true })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect((await get.execute(ana, id)).isCardPayment).toBe(false);
    });

    it('rejects moving a card bill payment to credit (400) and keeps it unchanged', async () => {
      const { update, create, get } = await withExpense();
      const { id } = await create.execute(ana, { ...valid, isCardPayment: true });
      await expect(update.execute(ana, id, { paymentMethod: 'CREDIT' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect((await get.execute(ana, id)).paymentMethod).toBe('PIX');
    });

    it('accepts moving to credit together with clearing the flag, and the reverse', async () => {
      const { update, create } = await withExpense();
      const { id } = await create.execute(ana, { ...valid, isCardPayment: true });
      const credit = await update.execute(ana, id, { paymentMethod: 'CREDIT', isCardPayment: false });
      expect([credit.paymentMethod, credit.isCardPayment]).toEqual(['CREDIT', false]);
      const bill = await update.execute(ana, id, { paymentMethod: 'DEBIT', isCardPayment: true });
      expect([bill.paymentMethod, bill.isCardPayment]).toEqual(['DEBIT', true]);
    });

    it('rejects flagging together with credit in the same request', async () => {
      const { update, id } = await withExpense();
      await expect(
        update.execute(ana, id, { paymentMethod: 'CREDIT', isCardPayment: true }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it.each([null, 'true', 1, 0])('rejects the non boolean value %p', async (v) => {
      const { update, id } = await withExpense();
      await expect(
        update.execute(ana, id, { isCardPayment: v as unknown as boolean }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it('needs at least one field', async () => {
    const { update, id } = await withExpense();
    await expect(update.execute(ana, id, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('applies the creation validations to every field', async () => {
    const { update, id } = await withExpense();
    for (const input of [
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 1.5 },
      { amountCents: MAX_EXPENSE_CENTS + 1 },
      { amountCents: null as unknown as number },
      { spentAt: '2026-02-30' },
      { spentAt: '2026-11-10' },
      { description: 'a'.repeat(501) },
      { description: 'a\u0000' },
      { paidAlone: null as unknown as boolean },
    ]) {
      await expect(update.execute(ana, id, input)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('rejects a category that is not visible with NotFoundError', async () => {
    const { update, id } = await withExpense();
    await expect(update.execute(ana, id, { categoryId: 'bob-cat' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('cannot change the receipt or the owner (extra keys are ignored by the use case)', async () => {
    const { update, get, id } = await withExpense();
    await update.execute(ana, id, {
      amountCents: 5,
      receiptId: 'r-ana-2',
      userId: 'bob',
    } as never);
    const expense = await get.execute(ana, id);
    expect(expense.receiptId).toBe('r-ana');
    expect(expense.userId).toBe('ana');
  });

  it('deletes only the expense and frees the receipt for a new one', async () => {
    const { remove, create, get, id } = await withExpense();
    await remove.execute(ana, id);
    await expect(get.execute(ana, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(create.execute(ana, { ...valid, receiptId: 'r-ana' })).resolves.toHaveProperty(
      'id',
    );
  });
});

describe('ListExpenses', () => {
  async function seeded() {
    const s = await setup();
    const add = (spentAt: string, categoryId = 'g-food', user = ana) =>
      s.create.execute(user, { ...valid, categoryId, spentAt });
    const a = await add('2026-11-01');
    const b = await add('2026-11-05');
    const c = await add('2026-11-05');
    const d = await add('2026-10-20', 'ana-cat');
    await s.create.execute(bob, { ...valid, categoryId: 'g-food', spentAt: '2026-11-05' });
    return { ...s, a: a.id, b: b.id, c: c.id, d: d.id };
  }

  it('returns only the actor expenses, newest first, ties by id descending', async () => {
    const { list, a, b, c, d } = await seeded();
    const page = await list.execute(ana, {});
    expect(page.items.map((e) => e.id)).toEqual([c, b, a, d]);
    expect(page.total).toBe(4);
    expect(page.limit).toBe(100);
    expect(page.offset).toBe(0);
  });

  it('does not show the expenses of others to the admin', async () => {
    const { list } = await seeded();
    expect((await list.execute(admin, {})).items).toEqual([]);
  });

  it('filters by inclusive from/to and by category', async () => {
    const { list, a, b, c } = await seeded();
    expect(
      (await list.execute(ana, { from: '2026-11-01', to: '2026-11-05' })).items.map((e) => e.id),
    ).toEqual([c, b, a]);
    expect(
      (await list.execute(ana, { from: '2026-11-05', to: '2026-11-05' })).items.map((e) => e.id),
    ).toEqual([c, b]);
    expect((await list.execute(ana, { from: '2026-11-02' })).total).toBe(2);
    expect((await list.execute(ana, { to: '2026-10-31' })).total).toBe(1);
    expect((await list.execute(ana, { categoryId: 'ana-cat' })).total).toBe(1);
  });

  it('filters by payment method', async () => {
    const { list, create } = await seeded();
    const { id } = await create.execute(ana, { ...valid, paymentMethod: 'DEBIT' });
    const page = await list.execute(ana, { paymentMethod: 'DEBIT' });
    expect(page.items.map((e) => e.id)).toEqual([id]);
    expect(page.total).toBe(1);
    expect((await list.execute(ana, { paymentMethod: 'PIX' })).total).toBe(4);
    expect((await list.execute(ana, { paymentMethod: 'CREDIT' })).total).toBe(0);
  });

  it('filters card bill payments in and out', async () => {
    const { list, create } = await seeded();
    const { id } = await create.execute(ana, { ...valid, isCardPayment: true });
    const only = await list.execute(ana, { isCardPayment: true });
    expect(only.items.map((e) => e.id)).toEqual([id]);
    expect(only.total).toBe(1);
    expect((await list.execute(ana, { isCardPayment: false })).total).toBe(4);
    expect((await list.execute(ana, {})).total).toBe(5);
    expect((await list.execute(bob, { isCardPayment: true })).total).toBe(0);
  });

  it.each(['true', 'false', 1, null, []])('rejects the non boolean isCardPayment filter %p', async (v) => {
    const { list } = await seeded();
    await expect(
      list.execute(ana, { isCardPayment: v as unknown as boolean }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid payment method filter', async () => {
    const { list } = await seeded();
    await expect(
      list.execute(ana, { paymentMethod: 'CHEQUE' as unknown as 'PIX' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a category of someone else only yields an empty list', async () => {
    const { list } = await seeded();
    expect(await list.execute(ana, { categoryId: 'bob-cat' })).toMatchObject({ items: [], total: 0 });
  });

  it('rejects invalid dates and from after to', async () => {
    const { list } = await seeded();
    await expect(list.execute(ana, { from: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(list.execute(ana, { to: '26-1-1' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      list.execute(ana, { from: '2026-11-06', to: '2026-11-05' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('pages with limit and offset and reports the full total', async () => {
    const { list, b, a } = await seeded();
    const page = await list.execute(ana, { limit: 2, offset: 1 });
    expect(page.items.map((e) => e.id)).toEqual([b, a]);
    expect(page.total).toBe(4);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect((await list.execute(ana, { offset: 50 })).items).toEqual([]);
  });

  it('bounds limit to 1..200 and offset to 0..100000', async () => {
    const { list } = await seeded();
    expect(MAX_EXPENSE_PAGE).toBe(200);
    expect(MAX_EXPENSE_OFFSET).toBe(100_000);
    await list.execute(ana, { limit: 200 });
    await list.execute(ana, { offset: 100_000 });
    for (const input of [
      { limit: 0 },
      { limit: 201 },
      { limit: -1 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 100_001 },
      { offset: 0.5 },
      { limit: NaN },
    ]) {
      await expect(list.execute(ana, input)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
