import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from './config';
import { DomainErrorFilter } from './filters/domain-error.filter';
import { AppModule } from './modules/app.module';

export const JSON_BODY_LIMIT = '100kb';

/** Applies every HTTP-level setting (security headers, CORS, limits, pipes, filters). */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.set('trust proxy', config.trustProxy);
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
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
  });
  configureApp(app, config);
  return app;
}
