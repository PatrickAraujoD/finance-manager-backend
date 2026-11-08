import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EnsureAdmin, EnsureAdminResult } from '../src/application/use-cases/users/ensure-admin';
import { Argon2Hasher } from '../src/infrastructure/hashing/argon2-hasher';
import { PrismaUserRepository } from '../src/infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/**
 * Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. Idempotent: an existing account is
 * never changed. The password is never logged.
 */
export async function runSeed(
  env: Record<string, string | undefined>,
  prisma: PrismaService,
): Promise<EnsureAdminResult> {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (!email) throw new Error('ADMIN_EMAIL is required');
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  const useCase = new EnsureAdmin(new PrismaUserRepository(prisma), new Argon2Hasher(), {
    next: () => randomUUID(),
  });
  return useCase.execute({ email, password });
}

/**
 * Runs the seed and returns the process exit code: 0 when the admin was created or already is an
 * active admin; 1 when the e-mail belongs to an account that is not an active admin (never
 * promoted automatically). The password is never logged.
 */
export async function runSeedCli(
  env: Record<string, string | undefined>,
  prisma: PrismaService,
  log: (message: string) => void = console.log,
): Promise<number> {
  const { state } = await runSeed(env, prisma);
  if (state === 'created') log('Admin created.');
  else if (state === 'admin-exists') log('Admin already exists; nothing changed.');
  else {
    log('Account exists but is not an active admin; promote it manually. Nothing was changed.');
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaService(databaseUrl);
  try {
    process.exitCode = await runSeedCli(process.env, prisma);
  } finally {
    await prisma.disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : 'unknown error');
    process.exit(1);
  });
}
