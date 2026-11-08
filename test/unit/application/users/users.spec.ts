import { ListUsers } from '../../../../src/application/use-cases/users/list-users';
import { UpdateUser } from '../../../../src/application/use-cases/users/update-user';
import { Email } from '../../../../src/domain/email';
import { User } from '../../../../src/domain/entities/user';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../../src/domain/errors';
import { Role } from '../../../../src/domain/role';
import { RefreshToken } from '../../../../src/domain/entities/refresh-token';
import { FakeRefreshTokenRepository } from '../../../support/fakes/fake-refresh-token-repository';
import { FakeUserRepository } from '../../../support/fakes/fake-user-repository';

const admin = { id: 'a1', role: 'A' as Role };
const normal = { id: 'n1', role: 'N' as Role };

async function setup() {
  const users = new FakeUserRepository();
  const refreshTokens = new FakeRefreshTokenRepository();
  const mk = (id: string, role: Role, active = true) =>
    User.create({
      id,
      name: `User ${id}`,
      email: Email.create(`${id}@x.com`),
      passwordHash: 'hash',
      role,
      active,
    });
  for (const u of [mk('a1', 'A'), mk('a2', 'A'), mk('n1', 'N'), mk('n2', 'N')]) await users.save(u);
  return {
    users,
    refreshTokens,
    list: new ListUsers(users),
    update: new UpdateUser(users, refreshTokens),
  };
}

describe('ListUsers', () => {
  it('lets an admin list every user', async () => {
    const { list } = await setup();
    expect((await list.execute(admin)).map((u) => u.id)).toEqual(['a1', 'a2', 'n1', 'n2']);
  });

  it('refuses a normal user', async () => {
    const { list } = await setup();
    await expect(list.execute(normal)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('UpdateUser', () => {
  it('lets an admin change the role of another user', async () => {
    const { update, users } = await setup();
    const updated = await update.execute(admin, 'n1', { role: 'A' });
    expect(updated.role).toBe('A');
    expect((await users.findById('n1'))?.role).toBe('A');
  });

  it('refuses a normal user, even on their own record', async () => {
    const { update, users } = await setup();
    await expect(update.execute(normal, 'n1', { role: 'A' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(update.execute(normal, 'n2', { active: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await users.findById('n1'))?.role).toBe('N');
  });

  it('refuses an admin demoting themselves', async () => {
    const { update, users } = await setup();
    await expect(update.execute(admin, 'a1', { role: 'N' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await users.findById('a1'))?.role).toBe('A');
  });

  it('refuses an admin deactivating themselves and revokes nothing', async () => {
    const { update, users, refreshTokens } = await setup();
    const spy = jest.spyOn(refreshTokens, 'revokeAllByUser');
    await expect(update.execute(admin, 'a1', { active: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await users.findById('a1'))?.active).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows an admin to keep their own role and activity explicitly', async () => {
    const { update } = await setup();
    const updated = await update.execute(admin, 'a1', { role: 'A', active: true });
    expect(updated.role).toBe('A');
  });

  it('deactivating a user revokes all of their refresh tokens', async () => {
    const { update, users, refreshTokens } = await setup();
    const token = RefreshToken.create({
      id: 't1',
      userId: 'n1',
      familyId: 'f1',
      tokenHash: 'h1',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    await refreshTokens.save(token);
    const updated = await update.execute(admin, 'n1', { active: false });
    expect(updated.active).toBe(false);
    expect((await users.findById('n1'))?.active).toBe(false);
    expect((await refreshTokens.findByHash('h1'))?.revokedAt).not.toBeNull();
  });

  it('reactivating a user does not revoke anything', async () => {
    const { update, refreshTokens } = await setup();
    const spy = jest.spyOn(refreshTokens, 'revokeAllByUser');
    await update.execute(admin, 'n1', { active: false });
    spy.mockClear();
    await update.execute(admin, 'n1', { active: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers NotFoundError for an unknown user', async () => {
    const { update } = await setup();
    await expect(update.execute(admin, 'ghost', { role: 'A' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects an empty change and invalid values', async () => {
    const { update } = await setup();
    await expect(update.execute(admin, 'n1', {})).rejects.toBeInstanceOf(ValidationError);
    await expect(
      update.execute(admin, 'n1', { role: 'X' as unknown as Role }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      update.execute(admin, 'n1', { active: 'no' as unknown as boolean }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('with two admins, one can demote the other but the last active admin is protected', async () => {
    const { update, users } = await setup();
    await update.execute(admin, 'a2', { role: 'N' });
    // A stale actor (a2 was just demoted) tries to take the only remaining admin down.
    const stale = { id: 'a2', role: 'A' as Role };
    await expect(update.execute(stale, 'a1', { role: 'N' })).rejects.toBeInstanceOf(ConflictError);
    await expect(update.execute(stale, 'a1', { active: false })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await users.findById('a1'))?.role).toBe('A');
    expect((await users.findById('a1'))?.active).toBe(true);
  });

  it('does not count inactive admins as remaining admins', async () => {
    const { update, users } = await setup();
    await update.execute(admin, 'a2', { active: false });
    const stale = { id: 'a2', role: 'A' as Role };
    await expect(update.execute(stale, 'a1', { role: 'N' })).rejects.toBeInstanceOf(ConflictError);
    expect((await users.findById('a1'))?.role).toBe('A');
  });
});
