import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { adminDatabaseUrl, testDatabaseUrl } from './test-database';

export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);

  const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl(url) } } });
  try {
    const rows = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
