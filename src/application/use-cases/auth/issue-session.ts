import { RefreshToken } from '../../../domain/entities/refresh-token';
import { User } from '../../../domain/entities/user';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository';
import { TokenService } from '../../ports/token-service';

export const REFRESH_TOKEN_TTL_DAYS = 7;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface IssueSessionDeps {
  refreshTokens: RefreshTokenRepository;
  tokens: TokenService;
}

/** Persists a new refresh token (hash only) in `familyId` and signs the matching access token. */
export async function issueSession(
  deps: IssueSessionDeps,
  params: { user: User; tokenId: string; familyId: string; now: Date },
): Promise<SessionTokens> {
  const { user, tokenId, familyId, now } = params;
  const refresh = deps.tokens.generateRefresh();
  await deps.refreshTokens.save(
    RefreshToken.create({
      id: tokenId,
      userId: user.id,
      familyId,
      tokenHash: refresh.hash,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000),
    }),
  );
  const accessToken = await deps.tokens.signAccess({ sub: user.id, role: user.role });
  return { accessToken, refreshToken: refresh.token };
}
