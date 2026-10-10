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
  // Fake env values (JWT_SECRET, OTP_MODE=mock) so route modules that throw
  // at import time without them (config/jwt.js) can be imported at all —
  // needed by the API-level (supertest) suites under __tests__/api/. See
  // that file's own comment for why this can never be a real secret.
  setupFiles: ['<rootDir>/__tests__/setup/env.js'],
  // Every DB-backed suite spins up its own mongodb-memory-server instance
  // (see __tests__/setup/memoryDb.js) — never the real Atlas cluster this
  // repo's ad-hoc _tmp_test_*.mjs scripts use. An in-memory Mongo download/
  // boot can be slow on first run.
  testTimeout: 60000,
  // mongodb-memory-server downloads a real mongod binary on first use —
  // safe to run test files in parallel against their OWN memory-server
  // instances, but keeping it modest avoids hammering the download/boot
  // step on a fresh machine.
  maxWorkers: 2,
};
