import { registerDecorator, ValidationOptions } from 'class-validator';
import { hasUnsafeText } from '../../../domain/validation';

/** Fails validation (400) for strings with NUL or lone surrogates. */
export function CleanText(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'cleanText',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: '$property contains invalid characters', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && !hasUnsafeText(value),
      },
    });
  };
}
