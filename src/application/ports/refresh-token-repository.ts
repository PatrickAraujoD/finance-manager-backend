import { RefreshToken } from '../../domain/entities/refresh-token';

export interface RefreshTokenRepository {
  save(token: RefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * Atomically revokes the token only if it is not revoked yet (a conditional update such as
   * `UPDATE ... WHERE id = $1 AND revokedAt IS NULL`). Returns true when this call revoked it, and
   * false when it was already revoked or does not exist. Business rules stay in the use cases; the
   * repository only guarantees that of N concurrent calls exactly one returns true.
   */
  revokeIfActive(id: string, now: Date): Promise<boolean>;
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
