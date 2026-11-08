import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service';
import { testDatabaseUrl } from './test-database';

export function createPrismaService(): PrismaService {
  return new PrismaService(testDatabaseUrl());
}

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.client.$executeRawUnsafe('TRUNCATE TABLE "Expense", "Category", "RefreshToken", "User" CASCADE');
}
