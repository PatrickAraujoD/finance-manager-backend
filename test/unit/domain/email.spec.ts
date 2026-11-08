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
