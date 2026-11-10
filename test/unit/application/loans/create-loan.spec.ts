import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { MAX_EXPENSE_CENTS } from '../../../../src/domain/entities/expense';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

async function setup() {
  const world = await loansWorld();
  return { ...world, create: new CreateLoan(world.loans, world.expenses, world.ids, world.clock) };
}

describe('CreateLoan', () => {
  it('creates a loan of money lent directly and returns only the id', async () => {
    const { create, loans } = await setup();
    const result = await create.execute(ana, {
      borrowerName: 'Carlos',
      dueDate: '2026-12-10',
      amountCents: 15_000,
      paymentMethod: 'PIX',
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
      paymentMethod: 'PIX',
    });
    expect((await loans.findById('ana', id))?.borrowerName).toBe('Carlos');
  });

  it('accepts a due date in the past, down to 2000-01-01', async () => {
    const { create } = await setup();
    const input = { borrowerName: 'Carlos', amountCents: 100, paymentMethod: 'PIX' as const };
    await expect(create.execute(ana, { ...input, dueDate: '2020-05-01' })).resolves.toBeDefined();
    await expect(create.execute(ana, { ...input, dueDate: '2000-01-01' })).resolves.toBeDefined();
  });

  it.each(['1999-12-31', '1950-01-01'])('rejects the due date %s as too old', async (dueDate) => {
    const { create, loans } = await setup();
    await expect(
      create.execute(ana, {
          borrowerName: 'Carlos',
          dueDate,
          amountCents: 100,
          paymentMethod: 'PIX',
        }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(loans.all()).toHaveLength(0);
  });

  it.each(['2026-02-30', '2026-12-10T00:00:00Z', '10/12/2026', '', 'x'])(
    'rejects the malformed due date %j',
    async (dueDate) => {
      const { create } = await setup();
      await expect(
        create.execute(ana, {
          borrowerName: 'Carlos',
          dueDate,
          amountCents: 100,
          paymentMethod: 'PIX',
        }),
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
          paymentMethod: 'PIX',
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
        paymentMethod: 'PIX',
      }),
    ).resolves.toBeDefined();
  });

  it.each(['', '   ', 'a'.repeat(101), 'Car\u0000los', 'Car‮los', 42 as never])(
    'rejects the borrower name %j',
    async (borrowerName) => {
      const { create, loans } = await setup();
      await expect(
        create.execute(ana, {
          borrowerName,
          dueDate: '2026-12-10',
          amountCents: 100,
          paymentMethod: 'PIX',
        }),
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
    const input = {
      borrowerName: 'Carlos',
      dueDate: '2026-12-10',
      amountCents: 100,
      paymentMethod: 'PIX' as const,
    };
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
      paymentMethod: 'PIX',
      userId: 'ana',
    } as never);
    expect((await loans.findById('bob', id))?.userId).toBe('bob');
    expect(await loans.findById('ana', id)).toBeNull();
  });

  describe('payment method and lent date', () => {
    const direct = { borrowerName: 'Carlos', dueDate: '2026-12-10', amountCents: 15_000 };

    it.each(['CREDIT', 'DEBIT', 'PIX', 'CASH'] as const)(
      'records money lent directly with %s',
      async (paymentMethod) => {
        const { create, loans } = await setup();
        const { id } = await create.execute(ana, { ...direct, paymentMethod, lentAt: '2026-11-05' });
        const loan = await loans.findById('ana', id);
        expect(loan?.paymentMethod).toBe(paymentMethod);
        expect(loan?.lentAt?.toISOString()).toBe('2026-11-05T00:00:00.000Z');
      },
    );

    it('defaults the lent date to today by the Clock', async () => {
      const { create, loans } = await setup();
      const { id } = await create.execute(ana, { ...direct, paymentMethod: 'PIX' });
      expect((await loans.findById('ana', id))?.lentAt?.toISOString()).toBe(
        '2026-11-08T00:00:00.000Z',
      );
    });

    it('accepts a lent date up to tomorrow and in the past, down to 2000-01-01', async () => {
      const { create } = await setup();
      for (const lentAt of ['2026-11-09', '2000-01-01']) {
        await expect(
          create.execute(ana, { ...direct, paymentMethod: 'PIX', lentAt }),
        ).resolves.toBeDefined();
      }
    });

    it.each(['2026-11-10', '1999-12-31', '2026-02-30', '2026-11-05T00:00:00Z', '', 5 as never])(
      'rejects the lent date %j',
      async (lentAt) => {
        const { create, loans } = await setup();
        await expect(
          create.execute(ana, { ...direct, paymentMethod: 'PIX', lentAt }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(loans.all()).toHaveLength(0);
      },
    );

    it('requires a payment method for money lent directly', async () => {
      const { create, loans } = await setup();
      await expect(create.execute(ana, direct)).rejects.toBeInstanceOf(ValidationError);
      expect(loans.all()).toHaveLength(0);
    });

    it.each(['BOLETO', 'pix', '', null, 7])('rejects the payment method %j', async (method) => {
      const { create } = await setup();
      await expect(
        create.execute(ana, { ...direct, paymentMethod: method as never }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a payment method or a lent date together with an expenseId', async () => {
      const { create, loans } = await setup();
      const fromExpense = { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId: 'e-ana' };
      await expect(
        create.execute(ana, { ...fromExpense, paymentMethod: 'PIX' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        create.execute(ana, { ...fromExpense, lentAt: '2026-11-05' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(loans.all()).toHaveLength(0);
    });

    it('leaves both empty on a loan born from an expense', async () => {
      const { create, loans } = await setup();
      const { id } = await create.execute(ana, {
        borrowerName: 'Carlos',
        dueDate: '2026-12-10',
        expenseId: 'e-ana',
      });
      const loan = await loans.findById('ana', id);
      expect(loan?.paymentMethod).toBeNull();
      expect(loan?.lentAt).toBeNull();
    });

    it('refuses to back a loan with a credit card bill payment', async () => {
      const { create, loans } = await setup();
      await expect(
        create.execute(ana, { borrowerName: 'Carlos', dueDate: '2026-12-10', expenseId: 'e-bill' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(loans.all()).toHaveLength(0);
    });
  });
});
