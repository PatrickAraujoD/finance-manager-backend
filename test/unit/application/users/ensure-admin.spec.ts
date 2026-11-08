import { EnsureAdmin } from '../../../../src/application/use-cases/users/ensure-admin';
import { Email } from '../../../../src/domain/email';
import { User } from '../../../../src/domain/entities/user';
import { ValidationError } from '../../../../src/domain/errors';
import { FakePasswordHasher } from '../../../support/fakes/fake-password-hasher';
import { FakeUserRepository } from '../../../support/fakes/fake-user-repository';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const PASSWORD = 'correct horse battery';

function setup() {
  const users = new FakeUserRepository();
  const useCase = new EnsureAdmin(users, new FakePasswordHasher(), new SequentialIdGenerator());
  return { users, useCase };
}

describe('EnsureAdmin', () => {
  it('creates an active admin with a hashed password', async () => {
    const { users, useCase } = setup();
    const result = await useCase.execute({ email: ' Root@X.com ', password: PASSWORD });
    expect(result.created).toBe(true);
    const user = await users.findByEmail(Email.create('root@x.com'));
    expect(user?.role).toBe('A');
    expect(user?.active).toBe(true);
    expect(user?.passwordHash).not.toContain(PASSWORD);
  });

  it('is idempotent and never overwrites an existing account', async () => {
    const { users, useCase } = setup();
    await useCase.execute({ email: 'root@x.com', password: PASSWORD });
    const before = await users.findByEmail(Email.create('root@x.com'));
    const again = await useCase.execute({ email: 'ROOT@x.com', password: 'another long password' });
    expect(again.created).toBe(false);
    const after = await users.findByEmail(Email.create('root@x.com'));
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(await users.list()).toHaveLength(1);
  });

  it('does not promote or change an existing normal user with that email', async () => {
    const { users, useCase } = setup();
    await users.save(
      User.create({
        id: 'n1',
        name: 'Normal',
        email: Email.create('root@x.com'),
        passwordHash: 'h',
        role: 'N',
      }),
    );
    const result = await useCase.execute({ email: 'root@x.com', password: PASSWORD });
    expect(result.created).toBe(false);
    expect((await users.findById('n1'))?.role).toBe('N');
  });

  it('applies the same password rules as registration (12 to 128 characters)', async () => {
    const { users, useCase } = setup();
    await expect(useCase.execute({ email: 'a@x.com', password: 'x'.repeat(11) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(useCase.execute({ email: 'a@x.com', password: 'x'.repeat(129) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await users.list()).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const { useCase } = setup();
    await expect(useCase.execute({ email: 'nope', password: PASSWORD })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('never leaks the password in an error message', async () => {
    const { useCase } = setup();
    const secret = 'short-secret';
    await expect(useCase.execute({ email: 'a@x.com', password: secret })).rejects.toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    );
  });
});
