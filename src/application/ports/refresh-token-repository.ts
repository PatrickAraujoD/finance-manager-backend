import { RefreshToken } from '../../domain/entities/refresh-token';

export interface RefreshTokenRepository {
  save(token: RefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /** Revokes every non-revoked token of the family. */
  revokeFamily(familyId: string): Promise<void>;
  /** Revokes every non-revoked token of the user (e.g. when the user is deactivated). */
  revokeAllByUser(userId: string): Promise<void>;
}
