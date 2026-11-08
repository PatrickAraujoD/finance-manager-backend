import { Clock } from '../../src/application/ports/clock';
import { IdGenerator } from '../../src/application/ports/id-generator';
import { Login } from '../../src/application/use-cases/auth/login';
import { Logout } from '../../src/application/use-cases/auth/logout';
import { RefreshSession } from '../../src/application/use-cases/auth/refresh-session';
import { RegisterUser } from '../../src/application/use-cases/auth/register-user';
import { UnauthorizedError } from '../../src/domain/errors';
import { Argon2Hasher } from '../../src/infrastructure/hashing/argon2-hasher';
import { PrismaRefreshTokenRepository } from '../../src/infrastructure/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { JwtTokenService } from '../../src/infrastructure/tokens/jwt-token-service';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const PASSWORD = 'correct horse battery';

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

class RandomIds implements IdGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}

describe('auth flow with real Prisma, Argon2 and JWT', () => {
  let prisma: PrismaService;
  let login: Login;
  let refresh: RefreshSession;
  let logout: Logout;
  let tokens: JwtTokenService;
  let refreshTokens: PrismaRefreshTokenRepository;

  beforeAll(() => {
    prisma = createPrismaService();
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    const clock = new SystemClock();
    const ids = new RandomIds();
    const hasher = new Argon2Hasher();
    const users = new PrismaUserRepository(prisma);
    refreshTokens = new PrismaRefreshTokenRepository(prisma);
    tokens = new JwtTokenService({ secret: 'x'.repeat(48), clock });
    await new RegisterUser(users, hasher, ids).execute({
      name: 'Ana',
      email: 'ana@x.com',
      password: PASSWORD,
    });
    login = new Login(users, refreshTokens, hasher, tokens, clock, ids);
    refresh = new RefreshSession(users, refreshTokens, tokens, clock, ids);
    logout = new Logout(refreshTokens, tokens);
  });
  afterAll(() => prisma.disconnect());

  it('logs in and the access token verifies', async () => {
    const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
    const payload = await tokens.verifyAccess(session.accessToken);
    expect(payload.role).toBe('N');
  });

  it('rejects a wrong password and counts the failure', async () => {
    await expect(login.execute({ email: 'ana@x.com', password: 'wrong-password' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const row = await prisma.client.user.findFirstOrThrow();
    expect(row.failedLogins).toBe(1);
  });

  it('rotates the refresh token', async () => {
    const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
    const next = await refresh.execute({ refreshToken: session.refreshToken });
    expect(next.refreshToken).not.toBe(session.refreshToken);
    await expect(refresh.execute({ refreshToken: next.refreshToken })).resolves.toBeDefined();
  });

  it('reusing a rotated token revokes the whole family', async () => {
    const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
    const next = await refresh.execute({ refreshToken: session.refreshToken });

    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(refresh.execute({ refreshToken: next.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('concurrent refresh with the same token: only one succeeds', async () => {
    const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => refresh.execute({ refreshToken: session.refreshToken })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(UnauthorizedError);
  });

  it('logout revokes the family and is idempotent', async () => {
    const session = await login.execute({ email: 'ana@x.com', password: PASSWORD });
    await logout.execute({ refreshToken: session.refreshToken });
    await logout.execute({ refreshToken: session.refreshToken });
    await logout.execute({ refreshToken: 'unknown' });
    await expect(refresh.execute({ refreshToken: session.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const stored = await refreshTokens.findByHash(tokens.hashRefresh(session.refreshToken));
    expect(stored?.revokedAt).not.toBeNull();
  });
});
