import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { GetLoanSummary } from '../../../../src/application/use-cases/loans/get-loan-summary';
import { RegisterLoanPayment } from '../../../../src/application/use-cases/loans/register-loan-payment';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

// "Today" is 2026-11-08 (the FixedClock default).
async function setup() {
  const world = await loansWorld();
  const create = new CreateLoan(world.loans, world.expenses, world.ids, world.clock);
  const pay = new RegisterLoanPayment(
    world.loans,
    world.payments,
    world.receipts,
    world.expenses,
    world.ids,
    world.clock,
  );
  const lend = async (actor: typeof ana, borrowerName: string, dueDate: string, cents: number) =>
    (await create.execute(actor, { borrowerName, dueDate, amountCents: cents, paymentMethod: 'PIX' })).id;
  const cash = (actor: typeof ana, loanId: string, amountCents: number) =>
    pay.execute(actor, { loanId, amountCents, method: 'CASH', paidAt: '2026-11-08' });
  return {
    ...world,
    lend,
    cash,
    summary: new GetLoanSummary(world.loans, world.payments, world.clock),
  };
}

describe('GetLoanSummary', () => {
  it('answers an empty summary with zero totals when the actor has no loans', async () => {
    const { summary } = await setup();
    const result = await summary.execute(ana, {});
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totals.owedCents).toBe(0);
  });

  it('summarizes per person from the real payments and the clock', async () => {
    const { summary, lend, cash } = await setup();
    const open = await lend(ana, 'Carlos', '2026-12-10', 5_000);
    const late = await lend(ana, ' Carlos ', '2026-11-01', 3_000);
    await lend(ana, 'Maria', '2026-11-08', 700);
    await cash(ana, open, 1_000);
    await cash(ana, late, 500);

    const result = await summary.execute(ana, {});
    expect(result.items.map((i) => [i.borrowerName, i.owedCents, i.overdueCents])).toEqual([
      ['Carlos', 6_500, 2_500],
      ['Maria', 700, 0],
    ]);
    expect(result.items[0]).toMatchObject({
      loansCount: 2,
      totalLentCents: 8_000,
      paidCents: 1_500,
      upcomingCents: 4_000,
      overdueLoansCount: 1,
    });
    expect(result.totals).toEqual({
      totalLentCents: 8_700,
      paidCents: 1_500,
      owedCents: 7_200,
      upcomingCents: 4_700,
      overdueCents: 2_500,
    });
  });

  it('follows the clock: a loan due today is upcoming and overdue the day after', async () => {
    const { summary, lend, clock } = await setup();
    await lend(ana, 'Maria', '2026-11-08', 700);
    expect((await summary.execute(ana, {})).totals.overdueCents).toBe(0);
    clock.set(new Date('2026-11-09T00:00:00Z'));
    expect((await summary.execute(ana, {})).totals.overdueCents).toBe(700);
  });

  it('filters by borrower ignoring case and spaces at the ends, totals included', async () => {
    const { summary, lend } = await setup();
    await lend(ana, 'Carlos', '2026-12-10', 5_000);
    await lend(ana, 'Maria', '2026-12-10', 700);
    const result = await summary.execute(ana, { borrower: '  CARLOS ' });
    expect(result.items.map((i) => i.borrowerName)).toEqual(['Carlos']);
    expect(result.totals.totalLentCents).toBe(5_000);
  });

  it('refuses a blank or non text borrower', async () => {
    const { summary } = await setup();
    await expect(summary.execute(ana, { borrower: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(summary.execute(ana, { borrower: 7 as never })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('keeps users apart: Bob and an admin never see the loans of Ana', async () => {
    const { summary, lend, cash } = await setup();
    const id = await lend(ana, 'Carlos', '2026-11-01', 5_000);
    await cash(ana, id, 1_000);
    await lend(bob, 'Dora', '2026-12-10', 900);

    const forBob = await summary.execute(bob, {});
    expect(forBob.items.map((i) => i.borrowerName)).toEqual(['Dora']);
    expect(forBob.totals.totalLentCents).toBe(900);
    const forAdmin = await summary.execute(admin, {});
    expect(forAdmin.items).toEqual([]);
    expect(forAdmin.totals.totalLentCents).toBe(0);
    const forAna = await summary.execute(ana, {});
    expect(forAna.items.map((i) => i.borrowerName)).toEqual(['Carlos']);
  });

  it('reads the payments with ONE aggregated query, not one per loan', async () => {
    const { summary, lend, payments } = await setup();
    for (const name of ['A', 'B', 'C', 'D']) await lend(ana, name, '2026-12-10', 100);
    const spy = jest.spyOn(payments, 'sumPaidByLoans');
    await summary.execute(ana, {});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
