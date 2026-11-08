import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from './config';
import { DomainErrorFilter } from './filters/domain-error.filter';
import { AppModule } from './modules/app.module';

export const JSON_BODY_LIMIT = '100kb';

const CONDITIONAL_HEADERS = [
  'if-none-match',
  'if-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
];

/** Applies every HTTP-level setting (security headers, CORS, limits, pipes, filters). */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.set('trust proxy', config.trustProxy);
  // No ETag and no caching: responses carry tokens and personal data. Conditional request headers
  // are dropped too: with no ETag, `If-None-Match: *` would still make Express answer 304.
  express.set('etag', false);
  express.use(
    (
      req: { headers: Record<string, unknown> },
      res: { setHeader(n: string, v: string): void },
      next: () => void,
    ) => {
      for (const header of CONDITIONAL_HEADERS) delete req.headers[header];
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  express.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: false });
  express.use(helmet());
  if (config.corsOrigins.length > 0) {
    express.enableCors({ origin: config.corsOrigins });
  }
  express.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  express.useGlobalFilters(new DomainErrorFilter());
  applyServerTimeouts(app.getHttpServer() as HttpServerTimeouts, config);
}

interface HttpServerTimeouts {
  requestTimeout: number;
  headersTimeout: number;
  keepAliveTimeout: number;
  connectionsCheckingInterval: number;
}

/**
 * Node only enforces the request/headers timeouts when it sweeps its connections (every 30 s by
 * default), so the sweep interval follows the headers timeout to keep the limits meaningful.
 */
function applyServerTimeouts(server: HttpServerTimeouts, config: AppConfig): void {
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.connectionsCheckingInterval = Math.min(
    5_000,
    Math.max(100, Math.floor(config.headersTimeoutMs / 4)),
  );
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
  });
  configureApp(app, config);
  return app;
}
