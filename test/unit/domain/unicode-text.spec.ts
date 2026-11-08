import { Category } from '../../../src/domain/entities/category';
import { Expense } from '../../../src/domain/entities/expense';
import { User } from '../../../src/domain/entities/user';
import { Email } from '../../../src/domain/email';
import { ValidationError } from '../../../src/domain/errors';
import { Money } from '../../../src/domain/money';
import { hasUnsafeText, requireCleanText } from '../../../src/domain/validation';

// Invisible or direction changing characters that can spoof what a person reads.
const INVISIBLE: [string, string][] = [
  ['ZWSP U+200B', '\u200b'],
  ['ZWNJ U+200C', '\u200c'],
  ['WORD JOINER U+2060', '\u2060'],
  ['BOM U+FEFF', '\ufeff'],
  ['SOFT HYPHEN U+00AD', '\u00ad'],
  ['LRE U+202A', '\u202a'],
  ['RLE U+202B', '\u202b'],
  ['PDF U+202C', '\u202c'],
  ['LRO U+202D', '\u202d'],
  ['RLO U+202E', '\u202e'],
  ['LRI U+2066', '\u2066'],
  ['RLI U+2067', '\u2067'],
  ['FSI U+2068', '\u2068'],
  ['PDI U+2069', '\u2069'],
  ['ALM U+061C', '\u061c'],
  ['LRM U+200E', '\u200e'],
  ['RLM U+200F', '\u200f'],
];
const SEPARATORS: [string, string][] = [
  ['LINE SEPARATOR U+2028', '\u2028'],
  ['PARAGRAPH SEPARATOR U+2029', '\u2029'],
];
const ZWJ = '\u200d';
const FAMILY = `\u{1f468}${ZWJ}\u{1f469}${ZWJ}\u{1f467}`;
const user = { id: 'u1', email: Email.create('a@x.com'), passwordHash: 'hash', role: 'N' as const };
const expense = {
  id: 'e1',
  userId: 'u1',
  categoryId: 'c1',
  receiptId: null,
  amount: Money.fromCents(100),
  paidAlone: true,
  spentAt: new Date('2026-11-01T12:00:00Z'),
};

describe('names (user and category)', () => {
  it.each([...INVISIBLE, ...SEPARATORS])('reject %s', (_n, c) => {
    expect(() => User.create({ ...user, name: `An${c}a` })).toThrow(ValidationError);
    expect(() => Category.create({ id: 'c1', name: `Fo${c}od`, ownerId: null })).toThrow(
      ValidationError,
    );
  });

  it('accept ZWJ emoji sequences, variation selectors and accents', () => {
    expect(Category.create({ id: 'c1', name: `${FAMILY} Família`, ownerId: null }).name).toBe(
      `${FAMILY} Família`,
    );
    expect(() => User.create({ ...user, name: 'Heart \u2764\ufe0f' })).not.toThrow();
  });

  it('still collapses visible Unicode spaces in a category name', () => {
    expect(Category.create({ id: 'c1', name: 'A\u00a0\u2003 B', ownerId: null }).name).toBe('A B');
  });
});

describe('email', () => {
  const extra: [string, string][] = [
    ...INVISIBLE,
    ...SEPARATORS,
    ['ZWJ U+200D', ZWJ],
    ['MONGOLIAN VOWEL SEPARATOR U+180E', '\u180e'],
    ['EM SPACE U+2003', '\u2003'],
    ['IDEOGRAPHIC SPACE U+3000', '\u3000'],
    ['NBSP U+00A0', '\u00a0'],
  ];

  it.each(extra)('rejects %s inside the address', (_n, c) => {
    expect(() => Email.create(`a${c}b@x.com`)).toThrow(ValidationError);
    expect(() => Email.create(`ab@x${c}.com`)).toThrow(ValidationError);
  });

  it('rejects the spoofed address a<ZWSP>@x.com', () => {
    expect(() => Email.create('a\u200b@x.com')).toThrow(ValidationError);
  });

  it('keeps accepting a plain address', () => {
    expect(Email.create('Ana.Silva+x@Example.com').value).toBe('ana.silva+x@example.com');
  });
});

describe('expense description', () => {
  it.each([...INVISIBLE, ...SEPARATORS])('rejects %s', (_n, c) => {
    expect(() => Expense.create({ ...expense, description: `a${c}b` })).toThrow(ValidationError);
  });

  it('accepts TAB, LF, ZWJ emoji, accents and visible Unicode spaces', () => {
    expect(() =>
      Expense.create({ ...expense, description: `a\tb\nc ${FAMILY} Almoço\u00a0\u2003x` }),
    ).not.toThrow();
  });
});

describe('hasUnsafeText kinds', () => {
  // Typed loosely so this spec compiles (and fails for the right reason) before `kind` exists.
  const password: object = { kind: 'password' };

  it('password keeps the old rule: only controls and malformed surrogates', () => {
    expect(hasUnsafeText('a\u200bb\u202e\u2028 \u3000', password)).toBe(false);
    expect(hasUnsafeText('a\tb', password)).toBe(true);
    expect(hasUnsafeText('a\u007fb', password)).toBe(true);
    expect(hasUnsafeText('a\u0000b', password)).toBe(true);
    expect(hasUnsafeText('a\ud800b', password)).toBe(true);
  });

  it('the default text rejects Cc, Cf, Zl and Zp without exception', () => {
    expect(() => requireCleanText(`a${ZWJ}b`, 'f')).toThrow(ValidationError);
    expect(() => requireCleanText('a\u2028b', 'f')).toThrow(ValidationError);
  });
});
