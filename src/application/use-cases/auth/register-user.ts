import { Email } from '../../../domain/email';
import { User } from '../../../domain/entities/user';
import { ConflictError } from '../../../domain/errors';
import { IdGenerator } from '../../ports/id-generator';
import { PasswordHasher } from '../../ports/password-hasher';
import { UserRepository } from '../../ports/user-repository';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, requireValidPassword } from './password-policy';

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: RegisterUserInput): Promise<{ id: string }> {
    const { password } = input;
    requireValidPassword(password);
    const email = Email.create(input.email);
    if (await this.users.findByEmail(email)) throw new ConflictError('Email already registered');

    const user = User.create({
      id: this.ids.next(),
      name: input.name,
      email,
      passwordHash: await this.hasher.hash(password),
      role: 'N',
    });
    await this.users.save(user);
    return { id: user.id };
  }
}
