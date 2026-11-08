import { Role } from '../../domain/role';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface RefreshTokenPair {
  /** Opaque value handed to the client; never stored. */
  token: string;
  /** Hash of `token`; the only thing persisted. */
  hash: string;
}

export interface TokenService {
  signAccess(payload: AccessTokenPayload): Promise<string>;
  /** Throws UnauthorizedError when the token is invalid or expired. */
  verifyAccess(token: string): Promise<AccessTokenPayload>;
  generateRefresh(): RefreshTokenPair;
  /** Hash of a refresh token presented by a client, for lookup. */
  hashRefresh(token: string): string;
}
