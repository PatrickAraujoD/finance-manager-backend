import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto, RefreshTokenDto, RegisterDto } from '../../../src/presentation/http/dtos/auth.dto';

const PASSWORD = 'correct horse battery';
const hostile = ['a\u0000b', 'a\ud800b', '\udc00'];

function errors<T extends object>(cls: new () => T, plain: object): string[] {
  return validateSync(plainToInstance(cls, plain)).map((e) => e.property);
}

describe('auth DTOs', () => {
  it('accepts clean input', () => {
    expect(errors(RegisterDto, { name: 'Zoë 😀', email: 'a@x.com', password: PASSWORD })).toEqual([]);
  });

  it.each(hostile)('RegisterDto.name %j', (v) => {
    expect(errors(RegisterDto, { name: v, email: 'a@x.com', password: PASSWORD })).toContain('name');
  });

  it.each(hostile)('RegisterDto.password %j', (v) => {
    expect(errors(RegisterDto, { name: 'Ana', email: 'a@x.com', password: PASSWORD + v })).toContain(
      'password',
    );
  });

  // Login passwords and refresh tokens are opaque: they only reach the hasher or a hash lookup,
  // so only their size is checked (older accounts may hold passwords with control characters).
  it.each(hostile)('LoginDto.password %j is only size checked', (v) => {
    expect(errors(LoginDto, { email: 'a@x.com', password: v })).toEqual([]);
    expect(errors(LoginDto, { email: 'a@x.com', password: 'x'.repeat(129) })).toContain('password');
  });

  it.each(hostile)('RefreshTokenDto.refreshToken %j is only size checked', (v) => {
    expect(errors(RefreshTokenDto, { refreshToken: v })).toEqual([]);
    expect(errors(RefreshTokenDto, { refreshToken: 'x'.repeat(513) })).toContain('refreshToken');
  });
});
