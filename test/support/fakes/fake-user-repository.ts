import { Email } from '../../../src/domain/email';
import { User } from '../../../src/domain/entities/user';
import { UserRepository } from '../../../src/application/ports/user-repository';

export class FakeUserRepository implements UserRepository {
  private readonly items = new Map<string, User>();

  async save(user: User): Promise<void> {
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
}
