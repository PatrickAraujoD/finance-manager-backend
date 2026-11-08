import { domainToASCII } from 'node:url';
import isEmail from 'validator/lib/isEmail';
import { ValidationError } from './errors';
import { requireCleanText } from './validation';

const MAX_LENGTH = 254;

/**
 * Puts the domain in punycode (input is already NFKC, trimmed and lowercase). Returns null when
 * the domain cannot be converted. It does not judge the rest; `Email.create` does.
 */
function canonicalize(text: string): string | null {
  const at = text.lastIndexOf('@');
  if (at < 0) return text;
  const domain = domainToASCII(text.slice(at + 1));
  if (domain === '') return null;
  return `${text.slice(0, at)}@${domain}`;
}

function unicodeNormalize(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase().normalize('NFKC');
}

/** Same canonical form as `Email.create` without throwing; for keys built from untrusted input. */
export function normalizeEmailText(raw: string): string {
  const text = unicodeNormalize(raw);
  return canonicalize(text) ?? text;
}

/** Addresses are stored in the canonical form, so the same mailbox is always the same account. */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const text = unicodeNormalize(raw);
    // Before the punycode conversion: IDNA mapping silently drops ignorable characters.
    requireCleanText(text, 'Email', { kind: 'email' });
    const normalized = canonicalize(text);
    if (normalized === null) throw new ValidationError('Invalid email');
    if (normalized.length > MAX_LENGTH || !isEmail(normalized)) {
      throw new ValidationError('Invalid email');
    }
    return new Email(normalized);
  }
}
