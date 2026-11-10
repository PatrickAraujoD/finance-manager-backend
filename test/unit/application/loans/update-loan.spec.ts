import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { UpdateLoan } from '../../../../src/application/use-cases/loans/update-loan';
import { NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

async function setup() {
  const world = await loansWorld();
  const create = new CreateLoan(world.loans, world.expenses, world.ids, world.clock);
  const { id } = await create.execute(ana, {
    borrowerName: 'Carlos',
    dueDate: '2026-12-10',
    expenseId: 'e-ana',
  });
  return { ...world, id, update: new UpdateLoan(world.loans, world.payments, world.clock) };
}

describe('UpdateLoan', () => {
  it('changes the borrower name only and returns the loan with its balance', async () => {
    const { update, id, loans } = await setup();
    const result = await update.execute(ana, id, { borrowerName: '  Carlos Eduardo ' });
    expect(result.loan.borrowerName).toBe('Carlos Eduardo');
    expect(result.loan.dueDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(result.balance.remaining.cents).toBe(4_200);
    expect((await loans.findById('ana', id))?.borrowerName).toBe('Carlos Eduardo');
  });

  it('changes the due date only, and the status follows the new date', async () => {
    const { update, id, loans } = await setup();
    const result = await update.execute(ana, id, { dueDate: '2026-11-01' });
    expect(result.loan.borrowerName).toBe('Carlos');
    expect(result.balance.status).toBe('OVERDUE');
    expect((await loans.findById('ana', id))?.dueDate.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });

  it('changes both at once', async () => {
    const { update, id } = await setup();
    const result = await update.execute(ana, id, { borrowerName: 'Maria', dueDate: '2027-01-15' });
    expect(result.loan.borrowerName).toBe('Maria');
    expect(result.loan.dueDate.toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('never touches the amount or the expense link', async () => {
    const { update, id, loans } = await setup();
    await update.execute(ana, id, {
      borrowerName: 'Maria',
      amountCents: 1,
      expenseId: 'e-ana-2',
      userId: 'bob',
    } as never);
    const loan = await loans.findById('ana', id);
    expect(loan?.amount.cents).toBe(4_200);
    expect(loan?.expenseId).toBe('e-ana');
    expect(loan?.userId).toBe('ana');
  });

  it('requires at least one field', async () => {
    const { update, id } = await setup();
    await expect(update.execute(ana, id, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(update.execute(ana, id, { amountCents: 5 } as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it.each([
    { borrowerName: '' },
    { borrowerName: '   ' },
    { borrowerName: 'a'.repeat(101) },
    { borrowerName: 'Car‮los' },
    { borrowerName: 7 },
    { dueDate: '1999-12-31' },
    { dueDate: '2026-02-30' },
    { dueDate: 'tomorrow' },
  ])('rejects the invalid input %j and leaves the loan untouched', async (input) => {
    const { update, id, loans } = await setup();
    await expect(update.execute(ana, id, input as never)).rejects.toBeInstanceOf(ValidationError);
    expect((await loans.findById('ana', id))?.borrowerName).toBe('Carlos');
  });

  it('answers NotFoundError alike for missing, foreign and admin access, changing nothing', async () => {
    const { update, id, loans } = await setup();
    const missing = await update.execute(ana, 'nope', { borrowerName: 'X' }).catch((e) => e);
    const foreign = await update.execute(bob, id, { borrowerName: 'X' }).catch((e) => e);
    const asAdmin = await update.execute(admin, id, { borrowerName: 'X' }).catch((e) => e);
    for (const error of [missing, foreign, asAdmin]) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(missing.message);
    }
    expect((await loans.findById('ana', id))?.borrowerName).toBe('Carlos');
  });

  it('reports NotFoundError when the loan vanishes between the read and the write', async () => {
    const { update, id, loans } = await setup();
    jest.spyOn(loans, 'update').mockResolvedValueOnce(false);
    await expect(update.execute(ana, id, { borrowerName: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
