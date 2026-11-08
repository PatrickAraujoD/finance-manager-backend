import { GetMonthlyIncome } from '../../../../src/application/use-cases/income/get-monthly-income';
import { SetMonthlyIncome } from '../../../../src/application/use-cases/income/set-monthly-income';
import { MAX_INCOME_CENTS } from '../../../../src/domain/entities/monthly-income';
import { ValidationError } from '../../../../src/domain/errors';
import { Role } from '../../../../src/domain/role';
import { FakeIncomeRepository } from '../../../support/fakes/fake-income-repository';

const ana = { id: 'ana', role: 'N' as Role };
const bob = { id: 'bob', role: 'N' as Role };
const admin = { id: 'admin', role: 'A' as Role };

function setup() {
  const incomes = new FakeIncomeRepository();
  return { incomes, set: new SetMonthlyIncome(incomes), get: new GetMonthlyIncome(incomes) };
}

describe('SetMonthlyIncome', () => {
  it('stores the income and returns it', async () => {
    const { set, get } = setup();
    expect(await set.execute(ana, { month: '2026-11', amountCents: 500000 })).toEqual({
      month: '2026-11',
      amountCents: 500000,
    });
    expect(await get.execute(ana, '2026-11')).toEqual({ month: '2026-11', amountCents: 500000 });
  });

  it('overwrites the value of the same month (upsert)', async () => {
    const { set, get, incomes } = setup();
    await set.execute(ana, { month: '2026-11', amountCents: 500000 });
    await set.execute(ana, { month: '2026-11', amountCents: 650000 });
    expect(await get.execute(ana, '2026-11')).toEqual({ month: '2026-11', amountCents: 650000 });
    expect(await incomes.find('ana', '2026-11')).not.toBeNull();
  });

  it('keeps different months independent', async () => {
    const { set, get } = setup();
    await set.execute(ana, { month: '2026-10', amountCents: 100 });
    await set.execute(ana, { month: '2026-11', amountCents: 200 });
    expect((await get.execute(ana, '2026-10'))?.amountCents).toBe(100);
    expect((await get.execute(ana, '2026-11'))?.amountCents).toBe(200);
  });

  it.each([0, -1, -500000])('rejects a non-positive amount (%p)', async (amountCents) => {
    const { set } = setup();
    await expect(set.execute(ana, { month: '2026-11', amountCents })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an amount that is not a safe integer (%p)',
    async (amountCents) => {
      const { set } = setup();
      await expect(set.execute(ana, { month: '2026-11', amountCents })).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );

  it('accepts the documented maximum and rejects anything above it', async () => {
    const { set } = setup();
    await expect(
      set.execute(ana, { month: '2026-11', amountCents: MAX_INCOME_CENTS }),
    ).resolves.toBeDefined();
    await expect(
      set.execute(ana, { month: '2026-11', amountCents: MAX_INCOME_CENTS + 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each(['2026-13', '2026-00', '26-1', '2026-1', '2026-011', ' 2026-11', '2026-11 ', '2026/11', ''])(
    'rejects the invalid month %p',
    async (month) => {
      const { set } = setup();
      await expect(set.execute(ana, { month, amountCents: 100 })).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );

  it('does not store anything when validation fails', async () => {
    const { set, incomes } = setup();
    await set.execute(ana, { month: '2026-11', amountCents: 100 }).catch(() => undefined);
    await set.execute(ana, { month: '2026-11', amountCents: -1 }).catch(() => undefined);
    expect((await incomes.find('ana', '2026-11'))?.amount.cents).toBe(100);
  });
});

describe('GetMonthlyIncome', () => {
  it('returns null when the month has no income', async () => {
    const { get } = setup();
    expect(await get.execute(ana, '2026-11')).toBeNull();
  });

  it('only exposes the actor own income, never somebody else', async () => {
    const { set, get } = setup();
    await set.execute(ana, { month: '2026-11', amountCents: 500000 });
    expect(await get.execute(bob, '2026-11')).toBeNull();
    expect(await get.execute(admin, '2026-11')).toBeNull(); // admin does not read others' income
  });

  it('does not let a user overwrite another user income', async () => {
    const { set, get } = setup();
    await set.execute(ana, { month: '2026-11', amountCents: 500000 });
    await set.execute(bob, { month: '2026-11', amountCents: 999 });
    expect((await get.execute(ana, '2026-11'))?.amountCents).toBe(500000);
    expect((await get.execute(bob, '2026-11'))?.amountCents).toBe(999);
  });

  it.each(['2026-13', '2026-00', '26-1', '2026-1', ''])(
    'rejects the invalid month %p',
    async (month) => {
      const { get } = setup();
      await expect(get.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
    },
  );
});
