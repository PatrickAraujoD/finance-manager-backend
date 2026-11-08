import { Email } from '../../src/domain/email';
import { User } from '../../src/domain/entities/user';
import { Argon2Hasher } from '../../src/infrastructure/hashing/argon2-hasher';
import { PrismaUserRepository } from '../../src/infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { runSeed } from '../../prisma/seed';
import { cleanDatabase, createPrismaService } from './support/prisma-test-context';

const PASSWORD = 'a very long admin password';

describe('admin seed (Postgres)', () => {
  let prisma: PrismaService;
  let users: PrismaUserRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    users = new PrismaUserRepository(prisma);
  });
  beforeEach(() => cleanDatabase(prisma));
  afterAll(() => prisma.disconnect());

  const env = (extra: Record<string, string | undefined> = {}) => ({
    ADMIN_EMAIL: 'Admin@Example.com',
    ADMIN_PASSWORD: PASSWORD,
    ...extra,
  });

  it('creates an active admin whose password verifies with the real hasher', async () => {
    const result = await runSeed(env(), prisma);
    expect(result).toEqual({ created: true });
    const admin = await users.findByEmail(Email.create('admin@example.com'));
    expect(admin?.role).toBe('A');
    expect(admin?.active).toBe(true);
    expect(admin?.passwordHash).not.toContain(PASSWORD);
    expect(await new Argon2Hasher().verify(admin?.passwordHash ?? '', PASSWORD)).toBe(true);
  });

  it('is idempotent and never overwrites the password of an existing admin', async () => {
    await runSeed(env(), prisma);
    const before = await users.findByEmail(Email.create('admin@example.com'));
    const again = await runSeed(env({ ADMIN_PASSWORD: 'a different long password' }), prisma);
    expect(again).toEqual({ created: false });
    const after = await users.findByEmail(Email.create('admin@example.com'));
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(await prisma.client.user.count()).toBe(1);
  });

  it('does not touch an existing normal user with the same email', async () => {
    await users.save(
      User.create({
        id: 'n1',
        name: 'Normal',
        email: Email.create('admin@example.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    expect(await runSeed(env(), prisma)).toEqual({ created: false });
    expect((await users.findById('n1'))?.role).toBe('N');
  });

  it('requires ADMIN_EMAIL and ADMIN_PASSWORD', async () => {
    await expect(runSeed(env({ ADMIN_EMAIL: undefined }), prisma)).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(runSeed(env({ ADMIN_PASSWORD: '' }), prisma)).rejects.toThrow(/ADMIN_PASSWORD/);
    expect(await prisma.client.user.count()).toBe(0);
  });

  it('applies the registration password rules without echoing the password', async () => {
    const weak = 'weak-pw-1';
    const error = await runSeed(env({ ADMIN_PASSWORD: weak }), prisma).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(weak);
    expect(await prisma.client.user.count()).toBe(0);
  });

  it('never prints the password', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      await runSeed(env(), prisma);
      await runSeed(env(), prisma);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
