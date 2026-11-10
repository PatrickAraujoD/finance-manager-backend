import {
  CreateCategory,
  MAX_OWNED_CATEGORIES,
} from '../../../../src/application/use-cases/categories/create-category';
import { DeleteCategory } from '../../../../src/application/use-cases/categories/delete-category';
import { ListCategories } from '../../../../src/application/use-cases/categories/list-categories';
import { UpdateCategory } from '../../../../src/application/use-cases/categories/update-category';
import { Expense } from '../../../../src/domain/entities/expense';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../src/domain/errors';
import { Money } from '../../../../src/domain/money';
import { Role } from '../../../../src/domain/role';
import { FakeCategoryRepository } from '../../../support/fakes/fake-category-repository';
import { FakeExpenseRepository } from '../../../support/fakes/fake-expense-repository';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const admin = { id: 'admin', role: 'A' as Role };
const ana = { id: 'ana', role: 'N' as Role };
const bob = { id: 'bob', role: 'N' as Role };

function setup() {
  const expenses = new FakeExpenseRepository();
  const categories = new FakeCategoryRepository(expenses);
  const ids = new SequentialIdGenerator();
  return {
    expenses,
    categories,
    create: new CreateCategory(categories, ids),
    list: new ListCategories(categories),
    update: new UpdateCategory(categories),
    remove: new DeleteCategory(categories),
  };
}

