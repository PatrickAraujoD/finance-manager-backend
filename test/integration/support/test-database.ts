const DEFAULT_URL = 'postgresql://finance:finance@localhost:5432/finance_test';

/** URL of the dedicated test database. Never the development one. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a database whose name ends with _test');
  }
  return url;
}

export function adminDatabaseUrl(url: string): string {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  return admin.toString();
}
