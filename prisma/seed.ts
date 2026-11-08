import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EnsureAdmin } from '../src/application/use-cases/users/ensure-admin';
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
): Promise<{ created: boolean }> {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (!email) throw new Error('ADMIN_EMAIL is required');
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  const useCase = new EnsureAdmin(new PrismaUserRepository(prisma), new Argon2Hasher(), {
    next: () => randomUUID(),
  });
  return useCase.execute({ email, password });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaService(databaseUrl);
  try {
    const { created } = await runSeed(process.env, prisma);
    console.log(created ? 'Admin created.' : 'Admin already exists; nothing changed.');
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
