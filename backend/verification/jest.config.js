export default {
  rootDir: '..', testEnvironment: 'node', transform: {},
  testTimeout: 60000,
  testMatch: ['<rootDir>/verification/*.test.js'],
  setupFiles: ['<rootDir>/verification/env.js'],
};
