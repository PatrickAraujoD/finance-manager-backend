import {
  AccessTokenPayload,
  RefreshTokenPair,
  TokenService,
} from '../../../src/application/ports/token-service';
import { UnauthorizedError } from '../../../src/domain/errors';
import { parseRole } from '../../../src/domain/role';

export class FakeTokenService implements TokenService {
  private counter = 0;

  async signAccess(payload: AccessTokenPayload): Promise<string> {
    return `access:${payload.sub}:${payload.role}`;
  }
  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    const [prefix, sub, role] = token.split(':');
    if (prefix !== 'access' || !sub || !role) throw new UnauthorizedError('Invalid token');
    return { sub, role: parseRole(role) };
  }
  generateRefresh(): RefreshTokenPair {
    const token = `refresh-${++this.counter}`;
    return { token, hash: this.hashRefresh(token) };
  }
  hashRefresh(token: string): string {
    return `hash(${token})`;
  }
}
