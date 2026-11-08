import { ValidationError } from '../../../src/domain/errors';
import { parseRole } from '../../../src/domain/role';

describe('parseRole', () => {
  it('accepts A and N', () => {
    expect(parseRole('A')).toBe('A');
    expect(parseRole('N')).toBe('N');
  });

  it.each(['', 'a', 'X', 'admin'])('rejects %p', (v) => {
    expect(() => parseRole(v)).toThrow(ValidationError);
  });
});
