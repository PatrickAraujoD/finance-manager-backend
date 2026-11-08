import { Email } from '../../../src/domain/email';
import { User } from '../../../src/domain/entities/user';
import { ConflictError } from '../../../src/domain/errors';
import { UserRepository } from '../../../src/application/ports/user-repository';

export class FakeUserRepository implements UserRepository {
  private readonly items = new Map<string, User>();
  // Tail of the mutation queue: mutate() runs strictly one after another, like a row lock would.
  private queue: Promise<unknown> = Promise.resolve();

  async save(user: User): Promise<void> {
    for (const u of this.items.values()) {
      if (u.id !== user.id && u.email.value === user.email.value) {
        throw new ConflictError('Email already in use');
      }
    }
    this.items.set(user.id, user);
  }
  async findById(id: string): Promise<User | null> {
    return this.items.get(id) ?? null;
  }
  async findByEmail(email: Email): Promise<User | null> {
    for (const u of this.items.values()) if (u.email.value === email.value) return u;
    return null;
  }
  async list(): Promise<User[]> {
    return [...this.items.values()];
  }
  mutate(id: string, fn: (user: User) => User): Promise<User | null> {
    const run = async (): Promise<User | null> => {
      // Yield so an unserialized implementation would interleave read and write.
      await Promise.resolve();
      const current = this.items.get(id);
      if (!current) return null;
      const updated = fn(current);
      this.items.set(id, updated);
      return updated;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
