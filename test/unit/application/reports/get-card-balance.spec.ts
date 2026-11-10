import { GetCardBalance } from '../../../../src/application/use-cases/reports/get-card-balance';
import { ValidationError } from '../../../../src/domain/errors';
import { admin, ana, bob, reportsWorld } from '../../../support/reports-world';

async function setup() {
  const w = reportsWorld();
  await w.category('c1', 'Food');
  return { w, card: new GetCardBalance(w.reports) };
}

describe('GetCardBalance', () => {
  it('a month without movement is all zeros', async () => {
    const { card } = await setup();
    expect(await card.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      openingCents: 0,
      chargedCents: 0,
      paidCents: 0,
      balanceCents: 0,
    });
  });

  it('a credit purchase raises the balance and paying the bill (Pix) brings it back to zero', async () => {
    const { w, card } = await setup();
    await w.spend('ana', 'c1', 100000, '2026-11-02', { paymentMethod: 'CREDIT' });
    expect(await card.execute(ana, '2026-11')).toMatchObject({
      chargedCents: 100000,
      paidCents: 0,
      balanceCents: 100000,
    });
    await w.spend('ana', 'c1', 100000, '2026-11-20', { isCardPayment: true });
    expect(await card.execute(ana, '2026-11')).toMatchObject({
      chargedCents: 100000,
      paidCents: 100000,
      balanceCents: 0,
    });
  });

  it('debit, Pix and cash purchases do not touch the card', async () => {
    const { w, card } = await setup();
    await w.spend('ana', 'c1', 20000, '2026-11-02', { paymentMethod: 'PIX' });
    await w.spend('ana', 'c1', 300, '2026-11-02', { paymentMethod: 'DEBIT' });
    await w.spend('ana', 'c1', 40, '2026-11-02', { paymentMethod: 'CASH' });
    expect(await card.execute(ana, '2026-11')).toMatchObject({ chargedCents: 0, balanceCents: 0 });
  });

  it('the previous months feed the opening balance and the next ones are ignored', async () => {
    const { w, card } = await setup();
    await w.spend('ana', 'c1', 5000, '2026-09-30', { paymentMethod: 'CREDIT' });
    await w.spend('ana', 'c1', 2000, '2026-10-31', { isCardPayment: true });
    await w.spend('ana', 'c1', 700, '2026-11-01', { paymentMethod: 'CREDIT' });
    await w.spend('ana', 'c1', 100, '2026-11-30', { isCardPayment: true });
    await w.spend('ana', 'c1', 999, '2026-12-01', { paymentMethod: 'CREDIT' });
    expect(await card.execute(ana, '2026-11')).toEqual({
      month: '2026-11',
      openingCents: 3000,
      chargedCents: 700,
      paidCents: 100,
      balanceCents: 3600,
    });
    expect(await card.execute(ana, '2026-12')).toMatchObject({
      openingCents: 3600,
      balanceCents: 4599,
    });
  });

  it('may be negative when the bill was overpaid', async () => {
    const { w, card } = await setup();
    await w.spend('ana', 'c1', 1000, '2026-11-02', { paymentMethod: 'CREDIT' });
    await w.spend('ana', 'c1', 1500, '2026-11-20', { isCardPayment: true });
    expect(await card.execute(ana, '2026-11')).toMatchObject({ balanceCents: -500 });
  });

  it('never mixes users: Bob and the admin do not see the card of Ana', async () => {
    const { w, card } = await setup();
    await w.spend('ana', 'c1', 1000, '2026-10-02', { paymentMethod: 'CREDIT' });
    await w.spend('ana', 'c1', 400, '2026-11-02', { paymentMethod: 'CREDIT' });
    await w.spend('bob', 'c1', 7, '2026-11-02', { paymentMethod: 'CREDIT' });
    expect(await card.execute(bob, '2026-11')).toMatchObject({
      openingCents: 0,
      chargedCents: 7,
      balanceCents: 7,
    });
    expect(await card.execute(admin, '2026-11')).toMatchObject({
      openingCents: 0,
      chargedCents: 0,
      balanceCents: 0,
    });
  });

  describe('money lent directly', () => {
    it('a credit loan raises the card in the month it was lent', async () => {
      const { w, card } = await setup();
      await w.lend('ana', 25000, '2026-11-03', 'CREDIT');
      expect(await card.execute(ana, '2026-11')).toMatchObject({
        chargedCents: 25000,
        balanceCents: 25000,
      });
    });

    it('feeds the opening balance of later months and ignores later ones', async () => {
      const { w, card } = await setup();
      await w.lend('ana', 5000, '2026-10-31', 'CREDIT');
      await w.lend('ana', 700, '2026-11-01', 'CREDIT');
      await w.lend('ana', 999, '2026-12-01', 'CREDIT');
      expect(await card.execute(ana, '2026-11')).toMatchObject({
        openingCents: 5000,
        chargedCents: 700,
        balanceCents: 5700,
      });
    });

    it('paying the bill brings a credit loan back to zero', async () => {
      const { w, card } = await setup();
      await w.lend('ana', 25000, '2026-11-03', 'CREDIT');
      await w.spend('ana', 'c1', 25000, '2026-11-20', { isCardPayment: true });
      expect(await card.execute(ana, '2026-11')).toMatchObject({ balanceCents: 0 });
    });

    it('Pix, debit and cash loans do not touch the card', async () => {
      const { w, card } = await setup();
      for (const method of ['PIX', 'DEBIT', 'CASH'] as const) {
        await w.lend('ana', 100, '2026-11-03', method);
      }
      expect(await card.execute(ana, '2026-11')).toMatchObject({ chargedCents: 0, balanceCents: 0 });
    });

    it('a loan born from a credit expense does not count a second time', async () => {
      const { w, card } = await setup();
      await w.spend('ana', 'c1', 600, '2026-11-03', { paymentMethod: 'CREDIT' });
      await w.lendFromExpense('ana', 'e1', 600);
      expect(await card.execute(ana, '2026-11')).toMatchObject({ chargedCents: 600 });
    });

    it('never mixes users', async () => {
      const { w, card } = await setup();
      await w.lend('ana', 100, '2026-11-01', 'CREDIT');
      expect(await card.execute(bob, '2026-11')).toMatchObject({ chargedCents: 0 });
    });
  });

  it.each(['2026-13', '', '2026-1', 'x'])('rejects the invalid month %j', async (month) => {
    const { card } = await setup();
    await expect(card.execute(ana, month)).rejects.toBeInstanceOf(ValidationError);
  });
});
