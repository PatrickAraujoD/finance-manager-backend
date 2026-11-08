import { Module } from '@nestjs/common';
import { Login } from '../../../application/use-cases/auth/login';
import { Logout } from '../../../application/use-cases/auth/logout';
import { RefreshSession } from '../../../application/use-cases/auth/refresh-session';
import { RegisterUser } from '../../../application/use-cases/auth/register-user';
import { Clock } from '../../../application/ports/clock';
import { IdGenerator } from '../../../application/ports/id-generator';
import { PasswordHasher } from '../../../application/ports/password-hasher';
import { RefreshTokenRepository } from '../../../application/ports/refresh-token-repository';
import { TokenService } from '../../../application/ports/token-service';
import { UserRepository } from '../../../application/ports/user-repository';
import { AuthController } from '../controllers/auth.controller';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import {
  CLOCK,
  ID_GENERATOR,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from '../tokens';

@Module({
  controllers: [AuthController],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    {
      provide: RegisterUser,
      inject: [USER_REPOSITORY, PASSWORD_HASHER, ID_GENERATOR],
      useFactory: (users: UserRepository, hasher: PasswordHasher, ids: IdGenerator) =>
        new RegisterUser(users, hasher, ids),
    },
    {
      provide: Login,
      inject: [
        USER_REPOSITORY,
        REFRESH_TOKEN_REPOSITORY,
        PASSWORD_HASHER,
        TOKEN_SERVICE,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        users: UserRepository,
        refreshTokens: RefreshTokenRepository,
        hasher: PasswordHasher,
        tokens: TokenService,
        clock: Clock,
        ids: IdGenerator,
      ) => new Login(users, refreshTokens, hasher, tokens, clock, ids),
    },
    {
      provide: RefreshSession,
      inject: [USER_REPOSITORY, REFRESH_TOKEN_REPOSITORY, TOKEN_SERVICE, CLOCK, ID_GENERATOR],
      useFactory: (
        users: UserRepository,
        refreshTokens: RefreshTokenRepository,
        tokens: TokenService,
        clock: Clock,
        ids: IdGenerator,
      ) => new RefreshSession(users, refreshTokens, tokens, clock, ids),
    },
    {
      provide: Logout,
      inject: [REFRESH_TOKEN_REPOSITORY, TOKEN_SERVICE],
      useFactory: (refreshTokens: RefreshTokenRepository, tokens: TokenService) =>
        new Logout(refreshTokens, tokens),
    },
  ],
  exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
