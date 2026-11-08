import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from '../controllers/health.controller';
import { AppConfig } from '../config';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { STRICT_THROTTLE_KEY } from '../decorators/strict-throttle.decorator';
import { AuthModule } from './auth.module';
import { CoreModule } from './core.module';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    const ttl = config.throttleTtlSeconds * 1000;
    return {
      module: AppModule,
      imports: [
        CoreModule.register(config),
        AuthModule,
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
