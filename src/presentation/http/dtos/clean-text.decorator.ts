import { registerDecorator, ValidationOptions } from 'class-validator';
import { hasUnsafeText, TextKind } from '../../../domain/validation';

export interface CleanTextOptions extends ValidationOptions {
  /** Which Unicode classes are refused; see `TextKind` in the domain. Defaults to `strict`. */
  kind?: TextKind;
}

/**
 * Fails validation (400) for strings with NUL, controls, invisible or spoofing Unicode (per
 * `kind`) or lone surrogates.
 */
export function CleanText({ kind, ...options }: CleanTextOptions = {}): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'cleanText',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: '$property contains invalid characters', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && !hasUnsafeText(value, { kind }),
      },
    });
  };
}
