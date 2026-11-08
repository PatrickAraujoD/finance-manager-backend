import isEmail from 'validator/lib/isEmail';
import { ValidationError } from './errors';

export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!isEmail(normalized)) {
      throw new ValidationError('Invalid email');
    }
    return new Email(normalized);
  }
}
