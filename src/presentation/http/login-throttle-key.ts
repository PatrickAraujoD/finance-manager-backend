import { createHash } from 'node:crypto';

const MAX_EMAIL_LENGTH = 254;

/**
 * Throttle key for login: IP + normalized email. The email comes from an untrusted body, so it
 * is truncated and hashed: the key has a fixed size and cannot be used to inflate memory.
 */
export function loginThrottleKey(ip: string | undefined, email: unknown): string {
  const normalized =
    typeof email === 'string' ? email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH) : '';
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `${ip ?? 'unknown'}|${digest}`;
}
