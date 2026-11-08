import { Email } from '../../src/domain/email';
import { User } from '../../src/domain/entities/user';
import { ConflictError } from '../../src/domain/errors';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

function makeUser(id: string, email: string, extra: Partial<Parameters<typeof User.create>[0]> = {}) {
  return User.create({
    id,
    name: `User ${id}`,
    email: Email.create(email),
    passwordHash: 'hash-secret',
    role: 'N',
    ...extra,
  });
}

describe('PrismaUserRepository (Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaUserRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repo = new PrismaUserRepository(prisma);
  });
  beforeEach(() => cleanDatabase(prisma));
  afterAll(() => prisma.disconnect());

  it('saves and finds by id and by email', async () => {
    await repo.save(makeUser('u1', 'ana@x.com', { role: 'A' }));

    const byId = await repo.findById('u1');
    const byEmail = await repo.findByEmail(Email.create('ANA@x.com'));
    expect(byId?.email.value).toBe('ana@x.com');
    expect(byId?.role).toBe('A');
    expect(byId?.passwordHash).toBe('hash-secret');
    expect(byId?.active).toBe(true);
    expect(byEmail?.id).toBe('u1');
  });

  it('returns null for unknown id and email', async () => {
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.findByEmail(Email.create('no@x.com'))).toBeNull();
  });

  it('save is an upsert', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    await repo.save(makeUser('u1', 'ana@x.com').withActive(false).withRole('A'));

    const found = await repo.findById('u1');
    expect(found?.active).toBe(false);
    expect(found?.role).toBe('A');
    expect(await repo.list()).toHaveLength(1);
  });

  it('lists all users', async () => {
    await repo.save(makeUser('u1', 'a@x.com'));
    await repo.save(makeUser('u2', 'b@x.com'));
    expect((await repo.list()).map((u) => u.id).sort()).toEqual(['u1', 'u2']);
  });

  it('rejects a duplicate email (different case) with ConflictError', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    await expect(repo.save(makeUser('u2', 'ANA@x.com'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not leak the password hash in conflict errors', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    const error = await repo.save(makeUser('u2', 'ana@x.com')).catch((e: Error) => e);
    expect((error as Error).message).not.toContain('hash-secret');
  });

  it('mutate returns null for unknown user', async () => {
    expect(await repo.mutate('nope', (u) => u)).toBeNull();
  });

  it('mutate applies fn and persists', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    const updated = await repo.mutate('u1', (u) => u.withRole('A'));
    expect(updated?.role).toBe('A');
    expect((await repo.findById('u1'))?.role).toBe('A');
  });

  it('mutate does not lose updates: 20 concurrent failed logins count exactly 20', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    const now = new Date('2026-11-08T12:00:00Z');

    await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.mutate('u1', (u) => u.registerFailedLogin(now, 1000, 15)),
      ),
    );

    expect((await repo.findById('u1'))?.failedLogins).toBe(20);
  });

  it('mutate locks the account exactly at the limit under concurrency', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    const now = new Date('2026-11-08T12:00:00Z');

    await Promise.all(
      Array.from({ length: 5 }, () => repo.mutate('u1', (u) => u.registerFailedLogin(now, 5, 15))),
    );

    const user = await repo.findById('u1');
    expect(user?.failedLogins).toBe(5);
    expect(user?.isLocked(now)).toBe(true);
    expect(user?.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60_000);
  });

  it('mutate rolls back when fn throws', async () => {
    await repo.save(makeUser('u1', 'ana@x.com'));
    await expect(
      repo.mutate('u1', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await repo.findById('u1'))?.failedLogins).toBe(0);
  });
});
