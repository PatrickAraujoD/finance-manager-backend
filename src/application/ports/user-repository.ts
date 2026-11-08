import { Email } from '../../domain/email';
import { User } from '../../domain/entities/user';

export interface UserRepository {
  /**
   * Upsert: inserts or replaces the user with the same id. Saving an email already used by another
   * user MUST throw `ConflictError` (implementations translate the unique-constraint violation).
   */
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  list(): Promise<User[]>;
  /**
   * Reads the user, applies `fn` and persists the result as one atomic step. Real implementations
   * MUST serialize concurrent mutations of the same user (e.g. a transaction with a row lock), so
   * no update is lost. Returns the updated user, or null when the user does not exist. Decisions
   * (such as locking after failed logins) belong to `fn`, i.e. to the domain, not to the adapter.
   */
  mutate(id: string, fn: (user: User) => User): Promise<User | null>;
}
