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
  UPLOAD_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
  // Server timeouts in milliseconds, bounded so a typo cannot disable them (0 means "never").
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(5_000),
});

/** Marker texts of example values; a secret containing any of them was never generated. */
const PLACEHOLDER_MARKERS = [
  'troque-por',
  'change-me',
  'changeme',
  'replace-me',
  'replace-this',
  'your-secret',
  'your_secret',
  'placeholder',
  'example',
];
const MIN_DISTINCT_SECRET_CHARS = 10;

/** True for a copied example value or a trivially repetitive secret. Never logs the value. */
function isWeakSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) return true;
  return new Set(secret).size < MIN_DISTINCT_SECRET_CHARS;
}

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
  /** Receipt uploads per user (IP when anonymous) in the throttle window. */
  uploadThrottleLimit: number;
  /** Max time to receive a whole request (headers and body); slow uploads beyond it are cut. */
  requestTimeoutMs: number;
  /** Max time to receive the request headers (slowloris defence). */
  headersTimeoutMs: number;
  /** How long an idle keep-alive connection stays open. */
  keepAliveTimeoutMs: number;
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
  if (e.HEADERS_TIMEOUT_MS > e.REQUEST_TIMEOUT_MS) {
    throw new Error('Invalid environment configuration: HEADERS_TIMEOUT_MS');
  }
  if (isWeakSecret(e.JWT_ACCESS_SECRET)) {
    throw new Error(
      'Invalid environment configuration: JWT_ACCESS_SECRET is a placeholder or too simple; ' +
        'generate one with: openssl rand -base64 48',
    );
  }
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
    uploadThrottleLimit: e.UPLOAD_THROTTLE_LIMIT,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    headersTimeoutMs: e.HEADERS_TIMEOUT_MS,
    keepAliveTimeoutMs: e.KEEP_ALIVE_TIMEOUT_MS,
  };
}
