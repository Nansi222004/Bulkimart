import { drainPendingRetries } from '../../services/retryScheduler.service.js';

/**
 * Test-file teardown that mirrors the application's shutdown (index.js → stopRetryScheduler): retries a test
 * scheduled (e.g. a rider broadcast that found nobody and will widen its search in 30 s) are cancelled and running
 * ones are awaited before the file's database closes. Without this, the retry fired during a later test file and
 * queried a disconnected client ("Cannot log after tests are done"), making Jest exit 1.
 *
 * Registered in setupFilesAfterEnv for both Jest configs, so it runs at the end of every test file, before the
 * next file starts — a waiting retry can never fire into another file.
 */
afterAll(async () => {
  await drainPendingRetries();
});
