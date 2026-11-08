const base = require('./jest.config.js');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test/integration'],
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  maxWorkers: 1,
};
