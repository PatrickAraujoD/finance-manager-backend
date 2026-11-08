import { RefreshTokenRepository } from '../../ports/refresh-token-repository';
import { TokenService } from '../../ports/token-service';

export interface LogoutInput {
  refreshToken: string;
}

export class Logout {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  /** Idempotent: an unknown token is silently ignored so nothing leaks. */
  async execute(input: LogoutInput): Promise<void> {
    const stored = await this.refreshTokens.findByHash(this.tokens.hashRefresh(input.refreshToken));
    if (stored) await this.refreshTokens.revokeFamily(stored.familyId);
  }
}
