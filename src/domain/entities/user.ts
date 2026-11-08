import { Email } from '../email';
import { ValidationError } from '../errors';
import { Role } from '../role';
import { requireCleanText, requireNonBlank } from '../validation';

export interface UserProps {
  id: string;
  name: string;
  email: Email;
  passwordHash: string;
  role: Role;
  active: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
}

export type CreateUserInput = Pick<UserProps, 'id' | 'name' | 'email' | 'passwordHash' | 'role'> &
  Partial<Pick<UserProps, 'active' | 'failedLogins' | 'lockedUntil'>>;

export class User {
  readonly #props: UserProps;

  private constructor(props: UserProps) {
    this.#props = props;
  }

  static create(input: CreateUserInput): User {
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.name, 'User name');
    const name = input.name.trim();
    if (!input.passwordHash) throw new ValidationError('Password hash is required');
    requireCleanText(input.passwordHash, 'Password hash');
    const failedLogins = input.failedLogins ?? 0;
    if (!Number.isInteger(failedLogins) || failedLogins < 0) {
      throw new ValidationError('failedLogins must be a non-negative integer');
    }
    return new User({
      id: input.id,
      name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      active: input.active ?? true,
      failedLogins,
      lockedUntil: input.lockedUntil ? new Date(input.lockedUntil.getTime()) : null,
    });
  }

  get id(): string {
    return this.#props.id;
  }
  get name(): string {
    return this.#props.name;
  }
  get email(): Email {
    return this.#props.email;
  }
  get passwordHash(): string {
    return this.#props.passwordHash;
  }
  get role(): Role {
    return this.#props.role;
  }
  get active(): boolean {
    return this.#props.active;
  }
  get failedLogins(): number {
    return this.#props.failedLogins;
  }
  get lockedUntil(): Date | null {
    return this.#props.lockedUntil ? new Date(this.#props.lockedUntil.getTime()) : null;
  }

  registerFailedLogin(now: Date, maxAttempts: number, lockMinutes: number): User {
    if (this.isLocked(now)) return this;
    const { lockedUntil: previousLock } = this.#props;
    const lockExpired = previousLock !== null && now.getTime() >= previousLock.getTime();
    const failedLogins = (lockExpired ? 0 : this.#props.failedLogins) + 1;
    const lockedUntil =
      failedLogins >= maxAttempts
        ? new Date(now.getTime() + lockMinutes * 60_000)
        : lockExpired
          ? null
          : previousLock;
    return new User({ ...this.#props, failedLogins, lockedUntil });
  }

  isLocked(now: Date): boolean {
    return this.#props.lockedUntil !== null && now.getTime() < this.#props.lockedUntil.getTime();
  }

  withRole(role: Role): User {
    return new User({ ...this.#props, role });
  }

  withActive(active: boolean): User {
    return new User({ ...this.#props, active });
  }

  resetFailedLogins(): User {
    return new User({ ...this.#props, failedLogins: 0, lockedUntil: null });
  }
}
