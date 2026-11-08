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
} from '../decorators/strict-throttle.decorator';
import { loginThrottleKey } from '../login-throttle-key';
import { AuthModule } from './auth.module';
import { CategoriesModule } from './categories.module';
import { CoreModule } from './core.module';
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
        ThrottlerModule.forRoot({
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
          ],
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
