import { DynamicModule, Global, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../../application/ports/clock';
import { IdGenerator } from '../../../application/ports/id-generator';
import { Argon2Hasher } from '../../../infrastructure/hashing/argon2-hasher';
import { PrismaCategoryRepository } from '../../../infrastructure/prisma/prisma-category.repository';
import { PrismaRefreshTokenRepository } from '../../../infrastructure/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../../../infrastructure/prisma/prisma-user.repository';
import { JwtTokenService } from '../../../infrastructure/tokens/jwt-token-service';
import { AppConfig } from '../config';
import { NestPrismaService } from '../nest-prisma.service';
import {
  APP_CONFIG,
  CATEGORY_REPOSITORY,
  CLOCK,
  ID_GENERATOR,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from '../tokens';

const systemClock: Clock = { now: () => new Date() };
const uuidGenerator: IdGenerator = { next: () => randomUUID() };

/** Binds every port to its adapter. Global so guards and use cases resolve them anywhere. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: NestPrismaService, useFactory: () => new NestPrismaService(config.databaseUrl) },
        { provide: CLOCK, useValue: systemClock },
        { provide: ID_GENERATOR, useValue: uuidGenerator },
        { provide: PASSWORD_HASHER, useFactory: () => new Argon2Hasher() },
        {
          provide: TOKEN_SERVICE,
          useFactory: () =>
            new JwtTokenService({ secret: config.jwtAccessSecret, clock: systemClock }),
        },
        {
          provide: USER_REPOSITORY,
          inject: [NestPrismaService],
          useFactory: (prisma: NestPrismaService) => new PrismaUserRepository(prisma),
        },
        {
          provide: CATEGORY_REPOSITORY,
          inject: [NestPrismaService],
          useFactory: (prisma: NestPrismaService) => new PrismaCategoryRepository(prisma),
        },
        {
          provide: REFRESH_TOKEN_REPOSITORY,
          inject: [NestPrismaService],
          useFactory: (prisma: NestPrismaService) => new PrismaRefreshTokenRepository(prisma),
        },
      ],
      exports: [
        APP_CONFIG,
        CLOCK,
        ID_GENERATOR,
        PASSWORD_HASHER,
        TOKEN_SERVICE,
        USER_REPOSITORY,
        CATEGORY_REPOSITORY,
        REFRESH_TOKEN_REPOSITORY,
      ],
    };
  }
}
