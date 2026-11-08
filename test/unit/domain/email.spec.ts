import { Email } from '../../../src/domain/email';
import { ValidationError } from '../../../src/domain/errors';

describe('Email', () => {
  it('normalizes to lowercase and trims', () => {
    expect(Email.create('  A@X.com ').value).toBe('a@x.com');
  });

  it.each(['', 'abc', 'a@', '@x.com', 'a b@x.com'])('rejects %p', (raw) => {
    expect(() => Email.create(raw)).toThrow(ValidationError);
  });
});

describe('Email normalization', () => {
  const NFC = 'café@x.com';
  const NFD = 'café@x.com';

  it('NFC and NFD spellings become the same address', () => {
    expect(Email.create(NFD).value).toBe(Email.create(NFC).value);
    expect(Email.create(NFD).value).toBe(NFC);
  });

  it('full width characters become their ASCII form', () => {
    expect(Email.create('ａ@x.com').value).toBe('a@x.com');
    expect(Email.create('a@ｘ.com').value).toBe('a@x.com');
  });

  it('an IDN domain becomes punycode, the same address as the punycode spelling', () => {
    expect(Email.create('user@münchen.de').value).toBe('user@xn--mnchen-3ya.de');
    expect(Email.create('user@xn--mnchen-3ya.de').value).toBe('user@xn--mnchen-3ya.de');
    expect(Email.create('user@MÜNCHEN.de').value).toBe('user@xn--mnchen-3ya.de');
  });

  it('keeps accepting accented local parts, normalized', () => {
    expect(Email.create('  José@Exemplo.com ').value).toBe('josé@exemplo.com');
  });

  it('is idempotent (a stored value normalizes to itself)', () => {
    const once = Email.create('Ana.Silva+x@München.de').value;
    expect(Email.create(once).value).toBe(once);
  });

  it.each([
    ['COMBINING GRAPHEME JOINER U+034F', '͏'],
    ['HANGUL CHOSEONG FILLER U+115F', 'ᅟ'],
    ['HANGUL FILLER U+3164', 'ㅤ'],
    ['BRAILLE BLANK U+2800', '⠀'],
    ['MONGOLIAN FVS1 U+180B', '᠋'],
    ['VARIATION SELECTOR-16 U+FE0F', '️'],
    ['VARIATION SELECTOR-1 U+FE00', '︀'],
    ['TAG SPACE U+E0020', '\u{e0020}'],
  ])('rejects %s in the local part and in the domain', (_n, c) => {
    expect(() => Email.create(`a${c}b@x.com`)).toThrow(ValidationError);
    expect(() => Email.create(`ab@x${c}.com`)).toThrow(ValidationError);
  });

  it.each(['a@xn--.com', 'a@-.com', 'a@😀..com', 'a@.com', 'a@x', 'a@@x.com'])(
    'rejects the invalid domain in %p',
    (raw) => {
      expect(() => Email.create(raw)).toThrow(ValidationError);
    },
  );
});
