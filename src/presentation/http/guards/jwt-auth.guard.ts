import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../../../application/ports/token-service';
import { UserRepository } from '../../../application/ports/user-repository';
import { UnauthorizedError } from '../../../domain/errors';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TOKEN_SERVICE, USER_REPOSITORY } from '../tokens';

const BEARER = /^Bearer ([^\s]+)$/;

/** Global guard (fail-closed): verifies the access token via TokenService and re-checks the user (exists and active). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) throw new UnauthorizedError('Unauthorized');

    const payload = await this.tokens.verifyAccess(match[1]);
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('Unauthorized');

    // The role comes from the database, so a demotion applies before the token expires.
    req.user = { id: user.id, role: user.role };
    return true;
  }
}
