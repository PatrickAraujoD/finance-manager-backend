import { Email } from '../../src/domain/email';
import { RefreshToken } from '../../src/domain/entities/refresh-token';
import { User } from '../../src/domain/entities/user';
import { PrismaRefreshTokenRepository } from '../../src/infrastructure/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const NOW = new Date('2026-11-08T12:00:00Z');
const LATER = new Date('2026-11-15T12:00:00Z');

function token(id: string, userId: string, familyId: string, revokedAt: Date | null = null) {
  return RefreshToken.create({
    id,
    userId,
    familyId,
    tokenHash: `hash-${id}`,
    expiresAt: LATER,
    revokedAt,
  });
}

describe('PrismaRefreshTokenRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaRefreshTokenRepository;

  beforeAll(async () => {
    prisma = createPrismaService();
    repo = new PrismaRefreshTokenRepository(prisma);
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    const users = new PrismaUserRepository(prisma);
    for (const id of ['u1', 'u2']) {
      await users.save(
        User.create({
          id,
          name: id,
          email: Email.create(`${id}@x.com`),
          passwordHash: 'h',
          role: 'N',
        }),
      );
    }
  });
  afterAll(() => prisma.disconnect());

  it('saves and finds by hash', async () => {
    await repo.save(token('t1', 'u1', 'f1'));
    const found = await repo.findByHash('hash-t1');
    expect(found).toMatchObject({ id: 't1', userId: 'u1', familyId: 'f1' });
    expect(found?.expiresAt.getTime()).toBe(LATER.getTime());
    expect(found?.revokedAt).toBeNull();
  });

  it('findByHash of an unknown hash returns null', async () => {
    expect(await repo.findByHash('nope')).toBeNull();
  });

  it('revokeIfActive revokes once and then returns false', async () => {
    await repo.save(token('t1', 'u1', 'f1'));
    expect(await repo.revokeIfActive('t1', NOW)).toBe(true);
    expect(await repo.revokeIfActive('t1', NOW)).toBe(false);
    expect((await repo.findByHash('hash-t1'))?.revokedAt?.getTime()).toBe(NOW.getTime());
  });

  it('revokeIfActive returns false for an unknown id', async () => {
    expect(await repo.revokeIfActive('nope', NOW)).toBe(false);
  });

  it('revokeIfActive: of 2 concurrent calls exactly one returns true', async () => {
    await repo.save(token('t1', 'u1', 'f1'));
    const results = await Promise.all([repo.revokeIfActive('t1', NOW), repo.revokeIfActive('t1', NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('revokeFamily revokes only that family and keeps earlier revocation dates', async () => {
    const earlier = new Date('2026-11-01T00:00:00Z');
    await repo.save(token('t1', 'u1', 'f1'));
    await repo.save(token('t2', 'u1', 'f1', earlier));
    await repo.save(token('t3', 'u1', 'f2'));

    await repo.revokeFamily('f1');

    expect((await repo.findByHash('hash-t1'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('hash-t2'))?.revokedAt?.getTime()).toBe(earlier.getTime());
    expect((await repo.findByHash('hash-t3'))?.revokedAt).toBeNull();
  });

  it('revokeAllByUser revokes only that user tokens', async () => {
    await repo.save(token('t1', 'u1', 'f1'));
    await repo.save(token('t2', 'u1', 'f2'));
    await repo.save(token('t3', 'u2', 'f3'));

    await repo.revokeAllByUser('u1');

    expect((await repo.findByHash('hash-t1'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('hash-t2'))?.revokedAt).not.toBeNull();
    expect((await repo.findByHash('hash-t3'))?.revokedAt).toBeNull();
  });
});
