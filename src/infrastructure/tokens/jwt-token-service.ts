import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { Clock } from "../../application/ports/clock";
import {
  AccessTokenPayload,
  RefreshTokenPair,
  TokenService,
} from "../../application/ports/token-service";
import { UnauthorizedError } from "../../domain/errors";
import { parseRole } from "../../domain/role";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MIN_SECRET_LENGTH = 32;
const REFRESH_TOKEN_BYTES = 48;

export interface JwtTokenServiceOptions {
  secret: string;
  clock: Clock;
}

export class JwtTokenService implements TokenService {
  private readonly secret: string;
  private readonly clock: Clock;

  constructor(options: JwtTokenServiceOptions) {
    if (options.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT secret must have at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    this.secret = options.secret;
    this.clock = options.clock;
  }

  async signAccess(payload: AccessTokenPayload): Promise<string> {
    const iat = this.nowSeconds();
    return jwt.sign({ role: payload.role, iat }, this.secret, {
      algorithm: "HS256",
      subject: payload.sub,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
        clockTimestamp: this.nowSeconds(),
      });
      if (
        typeof decoded === "string" ||
        typeof decoded.exp !== "number" ||
        typeof decoded.sub !== "string" ||
        !decoded.sub
      ) {
        throw new UnauthorizedError("Invalid token");
      }
      return { sub: decoded.sub, role: parseRole(String(decoded.role)) };
    } catch {
      // Any failure (bad signature, expiry, wrong alg, bad claims) looks the same to callers.
      throw new UnauthorizedError("Invalid token");
    }
  }

  generateRefresh(): RefreshTokenPair {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }
}
