import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { GetLoan } from '../../../../src/application/use-cases/loans/get-loan';
import {
  DEFAULT_LOAN_PAGE,
  ListLoans,
  MAX_LOAN_OFFSET,
  MAX_LOAN_PAGE,
} from '../../../../src/application/use-cases/loans/list-loans';
import { NotFoundError, ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

async function setup() {
  const world = await loansWorld();
  return {
    ...world,
    create: new CreateLoan(world.loans, world.expenses, world.ids),
    get: new GetLoan(world.loans, world.payments, world.clock),
    list: new ListLoans(world.loans, world.payments, world.clock),
  };
}

// "Today" is 2026-11-08 (the FixedClock default).
const lend = (name: string, dueDate: string, amountCents = 1000) => ({
  borrowerName: name,
  dueDate,
  amountCents,
});

describe('GetLoan', () => {
  it('returns the loan with its balance', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, lend('Carlos', '2026-12-10', 5000));
    const details = await get.execute(ana, id);
    expect(details.loan.borrowerName).toBe('Carlos');
    expect(details.balance.paid.cents).toBe(0);
    expect(details.balance.remaining.cents).toBe(5000);
    expect(details.balance.status).toBe('OPEN');
  });

  it('is OPEN when due today and OVERDUE when due yesterday, by the clock', async () => {
    const { create, get } = await setup();
    const today = await create.execute(ana, lend('A', '2026-11-08'));
    const yesterday = await create.execute(ana, lend('B', '2026-11-07'));
    expect((await get.execute(ana, today.id)).balance.status).toBe('OPEN');
    expect((await get.execute(ana, yesterday.id)).balance.status).toBe('OVERDUE');
  });

  it('follows the clock: the same loan becomes OVERDUE the day after', async () => {
    const { create, get, clock } = await setup();
    const { id } = await create.execute(ana, lend('A', '2026-11-08'));
    clock.set(new Date('2026-11-09T00:00:00Z'));
    expect((await get.execute(ana, id)).balance.status).toBe('OVERDUE');
  });

  it('answers NotFoundError alike for a missing loan and for one of someone else', async () => {
    const { create, get } = await setup();
    const { id } = await create.execute(ana, lend('Carlos', '2026-12-10'));
    const missing = await get.execute(bob, 'nope').catch((e) => e);
    const foreign = await get.execute(bob, id).catch((e) => e);
    const asAdmin = await get.execute(admin, id).catch((e) => e);
    for (const error of [missing, foreign, asAdmin]) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(missing.message);
    }
  });
});

describe('ListLoans', () => {
  it('lists the loans of the actor by due date, then id, with their balances', async () => {
    const { create, list } = await setup();
    await create.execute(ana, lend('Late', '2026-12-30'));
    await create.execute(ana, lend('Early', '2026-11-01'));
    await create.execute(ana, lend('Middle', '2026-12-01'));
    const page = await list.execute(ana, {});
    expect(page.items.map((i) => i.loan.borrowerName)).toEqual(['Early', 'Middle', 'Late']);
    expect(page.items.map((i) => i.balance.status)).toEqual(['OVERDUE', 'OPEN', 'OPEN']);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(DEFAULT_LOAN_PAGE);
    expect(page.offset).toBe(0);
  });

  it('isolates users: Ana, Bob and the admin each see only their own', async () => {
    const { create, list } = await setup();
    await create.execute(ana, lend('Carlos', '2026-12-10'));
    await create.execute(bob, lend('Carlos', '2026-12-10'));
    await create.execute(bob, lend('Maria', '2026-12-11'));
    expect((await list.execute(ana, {})).total).toBe(1);
    expect((await list.execute(bob, {})).total).toBe(2);
    const adminPage = await list.execute(admin, {});
    expect(adminPage.items).toEqual([]);
    expect(adminPage.total).toBe(0);
  });

  it('filters by borrower ignoring case and surrounding spaces', async () => {
    const { create, list } = await setup();
    await create.execute(ana, lend('Carlos', '2026-12-10'));
    await create.execute(ana, lend('CARLOS', '2026-12-11'));
    await create.execute(ana, lend('Carlos Eduardo', '2026-12-12'));
    await create.execute(ana, lend('Maria', '2026-12-13'));
    const page = await list.execute(ana, { borrower: '  carlos ' });
    expect(page.items.map((i) => i.loan.borrowerName)).toEqual(['Carlos', 'CARLOS']);
    expect(page.total).toBe(2);
  });

  it('filters by status using today from the clock', async () => {
    const { create, list } = await setup();
    await create.execute(ana, lend('Past', '2026-11-07'));
    await create.execute(ana, lend('Today', '2026-11-08'));
    await create.execute(ana, lend('Future', '2026-12-01'));
    const names = async (status: 'OPEN' | 'PAID' | 'OVERDUE') =>
      (await list.execute(ana, { status })).items.map((i) => i.loan.borrowerName);
    expect(await names('OVERDUE')).toEqual(['Past']);
    expect(await names('OPEN')).toEqual(['Today', 'Future']);
    expect(await names('PAID')).toEqual([]);
  });

  it('combines the borrower and status filters', async () => {
    const { create, list } = await setup();
    await create.execute(ana, lend('Carlos', '2026-11-07'));
    await create.execute(ana, lend('Carlos', '2026-12-07'));
    await create.execute(ana, lend('Maria', '2026-11-07'));
    const page = await list.execute(ana, { borrower: 'carlos', status: 'OVERDUE' });
    expect(page.items.map((i) => i.loan.dueDate.toISOString().slice(0, 10))).toEqual(['2026-11-07']);
    expect(page.total).toBe(1);
  });

  it('pages after filtering, with the total of all matches', async () => {
    const { create, list } = await setup();
    for (let day = 10; day <= 14; day++) await create.execute(ana, lend('C', `2026-12-${day}`));
    const second = await list.execute(ana, { limit: 2, offset: 2 });
    expect(second.items.map((i) => i.loan.dueDate.getUTCDate())).toEqual([12, 13]);
    expect(second.total).toBe(5);
    expect(second.limit).toBe(2);
    expect(second.offset).toBe(2);
    expect((await list.execute(ana, { limit: 2, offset: 4 })).items).toHaveLength(1);
    expect((await list.execute(ana, { offset: 99 })).items).toEqual([]);
  });

  it.each([
    { limit: 0 },
    { limit: MAX_LOAN_PAGE + 1 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: MAX_LOAN_OFFSET + 1 },
    { status: 'LATE' },
    { status: 'open' },
    { status: 'Overdue' },
    { borrower: '' },
    { borrower: '   ' },
    { borrower: 'Car\u0000los' },
    { borrower: 42 },
  ])('rejects the input %j', async (input) => {
    const { list } = await setup();
    await expect(list.execute(ana, input as never)).rejects.toBeInstanceOf(ValidationError);
  });
});
