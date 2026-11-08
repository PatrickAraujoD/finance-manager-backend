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
// ZWNJ (U+200C) is Cf too, but it is handled apart (see `hasMisplacedZwnj`): excluded here.
const NAME = /\p{Cc}|(?![\u200c\u200d])\p{Cf}|[\p{Zl}\p{Zp}]/u;
const NAME_MULTILINE = /(?![\t\n])\p{Cc}|(?![\u200c\u200d])\p{Cf}|[\p{Zl}\p{Zp}]/u;

/**
 * Scripts whose orthography needs the zero width non-joiner (half space in Persian, Urdu and
 * Kurdish; chillu and conjunct control in Indic scripts; Thai, Khmer and Myanmar word breaks).
 * `scx` (Script_Extensions) also covers combining marks that Unicode files under several scripts.
 */
const ZWNJ_SCRIPT =
  /^(?=[\p{L}\p{M}])[\p{scx=Arabic}\p{scx=Hebrew}\p{scx=Syriac}\p{scx=Thaana}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]$/u;

/**
 * True when a ZWNJ is not strictly between two letters or marks of the scripts above: at the
 * start or end, doubled, next to a space or digit, or next to a Latin, Cyrillic or Greek letter
 * (where it would only hide a look-alike text).
 */
function hasMisplacedZwnj(value: string): boolean {
  const chars = Array.from(value);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\u200c') continue;
    const before = chars[i - 1];
    const after = chars[i + 1];
    if (before === undefined || after === undefined) return true;
    if (!ZWNJ_SCRIPT.test(before) || !ZWNJ_SCRIPT.test(after)) return true;
  }
  return false;
}
// Also Default_Ignorable_Code_Point (CGJ, Hangul fillers, variation selectors, tags...) and the
// Braille blank U+2800, which render as nothing but are not Cc/Cf/Zs.
const EMAIL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * What a text field may contain:
 * - `strict` (default; technical values): no Cc, Cf, Zl or Zp at all.
 * - `name` (user and category names): like strict but allows ZWJ, visible Unicode spaces and ZWNJ
 *   only between two letters/marks of non Latin scripts (Persian, Indic, Thai...).
 * - `description`: like `name` and always keeps TAB and LF.
 * - `email`: no Cc, Cf, Zl, Zp, Zs, Default_Ignorable_Code_Point or U+2800, without exception.
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
      return (multiline ? NAME_MULTILINE : NAME).test(value) || hasMisplacedZwnj(value);
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
