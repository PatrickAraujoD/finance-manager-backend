import { UnauthorizedError } from '../../../domain/errors';
import { Clock } from '../../ports/clock';
import { IdGenerator } from '../../ports/id-generator';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository';
import { TokenService } from '../../ports/token-service';
import { UserRepository } from '../../ports/user-repository';
import { buildRefreshToken, SessionTokens } from './issue-session';
import { INVALID_CREDENTIALS_MESSAGE } from './login';

export interface RefreshSessionInput {
  refreshToken: string;
}

export class RefreshSession {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: RefreshSessionInput): Promise<SessionTokens> {
    const stored = await this.refreshTokens.findByHash(this.tokens.hashRefresh(input.refreshToken));
    if (!stored) throw this.invalid();

    if (stored.revokedAt !== null) {
      // A rotated token showing up again means it leaked: burn the whole family.
      await this.refreshTokens.revokeFamily(stored.familyId);
      throw this.invalid();
    }
    const now = this.clock.now();
    if (stored.expiresAt.getTime() <= now.getTime()) throw this.invalid();

    const user = await this.users.findById(stored.userId);
    if (!user || !user.active) {
      await this.refreshTokens.revokeAllByUser(stored.userId);
      throw this.invalid();
    }

    // Sign first: if it fails, nothing was rotated and the session is not lost.
    const accessToken = await this.tokens.signAccess({ sub: user.id, role: user.role });
    const next = buildRefreshToken(this.tokens, {
      userId: user.id,
      tokenId: this.ids.next(),
      familyId: stored.familyId,
      now,
    });
    // Atomic rotation: if a concurrent refresh already consumed this token, treat it as reuse.
    if (!(await this.refreshTokens.rotate(stored.id, next.entity, now))) {
      await this.refreshTokens.revokeFamily(stored.familyId);
      throw this.invalid();
    }
    return { accessToken, refreshToken: next.plain };
  }

  private invalid(): UnauthorizedError {
    return new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }
}
