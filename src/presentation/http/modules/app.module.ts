import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from '../controllers/health.controller';
import { AppConfig } from '../config';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import {
  LOGIN_EMAIL_THROTTLE_KEY,
  STRICT_THROTTLE_KEY,
  UPLOAD_THROTTLE_KEY,
} from '../decorators/strict-throttle.decorator';
import { TokenService } from '../../../application/ports/token-service';
import { loginThrottleKey } from '../login-throttle-key';
import { uploadThrottleKey } from '../upload-throttle-key';
import { TOKEN_SERVICE } from '../tokens';
import { AuthModule } from './auth.module';
import { CategoriesModule } from './categories.module';
import { CoreModule } from './core.module';
import { IncomeModule } from './income.module';
import { ReceiptsModule } from './receipts.module';
import { UsersModule } from './users.module';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    const ttl = config.throttleTtlSeconds * 1000;
    return {
      module: AppModule,
      imports: [
        CoreModule.register(config),
        AuthModule,
        UsersModule,
        CategoriesModule,
        IncomeModule,
        ReceiptsModule,
        ThrottlerModule.forRootAsync({
          inject: [TOKEN_SERVICE],
          useFactory: (tokens: TokenService) => ({
            throttlers: [
              { name: 'default', ttl, limit: config.throttleLimit },
              {
                // Only routes marked with @StrictThrottle() (login, register, refresh).
                name: 'strict',
                ttl,
                limit: config.authThrottleLimit,
                skipIf: (ctx) => !Reflect.getMetadata(STRICT_THROTTLE_KEY, ctx.getHandler()),
              },
              {
                // Login only: IP + normalized email, so one account cannot be brute forced.
                name: 'loginEmail',
                ttl,
                limit: config.loginEmailThrottleLimit,
                skipIf: (ctx) => !Reflect.getMetadata(LOGIN_EMAIL_THROTTLE_KEY, ctx.getHandler()),
                getTracker: (req) =>
                  loginThrottleKey(
                    req.ip as string | undefined,
                    (req.body as { email?: unknown } | undefined)?.email,
                  ),
              },
              {
                // Receipt uploads only: per authenticated user (IP when anonymous).
                name: 'upload',
                ttl,
                limit: config.uploadThrottleLimit,
                skipIf: (ctx) => !Reflect.getMetadata(UPLOAD_THROTTLE_KEY, ctx.getHandler()),
                getTracker: (req) =>
                  uploadThrottleKey(tokens, req.headers?.authorization, req.ip as string | undefined),
              },
            ],
          }),
        }),
      ],
      controllers: [HealthController],
      // Order matters: throttle first, then authentication, then roles. Routes are private
      // unless marked with @Public().
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    };
  }
}
