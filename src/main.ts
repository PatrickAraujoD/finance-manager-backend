import 'reflect-metadata';
import { createApp } from './presentation/http/app';
import { loadConfig } from './presentation/http/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  // Fail fast with a clear message and exit code 1 (never the stack or any configuration value).
  console.error('Startup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
