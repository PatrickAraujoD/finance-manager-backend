import { Module } from '@nestjs/common';
import { RefreshTokenRepository } from '../../../application/ports/refresh-token-repository';
import { UserRepository } from '../../../application/ports/user-repository';
import { ListUsers } from '../../../application/use-cases/users/list-users';
import { UpdateUser } from '../../../application/use-cases/users/update-user';
import { UsersController } from '../controllers/users.controller';
import { REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY } from '../tokens';

@Module({
  controllers: [UsersController],
  providers: [
    {
      provide: ListUsers,
      inject: [USER_REPOSITORY],
      useFactory: (users: UserRepository) => new ListUsers(users),
    },
    {
      provide: UpdateUser,
      inject: [USER_REPOSITORY, REFRESH_TOKEN_REPOSITORY],
      useFactory: (users: UserRepository, refreshTokens: RefreshTokenRepository) =>
        new UpdateUser(users, refreshTokens),
    },
  ],
})
export class UsersModule {}
