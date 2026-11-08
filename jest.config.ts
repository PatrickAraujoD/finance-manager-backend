import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  testTimeout: 30000,
};

export default config;
