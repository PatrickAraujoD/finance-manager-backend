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

/** Builds a new refresh token entity (hash only) in `familyId`, plus the plain token to hand out. */
export function buildRefreshToken(
  tokens: TokenService,
  params: { userId: string; tokenId: string; familyId: string; now: Date },
): { entity: RefreshToken; plain: string } {
  const refresh = tokens.generateRefresh();
  const entity = RefreshToken.create({
    id: params.tokenId,
    userId: params.userId,
    familyId: params.familyId,
    tokenHash: refresh.hash,
    expiresAt: new Date(params.now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000),
  });
  return { entity, plain: refresh.token };
}

/** Persists a new refresh token (hash only) in `familyId` and signs the matching access token. */
export async function issueSession(
  deps: IssueSessionDeps,
  params: { user: User; tokenId: string; familyId: string; now: Date },
): Promise<SessionTokens> {
  const { user, tokenId, familyId, now } = params;
  const refresh = buildRefreshToken(deps.tokens, { userId: user.id, tokenId, familyId, now });
  await deps.refreshTokens.save(refresh.entity);
  const accessToken = await deps.tokens.signAccess({ sub: user.id, role: user.role });
  return { accessToken, refreshToken: refresh.plain };
}
