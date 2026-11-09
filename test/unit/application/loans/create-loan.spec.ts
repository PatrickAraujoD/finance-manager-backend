import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { MAX_EXPENSE_CENTS } from '../../../../src/domain/entities/expense';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

async function setup() {
  const world = await loansWorld();
  return { ...world, create: new CreateLoan(world.loans, world.expenses, world.ids) };
}

describe('CreateLoan', () => {
  it('creates a loan of money lent directly and returns only the id', async () => {
    const { create, loans } = await setup();
    const result = await create.execute(ana, {
      borrowerName: 'Carlos',
      dueDate: '2026-12-10',
      amountCents: 15_000,
    });
    expect(result).toEqual({ id: 'id-1' });
    const loan = await loans.findById('ana', 'id-1');
    expect(loan?.userId).toBe('ana');
    expect(loan?.borrowerName).toBe('Carlos');
    expect(loan?.amount.cents).toBe(15_000);
    expect(loan?.dueDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(loan?.expenseId).toBeNull();
  });

  it('creates a loan from an expense of the actor, taking the amount from it', async () => {
    const { create, loans } = await setup();
    const { id } = await create.execute(ana, {
      borrowerName: 'Carlos',
      dueDate: '2026-12-10',
      expenseId: 'e-ana',
    });
    const loan = await loans.findById('ana', id);
    expect(loan?.amount.cents).toBe(4_200);
    expect(loan?.expenseId).toBe('e-ana');
  });

  it('trims the borrower name', async () => {
    const { create, loans } = await setup();
    const { id } = await create.execute(ana, {
      borrowerName: '  Carlos  ',
      dueDate: '2026-12-10',
      amountCents: 100,
    });
    expect((await loans.findById('ana', id))?.borrowerName).toBe('Carlos');
  });

  it('accepts a due date in the past, down to 2000-01-01', async () => {
    const { create } = await setup();
    const input = { borrowerName: 'Carlos', amountCents: 100 };
    await expect(create.execute(ana, { ...input, dueDate: '2020-05-01' })).resolves.toBeDefined();
    await expect(create.execute(ana, { ...input, dueDate: '2000-01-01' })).resolves.toBeDefined();
  });

  it.each(['1999-12-31', '1950-01-01'])('rejects the due date %s as too old', async (dueDate) => {
    const { create, loans } = await setup();
    await expect(
      create.execute(ana, { borrowerName: 'Carlos', dueDate, amountCents: 100 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(loans.all()).toHaveLength(0);
  });

  it.each(['2026-02-30', '2026-12-10T00:00:00Z', '10/12/2026', '', 'x'])(
    'rejects the malformed due date %j',
    async (dueDate) => {
      const { create } = await setup();
      await expect(
        create.execute(ana, { borrowerName: 'Carlos', dueDate, amountCents: 100 }),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it('requires a due date', async () => {
    const { create } = await setup();
    await expect(
      create.execute(ana, { borrowerName: 'Carlos', amountCents: 100 } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires exactly one of expenseId and amountCents', async () => {
    const { create, loans } = await setup();
    const base = { borrowerName: 'Carlos', dueDate: '2026-12-10' };
    await expect(create.execute(ana, base)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create.execute(ana, { ...base, expenseId: 'e-ana', amountCents: 4_200 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(loans.all()).toHaveLength(0);
  });

  it.each([0, -5, 1.5, MAX_EXPENSE_CENTS + 1, Number.NaN, '100'])(
    'rejects the amount %j',
    async (amountCents) => {
      const { create } = await setup();
      await expect(
        create.execute(ana, {
          borrowerName: 'Carlos',
          dueDate: '2026-12-10',
          amountCents: amountCents as number,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it('accepts the maximum amount', async () => {
    const { create } = await setup();
    await expect(
      create.execute(ana, {
        borrowerName: 'Carlos',
        dueDate: '2026-12-10',
        amountCents: MAX_EXPENSE_CENTS,
      }),
    ).resolves.toBeDefined();
  });

  it.each(['', '   ', 'a'.repeat(101), 'Car\u0000los', 'Car‮los', 42 as never])(
    'rejects the borrower name %j',
    async (borrowerName) => {
      const { create, loans } = await setup();
      await expect(
        create.execute(ana, { borrowerName, dueDate: '2026-12-10', amountCents: 100 }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(loans.all()).toHaveLength(0);
    },
  );

  it.each(['', '   ', 42 as never])('rejects the expenseId %j as invalid', async (expenseId) => {
    const { create } = await setup();
    await expect(
      create.execute(ana, { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('answers NotFoundError for a missing expense and for one of someone else, alike', async () => {
    const { create, loans } = await setup();
    const input = { borrowerName: 'Carlos', dueDate: '2026-12-10' };
    const missing = await create.execute(ana, { ...input, expenseId: 'nope' }).catch((e) => e);
    const foreign = await create.execute(ana, { ...input, expenseId: 'e-bob' }).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(foreign.message).toBe(missing.message);
    expect(loans.all()).toHaveLength(0);
  });

  it('does not let an admin lend against someone else expense', async () => {
    const { create } = await setup();
    await expect(
      create.execute(admin, { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId: 'e-ana' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets an expense back only one loan (ConflictError), even across two attempts', async () => {
    const { create, loans } = await setup();
    const input = { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId: 'e-ana' };
    await create.execute(ana, input);
    await expect(create.execute(ana, { ...input, borrowerName: 'Maria' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(loans.all()).toHaveLength(1);
  });

  it('lets two people each lend money directly with the same name and amount', async () => {
    const { create, loans } = await setup();
    const input = { borrowerName: 'Carlos', dueDate: '2026-12-10', amountCents: 100 };
    await create.execute(ana, input);
    await create.execute(ana, input);
    await create.execute(bob, input);
    expect(loans.all()).toHaveLength(3);
  });

  it('takes the owner from the actor only', async () => {
    const { create, loans } = await setup();
    const { id } = await create.execute(bob, {
      borrowerName: 'Carlos',
      dueDate: '2026-12-10',
      amountCents: 100,
      userId: 'ana',
    } as never);
    expect((await loans.findById('bob', id))?.userId).toBe('bob');
    expect(await loans.findById('ana', id)).toBeNull();
  });
});
