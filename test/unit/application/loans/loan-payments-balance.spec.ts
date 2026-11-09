import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { DeleteLoan } from '../../../../src/application/use-cases/loans/delete-loan';
import { GetLoan } from '../../../../src/application/use-cases/loans/get-loan';
import { ListLoans } from '../../../../src/application/use-cases/loans/list-loans';
import { RegisterLoanPayment } from '../../../../src/application/use-cases/loans/register-loan-payment';
import { UpdateLoan } from '../../../../src/application/use-cases/loans/update-loan';
import { ConflictError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

// "Today" is 2026-11-08 (the FixedClock default).
async function setup() {
  const w = await loansWorld();
  const create = new CreateLoan(w.loans, w.expenses, w.ids);
  const pay = new RegisterLoanPayment(w.loans, w.payments, w.receipts, w.expenses, w.ids, w.clock);
  const lend = async (who: typeof ana, dueDate: string, amountCents = 10_000) =>
    (await create.execute(who, { borrowerName: 'Carlos', dueDate, amountCents })).id;
  const cash = (who: typeof ana, loanId: string, amountCents: number) =>
    pay.execute(who, { loanId, amountCents, method: 'CASH', paidAt: '2026-11-08' });
  return {
    ...w,
    lend,
    cash,
    pay,
    get: new GetLoan(w.loans, w.payments, w.clock),
    list: new ListLoans(w.loans, w.payments, w.clock),
    update: new UpdateLoan(w.loans, w.payments, w.clock),
    remove: new DeleteLoan(w.loans, w.payments),
  };
}

describe('loan balance from the real payments', () => {
  it('GetLoan reports paid, remaining and OPEN after a partial payment', async () => {
    const { lend, cash, get } = await setup();
    const id = await lend(ana, '2026-12-10');
    await cash(ana, id, 2_500);
    await cash(ana, id, 1_500);
    const { balance } = await get.execute(ana, id);
    expect([balance.paid.cents, balance.remaining.cents, balance.status]).toEqual([4_000, 6_000, 'OPEN']);
  });

  it('an exact payment settles the loan: PAID with zero remaining', async () => {
    const { lend, cash, get } = await setup();
    const id = await lend(ana, '2026-12-10');
    await cash(ana, id, 10_000);
    const { balance } = await get.execute(ana, id);
    expect([balance.paid.cents, balance.remaining.cents, balance.status]).toEqual([10_000, 0, 'PAID']);
  });

  it('a late loan that gets settled is PAID, and stays OVERDUE while it has a balance', async () => {
    const { lend, cash, get } = await setup();
    const id = await lend(ana, '2026-10-01');
    await cash(ana, id, 9_999);
    expect((await get.execute(ana, id)).balance.status).toBe('OVERDUE');
    await cash(ana, id, 1);
    expect((await get.execute(ana, id)).balance.status).toBe('PAID');
  });

  it('payments of one loan do not touch another loan, nor another user', async () => {
    const { lend, cash, get } = await setup();
    const a = await lend(ana, '2026-12-10');
    const b = await lend(ana, '2026-12-10');
    const c = await lend(bob, '2026-12-10');
    await cash(ana, a, 700);
    expect((await get.execute(ana, b)).balance.paid.cents).toBe(0);
    expect((await get.execute(bob, c)).balance.paid.cents).toBe(0);
  });

  it('ListLoans computes every balance from ONE aggregated query and filters by status', async () => {
    const { lend, cash, list, payments } = await setup();
    const open = await lend(ana, '2026-12-10');
    const late = await lend(ana, '2026-10-01');
    const done = await lend(ana, '2026-10-02');
    await lend(ana, '2026-12-11');
    await cash(ana, open, 1_000);
    await cash(ana, done, 10_000);
    const spy = jest.spyOn(payments, 'sumPaidByLoans');
    const all = await list.execute(ana, {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(all.items.map((i) => [i.loan.id, i.balance.paid.cents])).toEqual([
      [late, 0],
      [done, 10_000],
      [open, 1_000],
      [expect.any(String), 0],
    ]);
    const ids = async (status: 'OPEN' | 'PAID' | 'OVERDUE') =>
      (await list.execute(ana, { status })).items.map((i) => i.loan.id);
    expect(await ids('PAID')).toEqual([done]);
    expect(await ids('OVERDUE')).toEqual([late]);
    expect(await ids('OPEN')).toHaveLength(2);
  });

  it('ListLoans never counts payments of other users, and the admin sees nothing', async () => {
    const { lend, cash, list } = await setup();
    const a = await lend(ana, '2026-12-10');
    const b = await lend(bob, '2026-12-10');
    await cash(ana, a, 3_000);
    await cash(bob, b, 8_000);
    expect((await list.execute(ana, {})).items.map((i) => i.balance.paid.cents)).toEqual([3_000]);
    expect((await list.execute(bob, {})).items.map((i) => i.balance.paid.cents)).toEqual([8_000]);
    expect((await list.execute(admin, {})).items).toEqual([]);
  });

  it('UpdateLoan returns the real balance', async () => {
    const { lend, cash, update } = await setup();
    const id = await lend(ana, '2026-12-10');
    await cash(ana, id, 4_000);
    const { balance } = await update.execute(ana, id, { dueDate: '2026-11-01' });
    expect([balance.paid.cents, balance.remaining.cents, balance.status]).toEqual([4_000, 6_000, 'OVERDUE']);
  });
});

describe('DeleteLoan with payments', () => {
  it('refuses with ConflictError and keeps the loan and its payments', async () => {
    const { lend, cash, remove, loans, payments } = await setup();
    const id = await lend(ana, '2026-12-10');
    await cash(ana, id, 100);
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(ConflictError);
    expect(await loans.findById('ana', id)).not.toBeNull();
    expect(await payments.listByLoan('ana', id)).toHaveLength(1);
  });

  it('still deletes a loan that has no payments', async () => {
    const { lend, remove, loans } = await setup();
    const id = await lend(ana, '2026-12-10');
    await remove.execute(ana, id);
    expect(await loans.findById('ana', id)).toBeNull();
  });
});
