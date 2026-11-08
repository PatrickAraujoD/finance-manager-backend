import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './presentation/http/modules/app.module';
import { loadConfig } from './presentation/http/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
}

void bootstrap();
