import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../domain/errors';

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

function reason(status: number): string {
  return REASONS[status] ?? 'Error';
}

function body(status: number, message: string | string[] = reason(status)): ErrorBody {
  return { statusCode: status, error: reason(status), message };
}

/**
 * Maps every error to a safe JSON body. ValidationError is mapped to 400 (the same status as
 * the request DTO validation), not 422. Unknown errors become a generic 500: no stack, no message.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponse>();
    const { status, payload } = this.translate(exception);
    res.status(status).json(payload);
  }

  private translate(e: unknown): { status: number; payload: ErrorBody } {
    if (e instanceof ValidationError) return { status: 400, payload: body(400, e.message) };
    if (e instanceof UnauthorizedError) return { status: 401, payload: body(401) };
    if (e instanceof ForbiddenError) return { status: 403, payload: body(403) };
    if (e instanceof NotFoundError) return { status: 404, payload: body(404) };
    if (e instanceof ConflictError) return { status: 409, payload: body(409, e.message) };

    if (e instanceof BadRequestException) {
      // Pipe errors list the failing constraints (property names only, never the values).
      // Any other 400 (e.g. malformed JSON) gets the generic message: parser text is not for clients.
      const response = e.getResponse() as { message?: string | string[] };
      const message = Array.isArray(response.message) ? response.message : reason(400);
      return { status: 400, payload: body(400, message) };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return { status, payload: body(status) };
    }
    if (isBodyParserError(e)) {
      const status = e.status === 413 ? 413 : 400;
      return { status, payload: body(status) };
    }

    if (!(e instanceof DomainError)) this.logger.error(e instanceof Error ? e.stack : String(e));
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, payload: body(500) };
  }
}

function isBodyParserError(e: unknown): e is { status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { type?: unknown }).type === 'string' &&
    (e as { type: string }).type.startsWith('entity.') &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}
