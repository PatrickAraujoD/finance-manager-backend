import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { ListLoanPayments } from '../../../../src/application/use-cases/loans/list-loan-payments';
import { RegisterLoanPayment } from '../../../../src/application/use-cases/loans/register-loan-payment';
import { Expense, MAX_EXPENSE_CENTS } from '../../../../src/domain/entities/expense';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { Money } from '../../../../src/domain/money';
import { admin, ana, bob, loansWorld } from './support';

// "Today" is 2026-11-08 (the FixedClock default). Ana's loan is 10000 cents.
async function setup() {
  const world = await loansWorld();
  const create = new CreateLoan(world.loans, world.expenses, world.ids);
  const { id: loanId } = await create.execute(ana, {
    borrowerName: 'Carlos',
    dueDate: '2026-12-10',
    amountCents: 10_000,
  });
  const pay = new RegisterLoanPayment(
    world.loans,
    world.payments,
    world.receipts,
    world.expenses,
    world.ids,
    world.clock,
  );
  return { ...world, loanId, pay, list: new ListLoanPayments(world.loans, world.payments) };
}

const cash = (loanId: string, amountCents = 1000, paidAt = '2026-11-08') => ({
  loanId,
  amountCents,
  method: 'CASH',
  paidAt,
});
const pix = (loanId: string, receiptId: string, amountCents = 1000, paidAt = '2026-11-08') => ({
  loanId,
  amountCents,
  method: 'PIX',
  paidAt,
  receiptId,
});

