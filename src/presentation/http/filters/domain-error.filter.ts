import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { MulterError } from 'multer';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  StoredFileMissingError,
  UnauthorizedError,
  ValidationError,
} from '../../../domain/errors';

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
  headersSent?: boolean;
  writableEnded?: boolean;
  socket?: { destroyed?: boolean } | null;
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
    // After an abort the socket is gone (or the response already went out): nothing to write.
    if (res.headersSent || res.writableEnded || res.socket?.destroyed) return;
    res.status(status).json(payload);
  }

  private translate(e: unknown): { status: number; payload: ErrorBody } {
    if (e instanceof ValidationError) return { status: 400, payload: body(400, e.message) };
    if (e instanceof UnauthorizedError) return { status: 401, payload: body(401) };
    if (e instanceof ForbiddenError) return { status: 403, payload: body(403) };
    if (e instanceof StoredFileMissingError) {
      // The client only sees a plain 404; the operator learns that a file is gone (no path).
      this.logger.warn(e.message);
      return { status: 404, payload: body(404) };
    }
    if (e instanceof NotFoundError) return { status: 404, payload: body(404) };
    if (e instanceof ConflictError) return { status: 409, payload: body(409, e.message) };

    if (e instanceof MulterError) {
      // The message and field name come from the client: never echoed.
      const status = e.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return { status, payload: body(status) };
    }

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
    if (isRequestAborted(e) || isBodyAborted(e)) {
      // The client went away mid-upload: not a server fault, so no stack and no ERROR.
      this.logger.warn('Request aborted by the client');
      return { status: 400, payload: body(400) };
    }
    if (isBodyParserError(e)) {
      const status = e.status === 413 ? 413 : 400;
      return { status, payload: body(status) };
    }

    if (!(e instanceof DomainError)) this.logger.error(e instanceof Error ? e.stack : String(e));
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, payload: body(500) };
  }
}

/** multer raises a plain `Error('Request aborted')` (not a MulterError) when the client hangs up. */
function isRequestAborted(e: unknown): boolean {
  return e instanceof Error && e.message === 'Request aborted';
}

function bodyErrorType(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const { type, status } = e as { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' ? type : null;
}

/** raw-body: the client hung up mid-body (or the server closed a stalled one by timeout). */
function isBodyAborted(e: unknown): boolean {
  return bodyErrorType(e) === 'request.aborted';
}

// Errors body-parser/raw-body raise because of what the client sent; none is a server fault.
const CLIENT_BODY_ERRORS = new Set([
  'request.size.invalid',
  'encoding.unsupported',
  'charset.unsupported',
]);

function isBodyParserError(e: unknown): e is { status: number } {
  const type = bodyErrorType(e);
  return type !== null && (type.startsWith('entity.') || CLIENT_BODY_ERRORS.has(type));
}
