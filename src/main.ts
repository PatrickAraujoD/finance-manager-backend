import 'reflect-metadata';
import { createApp } from './presentation/http/app';
import { loadConfig } from './presentation/http/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port);
}

void bootstrap();
