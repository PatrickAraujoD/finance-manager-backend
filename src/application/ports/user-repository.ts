import { Email } from '../../domain/email';
import { User } from '../../domain/entities/user';

export interface UserRepository {
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  list(): Promise<User[]>;
}
