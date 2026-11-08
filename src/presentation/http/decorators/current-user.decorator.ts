import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../../../domain/role';

export interface AuthenticatedUser {
  id: string;
  role: Role;
}

export interface AuthenticatedRequest {
  user?: AuthenticatedUser;
  headers: Record<string, string | string[] | undefined>;
}

/** Injects the user placed on the request by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
});
