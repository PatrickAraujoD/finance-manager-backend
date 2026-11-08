import { Email } from '../../../domain/email';
import { User } from '../../../domain/entities/user';
import { ConflictError, ValidationError } from '../../../domain/errors';
import { IdGenerator } from '../../ports/id-generator';
import { PasswordHasher } from '../../ports/password-hasher';
import { UserRepository } from '../../ports/user-repository';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

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
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new ValidationError(
        `Password must have between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      );
    }
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
