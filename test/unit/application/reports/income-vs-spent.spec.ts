import { IncomeVsSpent } from '../../../../src/application/use-cases/reports/income-vs-spent';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, reportsWorld } from '../../../support/reports-world';

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
      receivedCents: 0,
      creditSpentCents: 0,
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
      receivedCents: 0,
      creditSpentCents: 0,
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
      receivedCents: 0,
      creditSpentCents: 0,
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
      receivedCents: 0,
      creditSpentCents: 0,
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
      receivedCents: 0,
      creditSpentCents: 0,
      remainingCents: null,
      percentSpent: null,
    });
  });

  describe('account versus credit card', () => {
    it('a credit purchase does not reduce the remainder; it is only informative', async () => {
      const { w, report } = await setup();
      await w.earn('ana', '2026-11', 500000);
      await w.spend('ana', 'c1', 100000, '2026-11-03', { paymentMethod: 'CREDIT' });
      expect(await report.execute(ana, '2026-11')).toEqual({
        month: '2026-11',
        incomeCents: 500000,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 100000,
        remainingCents: 500000,
        percentSpent: 0,
      });
    });

    it('debit, Pix and cash reduce the remainder', async () => {
      const { w, report } = await setup();
      await w.earn('ana', '2026-11', 500000);
      await w.spend('ana', 'c1', 100, '2026-11-03', { paymentMethod: 'DEBIT' });
      await w.spend('ana', 'c1', 200, '2026-11-03', { paymentMethod: 'PIX' });
      await w.spend('ana', 'c1', 400, '2026-11-03', { paymentMethod: 'CASH' });
      expect(await report.execute(ana, '2026-11')).toMatchObject({
        spentCents: 700,
        remainingCents: 499300,
      });
    });

    it('paying the card bill leaves the account, even though the purchase did not', async () => {
      const { w, report } = await setup();
      await w.earn('ana', '2026-11', 500000);
      await w.spend('ana', 'c1', 100000, '2026-11-03', { paymentMethod: 'CREDIT' });
      await w.spend('ana', 'c1', 100000, '2026-11-20', { isCardPayment: true });
      expect(await report.execute(ana, '2026-11')).toMatchObject({
        spentCents: 100000,
        creditSpentCents: 100000,
        remainingCents: 400000,
        percentSpent: 20,
      });
    });

    it('payments received on loans in the month come back into the remainder', async () => {
      const { w, report } = await setup();
      await w.earn('ana', '2026-11', 500000);
      await w.spend('ana', 'c1', 20000, '2026-11-03');
      await w.receive('ana', 10000, '2026-11-15');
      await w.receive('ana', 5000, '2026-10-31');
      expect(await report.execute(ana, '2026-11')).toMatchObject({
        spentCents: 20000,
        receivedCents: 10000,
        remainingCents: 490000,
        percentSpent: 4,
      });
    });

    it('received money shows up even without income, with the remainder still null', async () => {
      const { w, report } = await setup();
      await w.receive('ana', 700, '2026-11-15');
      expect(await report.execute(ana, '2026-11')).toMatchObject({
        incomeCents: null,
        receivedCents: 700,
        remainingCents: null,
      });
    });

    it('never mixes users: Bob and the admin do not see what Ana spent or received', async () => {
      const { w, report } = await setup();
      await w.earn('ana', '2026-11', 1000);
      await w.spend('ana', 'c1', 100, '2026-11-01', { paymentMethod: 'CREDIT' });
      await w.spend('ana', 'c1', 50, '2026-11-01');
      await w.receive('ana', 30, '2026-11-02');
      await w.earn('bob', '2026-11', 2000);
      await w.spend('bob', 'c1', 5, '2026-11-01');
      expect(await report.execute(bob, '2026-11')).toMatchObject({
        incomeCents: 2000,
        spentCents: 5,
        receivedCents: 0,
        creditSpentCents: 0,
      });
      expect(await report.execute(admin, '2026-11')).toMatchObject({
        incomeCents: null,
        spentCents: 0,
        receivedCents: 0,
        creditSpentCents: 0,
      });
    });
  });

  it.each(['2026-13', '', '2026-1', 'x'])('rejects the invalid month %j', async (month) => {
    const { report } = await setup();
    await expect(report.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
  });
});
