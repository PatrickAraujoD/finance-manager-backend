import { Argon2Hasher } from '../../../src/infrastructure/hashing/argon2-hasher';
import { DUMMY_HASH } from '../../../src/application/use-cases/auth/login';

describe('Argon2Hasher', () => {
  const hasher = new Argon2Hasher();

  it('produces an argon2id hash that is not the plain text and verifies', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong horse battery')).toBe(false);
  });

  it('salts: hashing twice gives different hashes', async () => {
    expect(await hasher.hash('same-password-123')).not.toBe(await hasher.hash('same-password-123'));
  });

  it('returns false instead of throwing for malformed hashes', async () => {
    for (const bad of ['', 'garbage', '$argon2id$broken', '$argon2id$v=19$m=1,t=1,p=1$x$y']) {
      expect(await hasher.verify(bad, 'whatever-password')).toBe(false);
    }
  });

  it('uses parameters matching the dummy hash used against unknown users', async () => {
    const real = await hasher.hash('x'.repeat(12));
    const params = (h: string) => h.split('$')[3];
    expect(params(DUMMY_HASH)).toBe(params(real));
    expect(await hasher.verify(DUMMY_HASH, 'anything-at-all')).toBe(false);
  });
});
