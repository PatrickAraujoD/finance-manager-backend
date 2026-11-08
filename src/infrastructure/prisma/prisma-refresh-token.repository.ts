import { RefreshToken as RefreshTokenRow } from '@prisma/client';
import { RefreshTokenRepository } from '../../application/ports/refresh-token-repository';
import { RefreshToken } from '../../domain/entities/refresh-token';
import { PrismaService } from './prisma.service';

function toDomain(row: RefreshTokenRow): RefreshToken {
  return RefreshToken.create({
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  });
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(token: RefreshToken): Promise<void> {
    const data = {
      userId: token.userId,
      familyId: token.familyId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
    };
    await this.prisma.client.refreshToken.upsert({
      where: { id: token.id },
      create: { id: token.id, ...data },
      update: data,
    });
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.prisma.client.refreshToken.findUnique({ where: { tokenHash } });
    return row ? toDomain(row) : null;
  }

  async revokeIfActive(id: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.client.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
    return count === 1;
  }

  async rotate(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllByUser(userId: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
