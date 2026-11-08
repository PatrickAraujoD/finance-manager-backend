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

  it('defaults the HTTP hardening options', () => {
    expect(loadConfig(valid)).toMatchObject({
      corsOrigins: [],
      trustProxy: false,
      throttleTtlSeconds: 60,
      throttleLimit: 100,
      authThrottleLimit: 5,
    });
  });

  it('parses a comma separated CORS_ORIGINS list', () => {
    const config = loadConfig({
      ...valid,
      CORS_ORIGINS: ' https://a.example.com, https://b.example.com ,',
    });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it.each([
    ['false', false],
    ['true', true],
    ['1', 1],
    ['2', 2],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    expect(loadConfig({ ...valid, TRUST_PROXY: raw }).trustProxy).toBe(expected);
  });

  it('rejects an invalid TRUST_PROXY', () => {
    expect(() => loadConfig({ ...valid, TRUST_PROXY: 'loopback' })).toThrow('TRUST_PROXY');
  });

  it('reads the throttle limits', () => {
    const config = loadConfig({
      ...valid,
      THROTTLE_TTL_SECONDS: '30',
      THROTTLE_LIMIT: '10',
      AUTH_THROTTLE_LIMIT: '2',
    });
    expect(config).toMatchObject({ throttleTtlSeconds: 30, throttleLimit: 10, authThrottleLimit: 2 });
  });
});
