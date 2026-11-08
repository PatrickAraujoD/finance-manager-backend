import isEmail from 'validator/lib/isEmail';
import { ValidationError } from './errors';
import { requireCleanText } from './validation';

export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    // Surrounding whitespace (including a stray newline) is trimmed, as before; inside, no control.
    const normalized = raw.trim().toLowerCase();
    requireCleanText(normalized, 'Email', { kind: 'email' });
    if (!isEmail(normalized)) {
      throw new ValidationError('Invalid email');
    }
    return new Email(normalized);
  }
}
