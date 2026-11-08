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

  describe('rotate', () => {
    it('revokes the old token and stores the replacement', async () => {
      await repo.save(token('t1', 'u1', 'f1'));
      expect(await repo.rotate('t1', token('t2', 'u1', 'f1'), NOW)).toBe(true);
      expect((await repo.findByHash('hash-t1'))?.revokedAt?.getTime()).toBe(NOW.getTime());
      expect(await repo.findByHash('hash-t2')).toMatchObject({ id: 't2', familyId: 'f1' });
      expect((await repo.findByHash('hash-t2'))?.revokedAt).toBeNull();
    });

    it('returns false and does not store the replacement when the old token is revoked', async () => {
      const earlier = new Date('2026-11-01T00:00:00Z');
      await repo.save(token('t1', 'u1', 'f1', earlier));
      expect(await repo.rotate('t1', token('t2', 'u1', 'f1'), NOW)).toBe(false);
      expect(await repo.findByHash('hash-t2')).toBeNull();
      expect((await repo.findByHash('hash-t1'))?.revokedAt?.getTime()).toBe(earlier.getTime());
    });

    it('returns false for an unknown old id', async () => {
      expect(await repo.rotate('nope', token('t2', 'u1', 'f1'), NOW)).toBe(false);
      expect(await repo.findByHash('hash-t2')).toBeNull();
    });

    it('of 5 concurrent rotations of the same token exactly one wins and one replacement exists', async () => {
      await repo.save(token('t1', 'u1', 'f1'));
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => repo.rotate('t1', token(`n${i}`, 'u1', 'f1'), NOW)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await prisma.client.refreshToken.count({ where: { id: { startsWith: 'n' } } })).toBe(1);
    });

    it('keeps the old token active when storing the replacement fails', async () => {
      await repo.save(token('t1', 'u1', 'f1'));
      await repo.save(token('t2', 'u1', 'f1'));
      const clash = RefreshToken.create({
        id: 't3',
        userId: 'u1',
        familyId: 'f1',
        tokenHash: 'hash-t2',
        expiresAt: LATER,
      });
      await expect(repo.rotate('t1', clash, NOW)).rejects.toThrow();
      expect((await repo.findByHash('hash-t1'))?.revokedAt).toBeNull();
      expect(await prisma.client.refreshToken.count({ where: { id: 't3' } })).toBe(0);
    });
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
