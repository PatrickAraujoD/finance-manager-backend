import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  UPLOAD_DIR: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default(''),
  // 'false' (default) or the exact number of trusted proxy hops (integer >= 1).
  // 'true' and free-form values are refused: they let clients spoof X-Forwarded-For.
  TRUST_PROXY: z
    .string()
    .regex(/^(false|[1-9]\d{0,2})$/)
    .default('false'),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(20),
  LOGIN_EMAIL_THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
});

export interface AppConfig {
  databaseUrl: string;
  jwtAccessSecret: string;
  uploadDir: string;
  port: number;
  /** Allowed CORS origins; empty means CORS is disabled. */
  corsOrigins: string[];
  /** Express `trust proxy`: false or the exact number of trusted hops (>= 1). */
  trustProxy: false | number;
  throttleTtlSeconds: number;
  throttleLimit: number;
  /** Stricter per-IP limit for login, register and refresh. */
  authThrottleLimit: number;
  /** Stricter limit for login attempts per IP + normalized email. */
  loginEmailThrottleLimit: number;
}

function parseTrustProxy(raw: string): false | number {
  return raw === 'false' ? false : Number(raw);
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${keys.join(', ')}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    uploadDir: e.UPLOAD_DIR,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    throttleTtlSeconds: e.THROTTLE_TTL_SECONDS,
    throttleLimit: e.THROTTLE_LIMIT,
    authThrottleLimit: e.AUTH_THROTTLE_LIMIT,
    loginEmailThrottleLimit: e.LOGIN_EMAIL_THROTTLE_LIMIT,
  };
}
