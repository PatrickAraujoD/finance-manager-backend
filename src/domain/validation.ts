import { ValidationError } from './errors';

export function requireNonBlank(value: string, field: string): void {
  if (value.trim() === '') throw new ValidationError(`${field} is required`);
}
