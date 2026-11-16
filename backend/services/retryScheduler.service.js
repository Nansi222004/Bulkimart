/**
 * Delayed retries owned by the application lifecycle.
 *
 * The rider broadcasts (forward orders and return pickups) widen their search and try again 30 s later when nobody
 * is nearby. Those retries used to be bare `setTimeout`s that nothing tracked, so a shutdown (or the end of a test
 * file) could not stop them and they ran against a closed database connection.
 *
 * Scheduling behaviour is unchanged: the same delay, the same callback, and the timer still keeps the process alive
 * (not unref'd), exactly like the plain setTimeout it replaces. What is new is ownership:
 *  - `drainPendingRetries()` cancels retries that are still waiting and waits for any that are already running, so
 *    no retry outlives the database connection it needs. A running retry that schedules a further attempt is
 *    caught by the next pass.
 *  - `stopRetryScheduler()` is the application shutdown: it also refuses new retries, because a stopping process
 *    must not start work it cannot finish.
 */
const pending = new Set(); // { handle, label }
const running = new Set(); // promises of retries currently executing
let accepting = true;

/**
 * Run `task` once after `delayMs`, like `setTimeout(task, delayMs)`, but tracked. `onError` receives a rejection
 * from `task` (each caller keeps its own existing error handling). Returns false when the scheduler is stopped.
 */
export const scheduleRetry = (label, delayMs, task, onError = () => {}) => {
  if (!accepting) return false;
  const entry = { label, handle: null };
  entry.handle = setTimeout(() => {
    pending.delete(entry);
    const run = Promise.resolve().then(task).catch(onError).finally(() => running.delete(run));
    running.add(run);
  }, delayMs);
  pending.add(entry);
  return true;
};

/** Number of retries waiting to fire (labels for diagnostics). */
export const pendingRetries = () => [...pending].map((entry) => entry.label);
export const runningRetryCount = () => running.size;

/**
 * Cancel every waiting retry and wait for the ones already running. Repeats until nothing is waiting or running,
 * so a retry that schedules its next attempt while being drained is cancelled too. Returns the number cancelled.
 */
export const drainPendingRetries = async () => {
  let cancelled = 0;
  for (let pass = 0; pass < 10 && (pending.size || running.size); pass += 1) {
    for (const entry of pending) { clearTimeout(entry.handle); pending.delete(entry); cancelled += 1; }
    if (running.size) await Promise.allSettled([...running]);
  }
  return cancelled;
};

/** Application shutdown: refuse new retries, then drain. */
export const stopRetryScheduler = async () => {
  accepting = false;
  return drainPendingRetries();
};

/** For tests that exercise stop: accept retries again. */
export const resumeRetryScheduler = () => { accepting = true; };
