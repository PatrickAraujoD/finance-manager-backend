import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ListUsers } from '../../../application/use-cases/users/list-users';
import { UpdateUser } from '../../../application/use-cases/users/update-user';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { UpdateUserDto } from '../dtos/users.dto';
import { toUserView, UserView } from '../views';

/** Admin only. The use cases enforce the role too; @Roles rejects early. */
@Roles('A')
@Controller('users')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsers,
    private readonly updateUser: UpdateUser,
  ) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<UserView[]> {
    return (await this.listUsers.execute(actor)).map(toUserView);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserView> {
    return toUserView(await this.updateUser.execute(actor, id, dto));
  }
}
