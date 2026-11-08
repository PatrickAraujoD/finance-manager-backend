import { IncomeVsSpent } from '../../../../src/application/use-cases/reports/income-vs-spent';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, reportsWorld } from '../../../support/reports-world';

async function setup() {
  const w = reportsWorld();
  await w.category('c1', 'Food');
  return { w, report: new IncomeVsSpent(w.reports, w.incomes) };
}

describe('IncomeVsSpent', () => {
  it('without income and without spending: null income, zero spent, no error', async () => {
    const { report } = await setup();
    expect(await report.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      incomeCents: null,
      spentCents: 0,
      remainingCents: null,
      percentSpent: null,
    });
  });

  it('without income but with spending: income, remaining and percent stay null', async () => {
    const { w, report } = await setup();
    await w.spend('ana', 'c1', 1234, '2026-11-03');
    expect(await report.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      incomeCents: null,
      spentCents: 1234,
      remainingCents: null,
      percentSpent: null,
    });
  });

  it('with income: remaining and percent spent', async () => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-11', 500000);
    await w.spend('ana', 'c1', 125000, '2026-11-03');
    expect(await report.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      incomeCents: 500000,
      spentCents: 125000,
      remainingCents: 375000,
      percentSpent: 25,
    });
  });

  it('with income and no spending: everything remains, 0 percent', async () => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-11', 100000);
    expect(await report.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      incomeCents: 100000,
      spentCents: 0,
      remainingCents: 100000,
      percentSpent: 0,
    });
  });

  it('spending more than the income gives a negative remainder and more than 100 percent', async () => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-11', 100000);
    await w.spend('ana', 'c1', 150000, '2026-11-03');
    expect(await report.execute(ana, '2026-11')).toMatchObject({
      remainingCents: -50000,
      percentSpent: 150,
    });
  });

  it.each([
    [1, 3, 33.33],
    [2, 3, 66.67],
    [1, 7, 14.29],
    [1, 20000, 0.01],
    [1, 40000, 0],
  ])('rounds %d of %d to two decimals (%d) using integers', async (spent, income, expected) => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-11', income);
    await w.spend('ana', 'c1', spent, '2026-11-01');
    expect((await report.execute(ana, '2026-11')).percentSpent).toBe(expected);
  });

  it('uses the income and spending of the requested month only', async () => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-10', 999);
    await w.earn('ana', '2026-11', 1000);
    await w.spend('ana', 'c1', 500, '2026-10-31');
    await w.spend('ana', 'c1', 100, '2026-11-01');
    expect(await report.execute(ana, '2026-11')).toMatchObject({
      incomeCents: 1000,
      spentCents: 100,
      remainingCents: 900,
    });
  });

  it('never mixes users: the admin sees only their own income and spending', async () => {
    const { w, report } = await setup();
    await w.earn('ana', '2026-11', 1000);
    await w.spend('ana', 'c1', 100, '2026-11-01');
    expect(await report.execute(admin, '2026-11')).toEqual({
      month: '2026-11',
      incomeCents: null,
      spentCents: 0,
      remainingCents: null,
      percentSpent: null,
    });
  });

  it.each(['2026-13', '', '2026-1', 'x'])('rejects the invalid month %j', async (month) => {
    const { report } = await setup();
    await expect(report.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
  });
});
