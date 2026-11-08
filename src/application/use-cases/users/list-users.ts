import { User } from '../../../domain/entities/user';
import { ForbiddenError } from '../../../domain/errors';
import { Actor } from '../../actor';
import { UserRepository } from '../../ports/user-repository';

export class ListUsers {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: Actor): Promise<User[]> {
    if (actor.role !== 'A') throw new ForbiddenError('Forbidden');
    return this.users.list();
  }
}
