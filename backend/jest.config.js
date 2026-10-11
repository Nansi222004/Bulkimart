/**
 * This project is pure ESM ("type": "module" in package.json). Jest's own
 * transform pipeline is CJS-based, so rather than adding Babel as a second
 * toolchain just to transpile, this runs Jest under Node's native ESM
 * support (`node --experimental-vm-modules`, wired via the `test` script in
 * package.json) with `transform: {}` — nothing to transpile, Node parses
 * the real .js files directly.
 */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  // Test-only configuration needed by API modules at import time. The setup
  // uses dummy values and explicitly clears database URLs; tests provide their
  // own isolated database connection.
  setupFiles: ['<rootDir>/__tests__/setup/env.js'],
  // DB-backed suites should use their own mongodb-memory-server instance —
  // never the real Atlas cluster. An in-memory Mongo download/boot can be slow
  // on first run.
  testTimeout: 60000,
  // mongodb-memory-server downloads a real mongod binary on first use —
  // safe to run test files in parallel against their OWN memory-server
  // instances, but keeping it modest avoids hammering the download/boot
  // step on a fresh machine.
  maxWorkers: 2,
};
