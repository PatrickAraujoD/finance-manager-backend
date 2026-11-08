import { RefreshToken } from '../../domain/entities/refresh-token';

export interface RefreshTokenRepository {
  save(token: RefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * Atomically, in a single transaction: revokes `oldId` only if it is still active and stores
   * `replacement`. Returns true when it rotated. Returns false, storing nothing, when the old token
   * was already revoked or does not exist. If storing the replacement fails, nothing is revoked.
   */
  rotate(oldId: string, replacement: RefreshToken, now: Date): Promise<boolean>;
  /** Revokes every non-revoked token of the family. */
  revokeFamily(familyId: string): Promise<void>;
  /** Revokes every non-revoked token of the user (e.g. when the user is deactivated). */
  revokeAllByUser(userId: string): Promise<void>;
}
