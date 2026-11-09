import { CreateLoan } from '../../../../src/application/use-cases/loans/create-loan';
import { DeleteLoan } from '../../../../src/application/use-cases/loans/delete-loan';
import { NotFoundError } from '../../../../src/domain/errors';
import { admin, ana, bob, loansWorld } from './support';

async function setup() {
  const world = await loansWorld();
  const create = new CreateLoan(world.loans, world.expenses, world.ids);
  const { id } = await create.execute(ana, {
    borrowerName: 'Carlos',
    dueDate: '2026-12-10',
    expenseId: 'e-ana',
  });
  return { ...world, id, create, remove: new DeleteLoan(world.loans) };
}

describe('DeleteLoan', () => {
  it('deletes a loan of the actor and leaves its expense alone', async () => {
    const { remove, id, loans, expenses } = await setup();
    await remove.execute(ana, id);
    expect(await loans.findById('ana', id)).toBeNull();
    expect(await expenses.findById('ana', 'e-ana')).not.toBeNull();
  });

  it('frees the expense for a new loan', async () => {
    const { remove, create, id } = await setup();
    await remove.execute(ana, id);
    await expect(
      create.execute(ana, { borrowerName: 'Maria', dueDate: '2026-12-10', expenseId: 'e-ana' }),
    ).resolves.toBeDefined();
  });

  it('answers NotFoundError alike for missing, foreign and admin access, deleting nothing', async () => {
    const { remove, id, loans } = await setup();
    const missing = await remove.execute(ana, 'nope').catch((e) => e);
    const foreign = await remove.execute(bob, id).catch((e) => e);
    const asAdmin = await remove.execute(admin, id).catch((e) => e);
    for (const error of [missing, foreign, asAdmin]) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(missing.message);
    }
    expect(await loans.findById('ana', id)).not.toBeNull();
  });

  it('cannot delete the same loan twice', async () => {
    const { remove, id } = await setup();
    await remove.execute(ana, id);
    await expect(remove.execute(ana, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
