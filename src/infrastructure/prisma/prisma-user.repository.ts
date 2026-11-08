import { Prisma, User as UserRow } from '@prisma/client';
import { UserRepository } from '../../application/ports/user-repository';
import { Email } from '../../domain/email';
import { User } from '../../domain/entities/user';
import { ConflictError } from '../../domain/errors';
import { parseRole } from '../../domain/role';
import { PrismaService } from './prisma.service';

const EMAIL_TAKEN_MESSAGE = 'Email already registered';

function toDomain(row: UserRow): User {
  return User.create({
    id: row.id,
    name: row.name,
    email: Email.create(row.email),
    passwordHash: row.passwordHash,
    role: parseRole(row.role),
    active: row.active,
    failedLogins: row.failedLogins,
    lockedUntil: row.lockedUntil,
  });
}

function toData(user: User) {
  return {
    name: user.name,
    email: user.email.value,
    passwordHash: user.passwordHash,
    role: user.role,
    active: user.active,
    failedLogins: user.failedLogins,
    lockedUntil: user.lockedUntil,
  };
}

function isEmailConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('email') : String(target).includes('email');
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(user: User): Promise<void> {
    const data = toData(user);
    try {
      await this.prisma.client.user.upsert({
        where: { id: user.id },
        create: { id: user.id, ...data },
        update: data,
      });
    } catch (error) {
      if (isEmailConflict(error)) throw new ConflictError(EMAIL_TAKEN_MESSAGE);
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.client.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.prisma.client.user.findUnique({ where: { email: email.value } });
    return row ? toDomain(row) : null;
  }

  async list(): Promise<User[]> {
    const rows = await this.prisma.client.user.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }

  async mutate(id: string, fn: (user: User) => User): Promise<User | null> {
    return this.prisma.client.$transaction(async (tx) => {
      // Row lock: concurrent mutations of the same user queue up and each sees the latest state.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.user.findUnique({ where: { id } });
      if (!row) return null;
      const updated = fn(toDomain(row));
      try {
        await tx.user.update({ where: { id }, data: toData(updated) });
      } catch (error) {
        if (isEmailConflict(error)) throw new ConflictError(EMAIL_TAKEN_MESSAGE);
        throw error;
      }
      return updated;
    });
  }
}
