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

export type EnsureAdminState = 'created' | 'admin-exists' | 'not-admin';

export interface EnsureAdminResult {
  created: boolean;
  /**
   * `admin-exists`: the account is already an active admin, nothing changed. `not-admin`: the
   * e-mail belongs to an account that is not an active admin; it is left untouched (never promoted
   * automatically) and the operator must handle it manually.
   */
  state: EnsureAdminState;
}

const ADMIN_NAME = 'Administrator';

/** Seeds the first admin. Idempotent: an existing account (any role) is never touched, only classified. */
export class EnsureAdmin {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: EnsureAdminInput): Promise<EnsureAdminResult> {
    requireValidPassword(input.password);
    const email = Email.create(input.email);
    const existing = await this.users.findByEmail(email);
    if (existing) return this.classify(existing);

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
      if (error instanceof ConflictError) {
        // Lost a race with another seed: classify whatever got there first.
        const winner = await this.users.findByEmail(email);
        if (winner) return this.classify(winner);
      }
      throw error;
    }
    return { created: true, state: 'created' };
  }

  private classify(user: User): EnsureAdminResult {
    const activeAdmin = user.role === 'A' && user.active;
    return { created: false, state: activeAdmin ? 'admin-exists' : 'not-admin' };
  }
}
