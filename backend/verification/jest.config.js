export default {
  rootDir: '..', testEnvironment: 'node', transform: {},
  testTimeout: 60000,
  testMatch: ['<rootDir>/verification/*.test.js'],
  setupFiles: ['<rootDir>/verification/env.js'],
  // Cancel retries a test scheduled (same lifecycle as the app's shutdown) so none outlives its test file.
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/retryTeardown.js'],
};
