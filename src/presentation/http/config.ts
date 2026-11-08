import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  UPLOAD_DIR: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface AppConfig {
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  uploadDir: string;
  port: number;
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
    jwtRefreshSecret: e.JWT_REFRESH_SECRET,
    uploadDir: e.UPLOAD_DIR,
    port: e.PORT,
  };
}
