import { ValidationError } from './errors';

// NUL (rejected by Postgres text columns) and unpaired UTF-16 surrogates (not valid UTF-8).
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/* eslint-disable no-control-regex -- matching control characters is the point */
const CONTROL_ONLY = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_MULTILINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
/* eslint-enable no-control-regex */

// Unicode categories: Cc controls, Cf invisible formatting (ZWSP, bidi overrides, BOM, soft
// hyphen...), Zl/Zp line and paragraph separators, Zs spaces. Property escapes, no manual list.
// U+200D (ZWJ) glues emoji sequences, so names and descriptions keep it. Variation selectors are
// Mn and never matched. Multiline kinds keep TAB (U+0009) and LF (U+000A).
const STRICT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const STRICT_MULTILINE = /(?![\t\n])\p{Cc}|[\p{Cf}\p{Zl}\p{Zp}]/u;
const NAME = /\p{Cc}|(?!\u200d)\p{Cf}|[\p{Zl}\p{Zp}]/u;
const NAME_MULTILINE = /(?![\t\n])\p{Cc}|(?!\u200d)\p{Cf}|[\p{Zl}\p{Zp}]/u;
const EMAIL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;

/**
 * What a text field may contain:
 * - `strict` (default; technical values): no Cc, Cf, Zl or Zp at all.
 * - `name` (user and category names): like strict but allows ZWJ and visible Unicode spaces.
 * - `description`: like `name` and always keeps TAB and LF.
 * - `email`: no Cc, Cf, Zl, Zp or any Unicode space (Zs), without exception.
 * - `password` (registration): only C0/C1 controls, DEL, NUL and lone surrogates are refused.
 */
export type TextKind = 'strict' | 'name' | 'description' | 'email' | 'password';

export interface TextOptions {
  kind?: TextKind;
  /** Allows TAB and LF (free text). Every other control stays rejected. */
  multiline?: boolean;
}

export function hasUnsafeText(value: string, options: TextOptions = {}): boolean {
  if (LONE_SURROGATE.test(value)) return true;
  const kind = options.kind ?? 'strict';
  const multiline = options.multiline || kind === 'description';
  switch (kind) {
    case 'password':
      return (multiline ? CONTROL_MULTILINE : CONTROL_ONLY).test(value);
    case 'email':
      return EMAIL.test(value);
    case 'name':
    case 'description':
      return (multiline ? NAME_MULTILINE : NAME).test(value);
    default:
      return (multiline ? STRICT_MULTILINE : STRICT).test(value);
  }
}

/**
 * Rejects NUL, controls, invisible or spoofing Unicode (see `TextKind`) and lone surrogates
 * (malformed strings).
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
