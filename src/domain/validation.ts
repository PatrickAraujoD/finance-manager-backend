import { ValidationError } from './errors';

// NUL (rejected by Postgres text columns) and unpaired UTF-16 surrogates (not valid UTF-8).
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// C0 and C1 controls plus DEL. Multiline text keeps TAB (U+0009) and LF (U+000A).
/* eslint-disable no-control-regex -- matching control characters is the point */
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_MULTILINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
/* eslint-enable no-control-regex */

export interface TextOptions {
  /** Allows TAB and LF (free text such as a description). Every other control stays rejected. */
  multiline?: boolean;
}

export function hasUnsafeText(value: string, options: TextOptions = {}): boolean {
  const control = options.multiline ? CONTROL_MULTILINE : CONTROL_SINGLE_LINE;
  return control.test(value) || LONE_SURROGATE.test(value);
}

/**
 * Rejects NUL, every other C0/C1 control character (and DEL) and lone surrogates (malformed
 * strings). Single-line by default; `multiline` also allows TAB and LF.
 */
export function requireCleanText(value: string, field: string, options: TextOptions = {}): void {
  if (hasUnsafeText(value, options)) {
    throw new ValidationError(`${field} contains invalid characters`);
  }
}

export function requireNonBlank(value: string, field: string, options: TextOptions = {}): void {
  requireCleanText(value, field, options);
  if (value.trim() === '') throw new ValidationError(`${field} is required`);
}
