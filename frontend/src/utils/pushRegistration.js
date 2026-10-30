// Share the final result, rather than returning a stale "initializing" hint.
// A cancelled/timed-out operation cannot register a token or enable a new session.
export function createPushRegistration({ getSession, perform, timeoutMs = 45000 }) {
  let current;
  return {
    run(options) {
      const session = getSession();
      if (current?.session === session) return current.promise;
      current?.controller.abort();
      const controller = new AbortController();
      const attempt = { session, controller };
      current = attempt;
      const isCurrent = () => !controller.signal.aborted && current === attempt && getSession() === session;
      let timer;
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: 'timeout' }); }, timeoutMs);
      });
      attempt.promise = Promise.race([
        Promise.resolve().then(() => perform(options, { session, signal: controller.signal, isCurrent })), timeout,
      ]).catch(() => ({ status: 'unavailable' })).then(result => {
        if (getSession() !== session || current !== attempt) return { status: 'session_changed' };
        if (typeof result !== 'string' || !result) current = undefined;
        return result;
      }).finally(() => {
        clearTimeout(timer);
      });
      return attempt.promise;
    },
    reset() { current?.controller.abort(); current = undefined; },
  };
}
