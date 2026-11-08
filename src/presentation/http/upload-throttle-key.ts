import { TokenService } from '../../application/ports/token-service';

const BEARER = /^Bearer ([^\s]+)$/;

/**
 * Throttle key for uploads. The throttler runs before the auth guard, so the token is verified
 * here (signature and expiry, never trusted blindly): a valid token gives `user:<id>`, anything
 * else falls back to the IP. A forged token therefore cannot borrow another user's bucket.
 */
export async function uploadThrottleKey(
  tokens: TokenService,
  authorization: unknown,
  ip: string | undefined,
): Promise<string> {
  const match = typeof authorization === 'string' ? BEARER.exec(authorization) : null;
  if (match) {
    try {
      const { sub } = await tokens.verifyAccess(match[1]);
      return `user:${sub}`;
    } catch {
      // Invalid or expired token: the auth guard answers 401; the limit just uses the IP.
    }
  }
  return `ip:${ip ?? 'unknown'}`;
}
