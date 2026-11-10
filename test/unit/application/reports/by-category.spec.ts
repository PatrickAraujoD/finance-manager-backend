import { ByCategory } from '../../../../src/application/use-cases/reports/by-category';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, reportsWorld } from '../../../support/reports-world';

describe('ByCategory', () => {
  async function setup() {
    const w = reportsWorld();
    await w.category('c-food', 'Food');
    await w.category('c-bus', 'Bus');
    await w.category('c-fun', 'Fun');
    await w.category('c-own', 'Own', 'ana');
    return { w, byCategory: new ByCategory(w.reports) };
  }

  it('returns an empty month as no items and zero, without error', async () => {
    const { byCategory } = await setup();
    expect(await byCategory.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      totalCents: 0,
      items: [],
    });
  });

  it('lists categories by total descending with names and percentages', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-bus', 2500, '2026-11-02');
    await w.spend('ana', 'c-food', 7500, '2026-11-01');
    expect(await byCategory.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      totalCents: 10000,
      items: [
        { categoryId: 'c-food', categoryName: 'Food', totalCents: 7500, percentage: 75 },
        { categoryId: 'c-bus', categoryName: 'Bus', totalCents: 2500, percentage: 25 },
      ],
    });
  });

  it('ignores card bill payments but counts the credit purchases they pay for', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-food', 1000, '2026-11-02', { paymentMethod: 'CREDIT' });
    await w.spend('ana', 'c-bus', 1000, '2026-11-10', { isCardPayment: true });
    expect(await byCategory.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      totalCents: 1000,
      items: [{ categoryId: 'c-food', categoryName: 'Food', totalCents: 1000, percentage: 100 }],
    });
  });

  it('percentages of 1/3 + 1/3 + 1/3 sum to exactly 100.00', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-food', 100, '2026-11-01');
    await w.spend('ana', 'c-bus', 100, '2026-11-01');
    await w.spend('ana', 'c-fun', 100, '2026-11-01');
    const { items } = await byCategory.execute(ana, '2026-11');
    expect(items.map((i) => i.percentage)).toEqual([33.34, 33.33, 33.33]);
    expect(Math.round(items.reduce((s, i) => s + i.percentage * 100, 0))).toBe(10000);
  });

  it('breaks ties by name and then by id, deterministically', async () => {
    const w = reportsWorld();
    await w.category('b2', 'Same');
    await w.category('b1', 'Same', 'ana');
    await w.category('a1', 'Alpha');
    for (const id of ['b2', 'b1', 'a1']) await w.spend('ana', id, 100, '2026-11-01');
    const { items } = await new ByCategory(w.reports).execute(ana, '2026-11');
    expect(items.map((i) => i.categoryId)).toEqual(['a1', 'b1', 'b2']);
  });

  it('shows global and own categories under the right names', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-food', 300, '2026-11-01');
    await w.spend('ana', 'c-own', 200, '2026-11-01');
    const { items } = await byCategory.execute(ana, '2026-11');
    expect(items.map((i) => [i.categoryId, i.categoryName])).toEqual([
      ['c-food', 'Food'],
      ['c-own', 'Own'],
    ]);
  });

  it('only counts the actor, never another user, not even for an admin', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-food', 100, '2026-11-01');
    await w.spend('bob', 'c-food', 900, '2026-11-01');
    expect((await byCategory.execute(ana, '2026-11')).totalCents).toBe(100);
    expect((await byCategory.execute(bob, '2026-11')).totalCents).toBe(900);
    expect(await byCategory.execute(admin, '2026-11')).toEqual({
      month: '2026-11',
      totalCents: 0,
      items: [],
    });
  });

  it('only counts the requested month', async () => {
    const { w, byCategory } = await setup();
    await w.spend('ana', 'c-food', 100, '2026-10-31');
    await w.spend('ana', 'c-food', 200, '2026-11-01');
    await w.spend('ana', 'c-food', 400, '2026-11-30');
    await w.spend('ana', 'c-food', 800, '2026-12-01');
    expect((await byCategory.execute(ana, '2026-11')).totalCents).toBe(600);
  });

  it.each(['2026-13', '2026-1', '26-11', '2026-11-01', '', ' 2026-11', 'abcd-ef', '2026-00'])(
    'rejects the invalid month %j with a ValidationError',
    async (month) => {
      const { byCategory } = await setup();
      await expect(byCategory.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it.each([undefined, null, 202611, ['2026-11'], { toString: () => '2026-11' }])(
    'rejects a non-string month (%p)',
    async (month) => {
      const { byCategory } = await setup();
      await expect(byCategory.execute(ana, month as unknown as string)).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );
});
