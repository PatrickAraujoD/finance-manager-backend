import { Login } from '../../../../src/application/use-cases/auth/login';
import { RefreshSession } from '../../../../src/application/use-cases/auth/refresh-session';
import { Email } from '../../../../src/domain/email';
import { User } from '../../../../src/domain/entities/user';
import { UnauthorizedError } from '../../../../src/domain/errors';
import { FakePasswordHasher } from '../../../support/fakes/fake-password-hasher';
import { FakeRefreshTokenRepository } from '../../../support/fakes/fake-refresh-token-repository';
import { FakeTokenService } from '../../../support/fakes/fake-token-service';
import { FakeUserRepository } from '../../../support/fakes/fake-user-repository';
import { FixedClock } from '../../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const PASSWORD = 'correct horse battery';

async function setup() {
  const clock = new FixedClock();
  const hasher = new FakePasswordHasher();
  const users = new FakeUserRepository();
  const refreshTokens = new FakeRefreshTokenRepository(() => clock.now());
  const tokens = new FakeTokenService();
  const ids = new SequentialIdGenerator();
  await users.save(
    User.create({
      id: 'u1',
      name: 'Ana',
      email: Email.create('ana@x.com'),
      passwordHash: await hasher.hash(PASSWORD),
      role: 'N',
    }),
  );
  const login = new Login(users, refreshTokens, hasher, tokens, clock, ids);
  const refresh = new RefreshSession(users, refreshTokens, tokens, clock, ids);
  const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
  return { clock, users, refreshTokens, tokens, ids, refresh, session };
}

describe('RefreshSession', () => {
  it('rotates: returns a new pair, revokes the used token and keeps the family', async () => {
    const { refresh, refreshTokens, session, tokens } = await setup();
    const original = await refreshTokens.findByHash(tokens.hashRefresh(session.refreshToken));
    const next = await refresh.execute({ refreshToken: session.refreshToken });

    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(next.accessToken).toBe('access:u1:N');
    const old = await refreshTokens.findByHash(tokens.hashRefresh(session.refreshToken));
    const fresh = await refreshTokens.findByHash(tokens.hashRefresh(next.refreshToken));
    expect(old?.revokedAt).not.toBeNull();
    expect(fresh?.revokedAt).toBeNull();
    expect(fresh?.familyId).toBe(original?.familyId);
    expect(fresh?.userId).toBe('u1');
  });

  it('keeps working along the chain of rotated tokens', async () => {
    const { refresh, session } = await setup();
    const second = await refresh.execute({ refreshToken: session.refreshToken });
    await expect(refresh.execute({ refreshToken: second.refreshToken })).resolves.toBeDefined();
  });

  it('rejects an unknown token with a generic error', async () => {
    const { refresh } = await setup();
    await expect(refresh.execute({ refreshToken: 'nope' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired token', async () => {
    const { refresh, clock, session } = await setup();
    clock.advanceMinutes(7 * 24 * 60);
    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('treats reuse of a rotated token as theft: revokes the whole family', async () => {
    const { refresh, refreshTokens, tokens, session } = await setup();
    const next = await refresh.execute({ refreshToken: session.refreshToken });

    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const fresh = await refreshTokens.findByHash(tokens.hashRefresh(next.refreshToken));
    expect(fresh?.revokedAt).not.toBeNull();
    await expect(refresh.execute({ refreshToken: next.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('reuse does not affect other families of the same user', async () => {
    const { refresh, session, refreshTokens, tokens, users, ids, clock } = await setup();
    const login = new Login(
      users,
      refreshTokens,
      new FakePasswordHasher(),
      tokens,
      clock,
      ids,
    );
    const other = await login.execute({ email: 'ana@x.com', password: PASSWORD });
    await refresh.execute({ refreshToken: session.refreshToken });
    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeDefined();
    const stored = await refreshTokens.findByHash(tokens.hashRefresh(other.refreshToken));
    expect(stored?.revokedAt).toBeNull();
  });

  it('refuses a deactivated user and revokes their tokens', async () => {
    const { refresh, users, refreshTokens, tokens, session } = await setup();
    await users.save((await users.findById('u1'))!.withActive(false));
    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const stored = await refreshTokens.findByHash(tokens.hashRefresh(session.refreshToken));
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('refuses a token whose user no longer exists', async () => {
    const { refresh, refreshTokens, tokens, clock } = await setup();
    const { RefreshToken } = await import('../../../../src/domain/entities/refresh-token');
    const orphan = tokens.generateRefresh();
    await refreshTokens.save(
      RefreshToken.create({
        id: 'x',
        userId: 'ghost',
        familyId: 'f-x',
        tokenHash: orphan.hash,
        expiresAt: new Date(clock.now().getTime() + 1000),
      }),
    );
    await expect(refresh.execute({ refreshToken: orphan.token })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('uses the same message for every rejection', async () => {
    const { refresh, session } = await setup();
    const unknown = await refresh.execute({ refreshToken: 'nope' }).catch((e: Error) => e);
    await refresh.execute({ refreshToken: session.refreshToken });
    const reused = await refresh.execute({ refreshToken: session.refreshToken }).catch((e: Error) => e);
    expect((reused as Error).message).toBe((unknown as Error).message);
  });
});
