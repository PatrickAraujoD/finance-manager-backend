import { User } from '../../../domain/entities/user';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../domain/errors';
import { parseRole, Role } from '../../../domain/role';
import { Actor } from '../../actor';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository';
import { UserRepository } from '../../ports/user-repository';

export interface UpdateUserInput {
  role?: Role;
  active?: boolean;
}

export class UpdateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(actor: Actor, id: string, input: UpdateUserInput): Promise<User> {
    if (actor.role !== 'A') throw new ForbiddenError('Forbidden');
    if (input.role === undefined && input.active === undefined) {
      throw new ValidationError('Nothing to update');
    }
    const role = input.role === undefined ? undefined : parseRole(input.role);
    if (input.active !== undefined && typeof input.active !== 'boolean') {
      throw new ValidationError('active must be a boolean');
    }
    const { active } = input;

    const removesAdminPower = (role !== undefined && role !== 'A') || active === false;
    if (id === actor.id && removesAdminPower) {
      throw new ForbiddenError('Admins cannot demote or deactivate themselves');
    }

    const target = await this.users.findById(id);
    if (!target) throw new NotFoundError('User not found');
    if (removesAdminPower && target.role === 'A' && target.active) {
      // Defense in depth (e.g. a stale actor): the system never ends up without an active admin.
      const others = (await this.users.list()).filter(
        (u) => u.id !== id && u.role === 'A' && u.active,
      );
      if (others.length === 0) throw new ConflictError('At least one active admin is required');
    }

    const updated = await this.users.mutate(id, (user) => {
      let next = user;
      if (role !== undefined) next = next.withRole(role);
      if (active !== undefined) next = next.withActive(active);
      return next;
    });
    if (!updated) throw new NotFoundError('User not found');
    // Sessions end with the account: refresh tokens die now, the access token dies at the next
    // request (the guard re-checks `active`).
    if (active === false) await this.refreshTokens.revokeAllByUser(id);
    return updated;
  }
}
