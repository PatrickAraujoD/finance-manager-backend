import { ValidationError } from '../../domain/errors';

/**
 * Validates an optional bounded integer such as `limit` or `offset`: undefined falls back to
 * `fallback`, anything else must be a safe integer inside [min, max].
 */
export function toInt(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}
