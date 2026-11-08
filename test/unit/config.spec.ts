import { loadConfig } from '../../src/presentation/http/config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  UPLOAD_DIR: './uploads',
};

describe('loadConfig', () => {
  it('throws when required variables are missing', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it.each(Object.keys(valid))('throws when %s is missing', (key) => {
    const env: Record<string, string> = { ...valid };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(key);
  });

  it('returns the config with valid variables', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      databaseUrl: valid.DATABASE_URL,
      jwtAccessSecret: valid.JWT_ACCESS_SECRET,
      jwtRefreshSecret: valid.JWT_REFRESH_SECRET,
      uploadDir: valid.UPLOAD_DIR,
      port: 3000,
    });
  });
});
