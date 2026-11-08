import { registerDecorator, ValidationOptions } from 'class-validator';
import { hasUnsafeText } from '../../../domain/validation';

export interface CleanTextOptions extends ValidationOptions {
  /** Allows TAB and LF (free text such as a description). */
  multiline?: boolean;
}

/**
 * Fails validation (400) for strings with NUL, any other control character or lone surrogates.
 * Single-line by default; `multiline` still rejects every control except TAB and LF.
 */
export function CleanText({ multiline, ...options }: CleanTextOptions = {}): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'cleanText',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: '$property contains invalid characters', ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && !hasUnsafeText(value, { multiline }),
      },
    });
  };
}
