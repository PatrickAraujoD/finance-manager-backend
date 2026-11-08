import {
  MAX_EVOLUTION_MONTHS,
  MonthlyEvolution,
} from '../../../../src/application/use-cases/reports/monthly-evolution';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, reportsWorld } from '../../../support/reports-world';

async function setup() {
  const w = reportsWorld();
  await w.category('c1', 'Food');
  return { w, evolution: new MonthlyEvolution(w.reports) };
}

describe('MonthlyEvolution', () => {
  it('fills months without spending with zero', async () => {
    const { w, evolution } = await setup();
    await w.spend('ana', 'c1', 100, '2026-01-15');
    await w.spend('ana', 'c1', 300, '2026-03-02');
    expect(await evolution.execute(ana, { from: '2026-01', to: '2026-04' })).toEqual({
      from: '2026-01',
      to: '2026-04',
      months: [
        { month: '2026-01', totalCents: 100 },
        { month: '2026-02', totalCents: 0 },
        { month: '2026-03', totalCents: 300 },
        { month: '2026-04', totalCents: 0 },
      ],
    });
  });

  it('crosses the year boundary', async () => {
    const { w, evolution } = await setup();
    await w.spend('ana', 'c1', 10, '2025-11-30');
    await w.spend('ana', 'c1', 20, '2025-12-31');
    await w.spend('ana', 'c1', 30, '2026-01-01');
    await w.spend('ana', 'c1', 40, '2026-02-28');
    await w.spend('ana', 'c1', 50, '2026-03-01');
    const { months } = await evolution.execute(ana, { from: '2025-11', to: '2026-02' });
    expect(months).toEqual([
      { month: '2025-11', totalCents: 10 },
      { month: '2025-12', totalCents: 20 },
      { month: '2026-01', totalCents: 30 },
      { month: '2026-02', totalCents: 40 },
    ]);
  });

  it('accepts a single month (from equals to)', async () => {
    const { w, evolution } = await setup();
    await w.spend('ana', 'c1', 7, '2026-05-05');
    expect((await evolution.execute(ana, { from: '2026-05', to: '2026-05' })).months).toEqual([
      { month: '2026-05', totalCents: 7 },
    ]);
  });

  it('returns zeros, not an error, when nothing was spent', async () => {
    const { evolution } = await setup();
    const { months } = await evolution.execute(ana, { from: '2026-01', to: '2026-03' });
    expect(months.map((m) => m.totalCents)).toEqual([0, 0, 0]);
  });

  it('accepts exactly 24 months and rejects 25', async () => {
    const { evolution } = await setup();
    expect(MAX_EVOLUTION_MONTHS).toBe(24);
    const ok = await evolution.execute(ana, { from: '2025-01', to: '2026-12' });
    expect(ok.months).toHaveLength(24);
    await expect(
      evolution.execute(ana, { from: '2025-01', to: '2027-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      evolution.execute(ana, { from: '1900-01', to: '9999-12' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects from after to', async () => {
    const { evolution } = await setup();
    await expect(
      evolution.execute(ana, { from: '2026-05', to: '2026-04' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([
    ['2026-13', '2026-12'],
    ['2026-01', '2026-00'],
    ['2026-1', '2026-02'],
    ['', '2026-02'],
    ['2026-01', ''],
    ['2026-01-01', '2026-02'],
  ])('rejects malformed months %j .. %j', async (from, to) => {
    const { evolution } = await setup();
    await expect(evolution.execute(ana, { from, to })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects missing or non-string bounds', async () => {
    const { evolution } = await setup();
    await expect(
      evolution.execute(ana, { from: undefined as unknown as string, to: '2026-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      evolution.execute(ana, { from: '2026-01', to: 5 as unknown as string }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('never includes another user, not even for an admin', async () => {
    const { w, evolution } = await setup();
    await w.spend('ana', 'c1', 100, '2026-02-01');
    await w.spend('bob', 'c1', 900, '2026-02-01');
    expect((await evolution.execute(ana, { from: '2026-02', to: '2026-02' })).months).toEqual([
      { month: '2026-02', totalCents: 100 },
    ]);
    expect((await evolution.execute(admin, { from: '2026-02', to: '2026-02' })).months).toEqual([
      { month: '2026-02', totalCents: 0 },
    ]);
  });
});
