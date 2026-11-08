import { Login } from '../../../../src/application/use-cases/auth/login';
import { Logout } from '../../../../src/application/use-cases/auth/logout';
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
  const logout = new Logout(refreshTokens, tokens);
  const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
  return { refresh, logout, session, refreshTokens, tokens };
}

describe('Logout', () => {
  it('revokes the token so it can no longer be refreshed', async () => {
    const { logout, refresh, session } = await setup();
    await logout.execute({ refreshToken: session.refreshToken });
    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('revokes the whole family, including tokens issued by rotation', async () => {
    const { logout, refresh, session, refreshTokens, tokens } = await setup();
    const next = await refresh.execute({ refreshToken: session.refreshToken });
    await logout.execute({ refreshToken: next.refreshToken });
    const stored = await refreshTokens.findByHash(tokens.hashRefresh(next.refreshToken));
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('is idempotent and does not leak errors for unknown tokens', async () => {
    const { logout, session } = await setup();
    await expect(logout.execute({ refreshToken: 'unknown' })).resolves.toBeUndefined();
    await logout.execute({ refreshToken: session.refreshToken });
    await expect(logout.execute({ refreshToken: session.refreshToken })).resolves.toBeUndefined();
  });
});
