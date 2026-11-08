import { Email } from '../../../domain/email';
import { RefreshToken } from '../../../domain/entities/refresh-token';
import { User } from '../../../domain/entities/user';
import { UnauthorizedError, ValidationError } from '../../../domain/errors';
import { Clock } from '../../ports/clock';
import { IdGenerator } from '../../ports/id-generator';
import { PasswordHasher } from '../../ports/password-hasher';
import { RefreshTokenRepository } from '../../ports/refresh-token-repository';
import { TokenService } from '../../ports/token-service';
import { UserRepository } from '../../ports/user-repository';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

/**
 * Real argon2id hash (default parameters) of a throwaway password. Verified against when the user
 * does not exist so that unknown and known emails cost about the same time.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$0Foep1JX+6qUZHxgsIpvQA$FlSdHAhsigy+k/KZPUOrlXvkNyQAmDjg6eHveh9UsbE';

export interface LoginInput {
  email: string;
  password: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export class Login {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: LoginInput): Promise<SessionTokens> {
    const user = await this.findUser(input.email);
    if (!user) {
      await this.hasher.verify(DUMMY_HASH, input.password);
      throw this.invalid();
    }
    const now = this.clock.now();
    if (user.isLocked(now)) throw this.invalid();

    const passwordOk = await this.hasher.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.users.save(user.registerFailedLogin(now, MAX_FAILED_LOGINS, LOCK_MINUTES));
      throw this.invalid();
    }
    if (!user.active) throw this.invalid();

    if (user.failedLogins > 0 || user.lockedUntil !== null) {
      await this.users.save(user.resetFailedLogins());
    }
    return this.issueSession(user, now);
  }

  private async findUser(rawEmail: string): Promise<User | null> {
    try {
      return await this.users.findByEmail(Email.create(rawEmail));
    } catch (e) {
      if (e instanceof ValidationError) return null;
      throw e;
    }
  }

  private async issueSession(user: User, now: Date): Promise<SessionTokens> {
    const refresh = this.tokens.generateRefresh();
    await this.refreshTokens.save(
      RefreshToken.create({
        id: this.ids.next(),
        userId: user.id,
        familyId: this.ids.next(),
        tokenHash: refresh.hash,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000),
      }),
    );
    const accessToken = await this.tokens.signAccess({ sub: user.id, role: user.role });
    return { accessToken, refreshToken: refresh.token };
  }

  private invalid(): UnauthorizedError {
    return new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }
}
