import { RefreshToken } from '../../../src/domain/entities/refresh-token';
import { RefreshTokenRepository } from '../../../src/application/ports/refresh-token-repository';

export class FakeRefreshTokenRepository implements RefreshTokenRepository {
  private readonly items = new Map<string, RefreshToken>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async save(token: RefreshToken): Promise<void> {
    this.items.set(token.id, token);
  }
  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    for (const t of this.items.values()) if (t.tokenHash === tokenHash) return t;
    return null;
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const [id, t] of this.items) {
      if (t.familyId === familyId && t.revokedAt === null) this.items.set(id, t.revoke(this.now()));
    }
  }
}
