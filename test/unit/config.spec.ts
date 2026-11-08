import { loadConfig } from '../../src/presentation/http/config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
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
      uploadDir: valid.UPLOAD_DIR,
      port: 3000,
    });
  });

  it('does not require or expose a refresh secret (refresh tokens are opaque)', () => {
    expect(loadConfig(valid)).not.toHaveProperty('jwtRefreshSecret');
  });

  it('defaults the HTTP hardening options', () => {
    expect(loadConfig(valid)).toMatchObject({
      corsOrigins: [],
      trustProxy: false,
      throttleTtlSeconds: 60,
      throttleLimit: 100,
      authThrottleLimit: 20,
      loginEmailThrottleLimit: 5,
      uploadThrottleLimit: 10,
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
    ['1', 1],
    ['2', 2],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    expect(loadConfig({ ...valid, TRUST_PROXY: raw }).trustProxy).toBe(expected);
  });

  it.each(['true', '0', '00', '01', '-1', '1.5', 'loopback', '10.0.0.0/8', ' 1', '', 'FALSE'])(
    'rejects the ambiguous TRUST_PROXY %p (only false or an exact hop count >= 1)',
    (raw) => {
      expect(() => loadConfig({ ...valid, TRUST_PROXY: raw })).toThrow('TRUST_PROXY');
    },
  );

  it('reads the throttle limits', () => {
    const config = loadConfig({
      ...valid,
      THROTTLE_TTL_SECONDS: '30',
      THROTTLE_LIMIT: '10',
      AUTH_THROTTLE_LIMIT: '2',
      LOGIN_EMAIL_THROTTLE_LIMIT: '3',
    });
    expect(config).toMatchObject({
      throttleTtlSeconds: 30,
      throttleLimit: 10,
      authThrottleLimit: 2,
      loginEmailThrottleLimit: 3,
    });
  });

  it('reads UPLOAD_THROTTLE_LIMIT and refuses a non positive one', () => {
    expect(loadConfig({ ...valid, UPLOAD_THROTTLE_LIMIT: '3' }).uploadThrottleLimit).toBe(3);
    for (const raw of ['0', '-1', 'abc']) {
      expect(() => loadConfig({ ...valid, UPLOAD_THROTTLE_LIMIT: raw })).toThrow(
        'UPLOAD_THROTTLE_LIMIT',
      );
    }
  });
});

describe('loadConfig server timeouts', () => {
  it('defaults to 60 s request, 20 s headers and 5 s keep-alive', () => {
    expect(loadConfig(valid)).toMatchObject({
      requestTimeoutMs: 60_000,
      headersTimeoutMs: 20_000,
      keepAliveTimeoutMs: 5_000,
    });
  });

  it('reads the three timeouts from the environment', () => {
    const config = loadConfig({
      ...valid,
      REQUEST_TIMEOUT_MS: '30000',
      HEADERS_TIMEOUT_MS: '10000',
      KEEP_ALIVE_TIMEOUT_MS: '2000',
    });
    expect(config).toMatchObject({
      requestTimeoutMs: 30_000,
      headersTimeoutMs: 10_000,
      keepAliveTimeoutMs: 2_000,
    });
  });

  it.each([
    ['REQUEST_TIMEOUT_MS', '0'],
    ['REQUEST_TIMEOUT_MS', '999'],
    ['REQUEST_TIMEOUT_MS', '600001'],
    ['REQUEST_TIMEOUT_MS', 'abc'],
    ['REQUEST_TIMEOUT_MS', '1.5'],
    ['HEADERS_TIMEOUT_MS', '0'],
    ['HEADERS_TIMEOUT_MS', '120001'],
    ['HEADERS_TIMEOUT_MS', '-5'],
    ['KEEP_ALIVE_TIMEOUT_MS', '0'],
    ['KEEP_ALIVE_TIMEOUT_MS', '120001'],
  ])('rejects the absurd %s=%s', (key, raw) => {
    expect(() => loadConfig({ ...valid, [key]: raw })).toThrow(key);
  });

  it('rejects headers timeout longer than the request timeout', () => {
    expect(() =>
      loadConfig({ ...valid, REQUEST_TIMEOUT_MS: '5000', HEADERS_TIMEOUT_MS: '6000' }),
    ).toThrow('HEADERS_TIMEOUT_MS');
  });
});
