import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service';
import { configureApp } from '../../../src/presentation/http/app';
import { AppConfig } from '../../../src/presentation/http/config';
import { AppModule } from '../../../src/presentation/http/modules/app.module';
import { testDatabaseUrl } from '../../integration/support/test-database';

export const ACCESS_SECRET = 'a'.repeat(48);

/** Config for e2e: real test database and throttling loose enough not to disturb other tests. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    databaseUrl: testDatabaseUrl(),
    jwtAccessSecret: ACCESS_SECRET,
    jwtRefreshSecret: 'b'.repeat(48),
    uploadDir: './uploads',
    port: 0,
    corsOrigins: [],
    trustProxy: false,
    throttleTtlSeconds: 60,
    throttleLimit: 10_000,
    authThrottleLimit: 10_000,
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close(): Promise<void>;
}

/** Boots the real app on the test database; `controllers` adds probe controllers for a test. */
export async function startApp(
  overrides: Partial<AppConfig> = {},
  controllers: Type[] = [],
): Promise<TestApp> {
  const config = testConfig(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  const prisma = new PrismaService(config.databaseUrl);
  await prisma.connect();
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await prisma.disconnect();
    },
  };
}

export async function cleanTables(prisma: PrismaService): Promise<void> {
  await prisma.client.$executeRawUnsafe('TRUNCATE TABLE "RefreshToken", "User" CASCADE');
}
