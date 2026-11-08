import {
  DUMMY_HASH,
  Login,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_TOKEN_TTL_DAYS,
} from '../../../../src/application/use-cases/auth/login';
import { PasswordHasher } from '../../../../src/application/ports/password-hasher';
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

class SpyHasher extends FakePasswordHasher {
  verifyCalls: Array<{ hash: string; plain: string }> = [];
  override async verify(hash: string, plain: string): Promise<boolean> {
    this.verifyCalls.push({ hash, plain });
    return super.verify(hash, plain);
  }
}

async function setup(hasher: PasswordHasher = new FakePasswordHasher()) {
  const clock = new FixedClock();
  const users = new FakeUserRepository();
  const tokens = new FakeRefreshTokenRepository(() => clock.now());
  const useCase = new Login(users, tokens, hasher, new FakeTokenService(), clock, new SequentialIdGenerator());
  await users.save(
    User.create({
      id: 'u1',
      name: 'Ana',
      email: Email.create('ana@x.com'),
      passwordHash: await hasher.hash(PASSWORD),
      role: 'N',
    }),
  );
  return { clock, users, tokens, useCase, hasher };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected rejection');
}

describe('Login', () => {
  it('returns access and refresh tokens for valid credentials', async () => {
    const { useCase, tokens } = await setup();
    const result = await useCase.execute({ email: 'Ana@x.com', password: PASSWORD });
    expect(result.accessToken).toBe('access:u1:N');
    expect(result.refreshToken).toBe('refresh-1');
    expect(await tokens.findByHash('hash(refresh-1)')).not.toBeNull();
  });

  it('stores only the hash of the refresh token, valid for 7 days, in a fresh family', async () => {
    const { useCase, tokens, clock } = await setup();
    await useCase.execute({ email: 'ana@x.com', password: PASSWORD });
    expect(await tokens.findByHash('refresh-1')).toBeNull();
    const stored = await tokens.findByHash('hash(refresh-1)');
    expect(REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(stored?.expiresAt.getTime()).toBe(clock.now().getTime() + 7 * 24 * 3600_000);
    expect(stored?.revokedAt).toBeNull();
    await useCase.execute({ email: 'ana@x.com', password: PASSWORD });
    const second = await tokens.findByHash('hash(refresh-2)');
    expect(second?.familyId).not.toBe(stored?.familyId);
  });

  it('throws the identical generic error for unknown user, wrong password, inactive and locked', async () => {
    const unknown = await setup();
    const e1 = await failure(unknown.useCase.execute({ email: 'no@x.com', password: PASSWORD }));

    const wrong = await setup();
    const e2 = await failure(wrong.useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));

    const inactive = await setup();
    const u = (await inactive.users.findById('u1'))!;
    await inactive.users.save(u.withActive(false));
    const e3 = await failure(inactive.useCase.execute({ email: 'ana@x.com', password: PASSWORD }));

    const locked = await setup();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await failure(locked.useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    }
    const e4 = await failure(locked.useCase.execute({ email: 'ana@x.com', password: PASSWORD }));

    for (const e of [e1, e2, e3, e4]) {
      expect(e).toBeInstanceOf(UnauthorizedError);
      expect(e.constructor).toBe(e1.constructor);
      expect(e.message).toBe(e1.message);
    }
  });

  it('treats a malformed email like any other failed login', async () => {
    const { useCase } = await setup();
    const e = await failure(useCase.execute({ email: 'not-an-email', password: PASSWORD }));
    expect(e).toBeInstanceOf(UnauthorizedError);
  });

  it('still runs a hash verification for an unknown user', async () => {
    const hasher = new SpyHasher();
    const { useCase } = await setup(hasher);
    hasher.verifyCalls = [];
    await failure(useCase.execute({ email: 'no@x.com', password: PASSWORD }));
    expect(hasher.verifyCalls).toEqual([{ hash: DUMMY_HASH, plain: PASSWORD }]);
  });

  it('counts failures and locks on the 5th for 15 minutes', async () => {
    const { useCase, users, clock } = await setup();
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
      expect((await users.findById('u1'))?.lockedUntil).toBeNull();
    }
    await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    const user = await users.findById('u1');
    expect(LOCK_MINUTES).toBe(15);
    expect(user?.failedLogins).toBe(MAX_FAILED_LOGINS);
    expect(user?.lockedUntil?.getTime()).toBe(clock.now().getTime() + 15 * 60_000);
  });

  it('counts every concurrent wrong attempt and locks at the right threshold', async () => {
    const { useCase, users } = await setup();
    await Promise.all(
      Array.from({ length: MAX_FAILED_LOGINS - 1 }, () =>
        failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' })),
      ),
    );
    let user = await users.findById('u1');
    expect(user?.failedLogins).toBe(MAX_FAILED_LOGINS - 1);
    expect(user?.lockedUntil).toBeNull();
    await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    user = await users.findById('u1');
    expect(user?.failedLogins).toBe(MAX_FAILED_LOGINS);
    expect(user?.lockedUntil).not.toBeNull();
  });

  it('rejects the correct password during the lock and does not slide the lock', async () => {
    const { useCase, users, clock } = await setup();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    }
    const lockedUntil = (await users.findById('u1'))?.lockedUntil;
    clock.advanceMinutes(5);
    await failure(useCase.execute({ email: 'ana@x.com', password: PASSWORD }));
    await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    const user = await users.findById('u1');
    expect(user?.lockedUntil?.getTime()).toBe(lockedUntil?.getTime());
    expect(user?.failedLogins).toBe(MAX_FAILED_LOGINS);
  });

  it('only verifies against the dummy hash while locked, with the same generic error', async () => {
    const hasher = new SpyHasher();
    const { useCase } = await setup(hasher);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    }
    hasher.verifyCalls = [];
    const e = await failure(useCase.execute({ email: 'ana@x.com', password: PASSWORD }));
    expect(hasher.verifyCalls).toEqual([{ hash: DUMMY_HASH, plain: PASSWORD }]);
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect(e.message).toBe('Invalid credentials');
  });

  it('accepts the correct password after the lock expires and clears the counters', async () => {
    const { useCase, users, clock } = await setup();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    }
    clock.advanceMinutes(LOCK_MINUTES);
    await expect(useCase.execute({ email: 'ana@x.com', password: PASSWORD })).resolves.toBeDefined();
    const user = await users.findById('u1');
    expect(user?.failedLogins).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });

  it('resets the failure counter after a successful login', async () => {
    const { useCase, users } = await setup();
    await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    await failure(useCase.execute({ email: 'ana@x.com', password: 'wrong-password-1' }));
    await useCase.execute({ email: 'ana@x.com', password: PASSWORD });
    expect((await users.findById('u1'))?.failedLogins).toBe(0);
  });

  it('does not issue tokens for an inactive user even with the right password', async () => {
    const { useCase, users, tokens } = await setup();
    await users.save((await users.findById('u1'))!.withActive(false));
    await failure(useCase.execute({ email: 'ana@x.com', password: PASSWORD }));
    expect(await tokens.findByHash('hash(refresh-1)')).toBeNull();
  });
});
