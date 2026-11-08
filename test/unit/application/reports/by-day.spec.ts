import { ByDay } from '../../../../src/application/use-cases/reports/by-day';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, reportsWorld } from '../../../support/reports-world';

async function setup() {
  const w = reportsWorld();
  await w.category('c1', 'Food');
  await w.category('c2', 'Bus');
  return { w, byDay: new ByDay(w.reports) };
}

describe('ByDay', () => {
  it('returns an empty month as no days and no top day, without error', async () => {
    const { byDay } = await setup();
    expect(await byDay.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      days: [],
      topDay: null,
    });
  });

  it('sums the expenses of a day, lists only days with spending, ordered by date', async () => {
    const { w, byDay } = await setup();
    await w.spend('ana', 'c1', 300, '2026-11-10');
    await w.spend('ana', 'c2', 200, '2026-11-02');
    await w.spend('ana', 'c1', 150, '2026-11-10');
    const report = await byDay.execute(ana, '2026-11');
    expect(report.days).toEqual([
      { date: '2026-11-02', totalCents: 200 },
      { date: '2026-11-10', totalCents: 450 },
    ]);
    expect(report.topDay).toEqual({ date: '2026-11-10', totalCents: 450 });
  });

  it('the top day is the day with the largest total, not the largest single expense', async () => {
    const { w, byDay } = await setup();
    await w.spend('ana', 'c1', 900, '2026-11-01');
    await w.spend('ana', 'c1', 400, '2026-11-02');
    await w.spend('ana', 'c1', 400, '2026-11-02');
    await w.spend('ana', 'c1', 400, '2026-11-02');
    expect((await byDay.execute(ana, '2026-11')).topDay).toEqual({
      date: '2026-11-02',
      totalCents: 1200,
    });
  });

  it('breaks a tie for the top day with the earliest date', async () => {
    const { w, byDay } = await setup();
    await w.spend('ana', 'c1', 500, '2026-11-20');
    await w.spend('ana', 'c1', 500, '2026-11-05');
    await w.spend('ana', 'c1', 500, '2026-11-12');
    expect((await byDay.execute(ana, '2026-11')).topDay).toEqual({
      date: '2026-11-05',
      totalCents: 500,
    });
  });

  it('honors the month boundaries, including a leap day', async () => {
    const { w, byDay } = await setup();
    await w.spend('ana', 'c1', 1, '2028-01-31');
    await w.spend('ana', 'c1', 2, '2028-02-01');
    await w.spend('ana', 'c1', 4, '2028-02-29');
    await w.spend('ana', 'c1', 8, '2028-03-01');
    expect((await byDay.execute(ana, '2028-02')).days).toEqual([
      { date: '2028-02-01', totalCents: 2 },
      { date: '2028-02-29', totalCents: 4 },
    ]);
  });

  it('never includes another user, not even for an admin', async () => {
    const { w, byDay } = await setup();
    await w.spend('ana', 'c1', 100, '2026-11-01');
    await w.spend('bob', 'c1', 999, '2026-11-01');
    expect((await byDay.execute(ana, '2026-11')).days).toEqual([
      { date: '2026-11-01', totalCents: 100 },
    ]);
    expect(await byDay.execute(admin, '2026-11')).toEqual({
      month: '2026-11',
      days: [],
      topDay: null,
    });
  });

  it.each(['2026-13', '2026-1', '', '2026-11-01', 'nope'])(
    'rejects the invalid month %j',
    async (month) => {
      const { byDay } = await setup();
      await expect(byDay.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
    },
  );
});
