import { ValidationError } from './errors';

// NUL (rejected by Postgres text columns) and unpaired UTF-16 surrogates (not valid UTF-8).
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function hasUnsafeText(value: string): boolean {
  return value.includes('\u0000') || LONE_SURROGATE.test(value);
}

/** Rejects NUL characters and lone surrogates (malformed strings) in any text field. */
export function requireCleanText(value: string, field: string): void {
  if (hasUnsafeText(value)) throw new ValidationError(`${field} contains invalid characters`);
}

export function requireNonBlank(value: string, field: string): void {
  requireCleanText(value, field);
  if (value.trim() === '') throw new ValidationError(`${field} is required`);
}
