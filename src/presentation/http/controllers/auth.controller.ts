import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common';
import { UserRepository } from '../../../application/ports/user-repository';
import { Login } from '../../../application/use-cases/auth/login';
import { Logout } from '../../../application/use-cases/auth/logout';
import { RefreshSession } from '../../../application/use-cases/auth/refresh-session';
import { RegisterUser } from '../../../application/use-cases/auth/register-user';
import { UnauthorizedError } from '../../../domain/errors';
import { Role } from '../../../domain/role';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { StrictThrottle } from '../decorators/strict-throttle.decorator';
import { LoginDto, RefreshTokenDto, RegisterDto } from '../dtos/auth.dto';
import { USER_REPOSITORY } from '../tokens';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly login: Login,
    private readonly refreshSession: RefreshSession,
    private readonly logoutUser: Logout,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  @Public()
  @Post('register')
  @StrictThrottle()
  register(@Body() dto: RegisterDto): Promise<{ id: string }> {
    return this.registerUser.execute(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @StrictThrottle()
  signIn(@Body() dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.login.execute(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @StrictThrottle()
  refresh(@Body() dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.refreshSession.execute(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logoutUser.execute(dto);
  }

  @Get('me')
  async me(
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<{ id: string; name: string; email: string; role: Role }> {
    const user = await this.users.findById(current.id);
    if (!user) throw new UnauthorizedError('Unauthorized');
    return { id: user.id, name: user.name, email: user.email.value, role: user.role };
  }
}