describe('RegisterLoanPayment', () => {
  it('registers a cash payment of the actor', async () => {
    const { pay, list, loanId } = await setup();
    const { id } = await pay.execute(ana, cash(loanId, 2500, '2026-11-05') as never);
    const [stored] = await list.execute(ana, loanId);
    expect(stored.id).toBe(id);
    expect(stored.userId).toBe('ana');
    expect(stored.loanId).toBe(loanId);
    expect(stored.amount.cents).toBe(2500);
    expect(stored.method).toBe('CASH');
    expect(stored.receiptId).toBeNull();
    expect(stored.paidAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('registers a pix payment backed by a receipt of the actor', async () => {
    const { pay, list, loanId } = await setup();
    await pay.execute(ana, pix(loanId, 'r-ana') as never);
    const [stored] = await list.execute(ana, loanId);
    expect(stored.method).toBe('PIX');
    expect(stored.receiptId).toBe('r-ana');
  });

  it('accepts the payment that settles the loan exactly', async () => {
    const { pay, payments, loanId } = await setup();
    await pay.execute(ana, cash(loanId, 4000) as never);
    await pay.execute(ana, cash(loanId, 6000) as never);
    expect((await payments.sumPaidByLoans('ana', [loanId])).get(loanId)).toBe(10_000);
  });

  it('refuses a payment above the remaining balance with a clear 400 and stores nothing', async () => {
    const { pay, payments, loanId } = await setup();
    await pay.execute(ana, cash(loanId, 9000) as never);
    const error = await pay.execute(ana, cash(loanId, 1001) as never).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toMatch(/remaining balance/);
    expect(await payments.listByLoan('ana', loanId)).toHaveLength(1);
  });

  it('refuses a payment on a loan that is already settled', async () => {
    const { pay, loanId } = await setup();
    await pay.execute(ana, cash(loanId, 10_000) as never);
    await expect(pay.execute(ana, cash(loanId, 1) as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts today, tomorrow (time zone slack) and a past date, but not later', async () => {
    const { pay, loanId } = await setup();
    for (const paidAt of ['2026-11-08', '2026-11-09', '2026-10-01', '2000-01-01']) {
      await expect(pay.execute(ana, cash(loanId, 10, paidAt) as never)).resolves.toBeDefined();
    }
    await expect(pay.execute(ana, cash(loanId, 10, '2026-11-10') as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it.each([
    ['a zero amount', { amountCents: 0 }],
    ['a negative amount', { amountCents: -5 }],
    ['a fractional amount', { amountCents: 10.5 }],
    ['a string amount', { amountCents: '100' }],
    ['an amount above the ceiling', { amountCents: MAX_EXPENSE_CENTS + 1 }],
    ['a missing method', { method: undefined }],
    ['a lowercase method', { method: 'cash' }],
    ['a method that is not for loans', { method: 'CREDIT' }],
    ['a numeric method', { method: 1 }],
    ['an invalid date', { paidAt: '2026-02-30' }],
    ['a date with time', { paidAt: '2026-11-08T10:00:00Z' }],
    ['a date before 2000', { paidAt: '1999-12-31' }],
    ['a missing date', { paidAt: undefined }],
    ['cash with a receipt', { receiptId: 'r-ana' }],
    ['pix without a receipt', { method: 'PIX' }],
    ['pix with a blank receipt', { method: 'PIX', receiptId: '  ' }],
    ['pix with a non text receipt', { method: 'PIX', receiptId: 5 }],
  ])('rejects %s as a ValidationError, before touching anything', async (_label, over) => {
    const { pay, payments, loanId } = await setup();
    await expect(pay.execute(ana, { ...cash(loanId), ...over } as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await payments.listByLoan('ana', loanId)).toEqual([]);
  });

  it('checks the input before the loan: a bad body on a foreign loan is still a 400', async () => {
    const { pay, loanId } = await setup();
    await expect(pay.execute(bob, cash(loanId, 0) as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it('answers NotFoundError alike for a missing loan, a loan of someone else and the admin', async () => {
    const { pay, payments, loanId } = await setup();
    const missing = await pay.execute(ana, cash('nope') as never).catch((e) => e);
    const foreign = await pay.execute(bob, cash(loanId) as never).catch((e) => e);
    const asAdmin = await pay.execute(admin, cash(loanId) as never).catch((e) => e);
    for (const error of [missing, foreign, asAdmin]) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(missing.message);
    }
    expect(await payments.listByLoan('ana', loanId)).toEqual([]);
  });

  it('answers NotFoundError alike for a missing receipt and one of someone else', async () => {
    const { pay, payments, loanId } = await setup();
    const missing = await pay.execute(ana, pix(loanId, 'r-nope') as never).catch((e) => e);
    const foreign = await pay.execute(ana, pix(loanId, 'r-bob') as never).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(foreign.message).toBe(missing.message);
    expect(await payments.listByLoan('ana', loanId)).toEqual([]);
  });

  it('answers 404 about the loan, not the receipt, when both are wrong', async () => {
    const { pay, loanId } = await setup();
    const error = await pay.execute(bob, pix(loanId, 'r-ana') as never).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe('Loan not found');
  });

  it('refuses a receipt that already backs an expense (ConflictError)', async () => {
    const { pay, expenses, payments, loanId } = await setup();
    await expenses.save(
      Expense.create({
        id: 'e-with-receipt',
        userId: 'ana',
        categoryId: 'c1',
        receiptId: 'r-ana',
        amount: Money.fromCents(100),
        paidAlone: true,
        paymentMethod: 'PIX',
        spentAt: new Date('2026-11-01T00:00:00Z'),
      }),
    );
    await expect(pay.execute(ana, pix(loanId, 'r-ana') as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await payments.listByLoan('ana', loanId)).toEqual([]);
  });

  it('refuses a receipt that already backs another payment (ConflictError)', async () => {
    const { pay, payments, loanId } = await setup();
    await pay.execute(ana, pix(loanId, 'r-ana') as never);
    await expect(pay.execute(ana, pix(loanId, 'r-ana', 500) as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await payments.listByLoan('ana', loanId)).toHaveLength(1);
    // Another receipt is fine.
    await expect(pay.execute(ana, pix(loanId, 'r-ana-2', 500) as never)).resolves.toBeDefined();
  });
});

describe('ListLoanPayments', () => {
  it('lists the payments of a loan of the actor by date then id', async () => {
    const { pay, list, loanId } = await setup();
    await pay.execute(ana, cash(loanId, 100, '2026-11-03') as never);
    await pay.execute(ana, cash(loanId, 200, '2026-11-01') as never);
    await pay.execute(ana, pix(loanId, 'r-ana', 300, '2026-11-02') as never);
    expect((await list.execute(ana, loanId)).map((p) => p.amount.cents)).toEqual([200, 300, 100]);
  });

  it('is empty for a loan without payments', async () => {
    const { list, loanId } = await setup();
    expect(await list.execute(ana, loanId)).toEqual([]);
  });

  it('answers NotFoundError alike for a missing loan, a loan of someone else and the admin', async () => {
    const { pay, list, loanId } = await setup();
    await pay.execute(ana, cash(loanId) as never);
    const missing = await list.execute(ana, 'nope').catch((e) => e);
    const foreign = await list.execute(bob, loanId).catch((e) => e);
    const asAdmin = await list.execute(admin, loanId).catch((e) => e);
    for (const error of [missing, foreign, asAdmin]) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(missing.message);
    }
  });
});
