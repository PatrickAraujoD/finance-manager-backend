import { Email } from '../../../domain/email';
import { User } from '../../../domain/entities/user';
import { ConflictError } from '../../../domain/errors';
import { IdGenerator } from '../../ports/id-generator';
import { PasswordHasher } from '../../ports/password-hasher';
import { UserRepository } from '../../ports/user-repository';
import { requireValidPassword } from '../auth/password-policy';

export interface EnsureAdminInput {
  email: string;
  password: string;
}

const ADMIN_NAME = 'Administrator';

/** Seeds the first admin. Idempotent: an existing account (any role) is never touched. */
export class EnsureAdmin {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: EnsureAdminInput): Promise<{ created: boolean }> {
    requireValidPassword(input.password);
    const email = Email.create(input.email);
    if (await this.users.findByEmail(email)) return { created: false };

    const admin = User.create({
      id: this.ids.next(),
      name: ADMIN_NAME,
      email,
      passwordHash: await this.hasher.hash(input.password),
      role: 'A',
    });
    try {
      await this.users.save(admin);
    } catch (error) {
      if (error instanceof ConflictError) return { created: false }; // lost a race with another seed
      throw error;
    }
    return { created: true };
  }
}
