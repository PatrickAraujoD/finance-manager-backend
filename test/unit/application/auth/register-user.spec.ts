import { RegisterUser } from '../../../../src/application/use-cases/auth/register-user';
import { Email } from '../../../../src/domain/email';
import { ConflictError, ValidationError } from '../../../../src/domain/errors';
import { FakePasswordHasher } from '../../../support/fakes/fake-password-hasher';
import { FakeUserRepository } from '../../../support/fakes/fake-user-repository';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';

const PASSWORD = 'correct horse battery';

function setup() {
  const users = new FakeUserRepository();
  const useCase = new RegisterUser(users, new FakePasswordHasher(), new SequentialIdGenerator());
  return { users, useCase };
}

describe('RegisterUser', () => {
  it('creates a normal user with a hashed password and returns the id', async () => {
    const { users, useCase } = setup();
    const { id } = await useCase.execute({ name: 'Ana', email: 'ana@x.com', password: PASSWORD });
    const user = await users.findById(id);
    expect(user?.role).toBe('N');
    expect(user?.active).toBe(true);
    expect(user?.passwordHash).not.toBe(PASSWORD);
    expect(user?.passwordHash).not.toContain(PASSWORD);
  });

  it('ignores a role sent from outside', async () => {
    const { users, useCase } = setup();
    const input = { name: 'Eve', email: 'eve@x.com', password: PASSWORD, role: 'A' };
    const { id } = await useCase.execute(input);
    expect((await users.findById(id))?.role).toBe('N');
  });

  it('normalizes the email', async () => {
    const { users, useCase } = setup();
    const { id } = await useCase.execute({ name: 'Ana', email: '  Ana@X.com ', password: PASSWORD });
    expect((await users.findById(id))?.email.value).toBe('ana@x.com');
  });

  it('rejects a duplicate email even with different casing', async () => {
    const { useCase } = setup();
    await useCase.execute({ name: 'Ana', email: 'a@x.com', password: PASSWORD });
    await expect(
      useCase.execute({ name: 'Ana 2', email: 'A@X.com', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    const { users, useCase } = setup();
    await expect(
      useCase.execute({ name: 'Ana', email: 'a@x.com', password: '12345678901' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await users.findByEmail(Email.create('a@x.com'))).toBeNull();
  });

  it('accepts 12 and 128 characters but rejects 129', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute({ name: 'A', email: 'a@x.com', password: 'x'.repeat(12) }),
    ).resolves.toBeDefined();
    await expect(
      useCase.execute({ name: 'B', email: 'b@x.com', password: 'x'.repeat(128) }),
    ).resolves.toBeDefined();
    await expect(
      useCase.execute({ name: 'C', email: 'c@x.com', password: 'x'.repeat(129) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid email', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute({ name: 'Ana', email: 'nope', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
