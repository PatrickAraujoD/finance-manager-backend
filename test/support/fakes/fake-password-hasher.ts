import { PasswordHasher } from '../../../src/application/ports/password-hasher';

/** Deterministic and reversible on purpose; never stores the plain text as-is. */
export class FakePasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return 'hashed:' + Buffer.from(plain).toString('base64');
  }
  async verify(hash: string, plain: string): Promise<boolean> {
    return hash === (await this.hash(plain));
  }
}