describe('CreateCategory', () => {
  it('creates a personal category owned by the actor', async () => {
    const { create, categories } = setup();
    const { id } = await create.execute(ana, { name: '  Mercado ' });
    const stored = await categories.findById(id);
    expect(stored?.ownerId).toBe('ana');
    expect(stored?.name).toBe('Mercado');
  });

  it('lets an admin create a global category', async () => {
    const { create, categories } = setup();
    const { id } = await create.execute(admin, { name: 'Food', global: true });
    expect((await categories.findById(id))?.isGlobal()).toBe(true);
  });

  it('an admin without the global flag creates a personal category', async () => {
    const { create, categories } = setup();
    const { id } = await create.execute(admin, { name: 'Mine', global: false });
    expect((await categories.findById(id))?.ownerId).toBe('admin');
  });

  it('refuses a normal user creating a global category', async () => {
    const { create, categories } = setup();
    await expect(create.execute(ana, { name: 'Food', global: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await categories.listVisibleTo('ana')).toEqual([]);
  });

  it('rejects a duplicate name in the same scope, ignoring case and spaces', async () => {
    const { create } = setup();
    await create.execute(ana, { name: 'Mercado' });
    await expect(create.execute(ana, { name: ' MERCADO ' })).rejects.toBeInstanceOf(ConflictError);
    await create.execute(admin, { name: 'Food', global: true });
    await expect(create.execute(admin, { name: 'food', global: true })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('treats names that differ only by inner whitespace as duplicates and stores the normalized one', async () => {
    const { create, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Casa   e  lazer' });
    expect((await categories.findById(id))?.name).toBe('Casa e lazer');
    await expect(create.execute(ana, { name: 'casa e lazer' })).rejects.toBeInstanceOf(ConflictError);
  });

  describe('per-user ceiling', () => {
    it('is 100 personal categories', () => {
      expect(MAX_OWNED_CATEGORIES).toBe(100);
    });

    it('rejects the 101st personal category with a clear ConflictError', async () => {
      const { create, categories } = setup();
      for (let i = 0; i < MAX_OWNED_CATEGORIES; i++) await create.execute(ana, { name: `c${i}` });
      await expect(create.execute(ana, { name: 'one too many' })).rejects.toThrow(
        /at most 100 personal categories/,
      );
      await expect(create.execute(ana, { name: 'one too many' })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(await categories.countOwnedBy('ana')).toBe(MAX_OWNED_CATEGORIES);
    });

    it('does not count global categories or other users toward the ceiling', async () => {
      const { create } = setup();
      for (let i = 0; i < MAX_OWNED_CATEGORIES; i++) {
        await create.execute(admin, { name: `g${i}`, global: true });
        await create.execute(bob, { name: `b${i}` });
      }
      await expect(create.execute(ana, { name: 'mine' })).resolves.toBeDefined();
      await expect(create.execute(admin, { name: 'another', global: true })).resolves.toBeDefined();
    });

    it('frees a slot when a category is deleted', async () => {
      const { create, remove } = setup();
      let last = '';
      for (let i = 0; i < MAX_OWNED_CATEGORIES; i++) last = (await create.execute(ana, { name: `c${i}` })).id;
      await remove.execute(ana, last);
      await expect(create.execute(ana, { name: 'again' })).resolves.toBeDefined();
    });
  });

  it('allows the same name for different owners and for a personal vs a global one', async () => {
    const { create } = setup();
    await create.execute(ana, { name: 'Mercado' });
    await expect(create.execute(bob, { name: 'Mercado' })).resolves.toBeDefined();
    await create.execute(admin, { name: 'Food', global: true });
    await expect(create.execute(ana, { name: 'Food' })).resolves.toBeDefined();
  });

  it('rejects blank, over-long and malformed names', async () => {
    const { create } = setup();
    for (const name of ['   ', 'x'.repeat(61), 'bad\u0000name']) {
      await expect(create.execute(ana, { name })).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe('ListCategories', () => {
  it('returns global plus own categories, never those of others', async () => {
    const { create, list } = setup();
    await create.execute(admin, { name: 'Food', global: true });
    await create.execute(ana, { name: 'Ana only' });
    await create.execute(bob, { name: 'Bob only' });
    const names = (await list.execute(ana)).map((c) => c.name).sort();
    expect(names).toEqual(['Ana only', 'Food']);
  });
});

describe('UpdateCategory', () => {
  it('lets the owner rename their own category', async () => {
    const { create, update, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    const updated = await update.execute(ana, id, { name: ' Supermercado ' });
    expect(updated.name).toBe('Supermercado');
    expect((await categories.findById(id))?.name).toBe('Supermercado');
  });

  it('answers NotFoundError for another user personal category (no existence leak)', async () => {
    const { create, update, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    await expect(update.execute(bob, id, { name: 'Hacked' })).rejects.toBeInstanceOf(NotFoundError);
    // Even an admin has no access to someone else personal category.
    await expect(update.execute(admin, id, { name: 'Hacked' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await categories.findById(id))?.name).toBe('Mercado');
  });

  it('answers the same NotFoundError for an unknown id', async () => {
    const { update } = setup();
    await expect(update.execute(ana, 'ghost', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('only admins can edit a global category', async () => {
    const { create, update } = setup();
    const { id } = await create.execute(admin, { name: 'Food', global: true });
    await expect(update.execute(ana, id, { name: 'Hacked' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const updated = await update.execute(admin, id, { name: 'Alimentacao' });
    expect(updated.name).toBe('Alimentacao');
    expect(updated.isGlobal()).toBe(true);
  });

  it('rejects renaming to a name already used in the scope, but allows changing only the case', async () => {
    const { create, update } = setup();
    await create.execute(ana, { name: 'Mercado' });
    const { id } = await create.execute(ana, { name: 'Lazer' });
    await expect(update.execute(ana, id, { name: 'mercado' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(update.execute(ana, id, { name: 'LAZER' })).resolves.toBeDefined();
  });

  it('rejects an invalid name', async () => {
    const { create, update } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    await expect(update.execute(ana, id, { name: ' ' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('DeleteCategory', () => {
  it('lets the owner delete their own unused category', async () => {
    const { create, remove, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    await remove.execute(ana, id);
    expect(await categories.findById(id)).toBeNull();
  });

  it('answers NotFoundError for another user category and keeps it', async () => {
    const { create, remove, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    await expect(remove.execute(bob, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(remove.execute(admin, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await categories.findById(id)).not.toBeNull();
  });

  it('only admins can delete a global category', async () => {
    const { create, remove, categories } = setup();
    const { id } = await create.execute(admin, { name: 'Food', global: true });
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(ForbiddenError);
    await remove.execute(admin, id);
    expect(await categories.findById(id)).toBeNull();
  });

  it('refuses to delete a category used by expenses and keeps the expenses', async () => {
    const { create, remove, expenses, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    await expenses.save(
      Expense.create({
        id: 'e1',
        userId: 'ana',
        categoryId: id,
        receiptId: null,
        amount: Money.fromCents(1000),
        paidAlone: true,
        paymentMethod: 'PIX',
        isCardPayment: false,
        spentAt: new Date('2026-11-01T00:00:00Z'),
      }),
    );
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(ConflictError);
    expect(await categories.findById(id)).not.toBeNull();
    expect(expenses.all()).toHaveLength(1);
  });

  it('keeps the category when the repository rejects the delete (restrict backstop)', async () => {
    const { create, remove, categories } = setup();
    const { id } = await create.execute(ana, { name: 'Mercado' });
    jest.spyOn(categories, 'isInUse').mockResolvedValue(false);
    jest.spyOn(categories, 'delete').mockRejectedValue(new ConflictError('in use'));
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(ConflictError);
  });
});
