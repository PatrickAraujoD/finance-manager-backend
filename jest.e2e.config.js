/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  testTimeout: 30000,
  roots: ['<rootDir>/test/e2e'],
  // Same dedicated *_test database (created and migrated) as the integration tests.
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  maxWorkers: 1,
};
