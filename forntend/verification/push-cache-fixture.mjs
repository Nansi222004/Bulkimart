// In-memory CacheStorage; no browser permission, Firebase, or network access.
export function pushCacheFixture(sessions = {}) {
  const entries = new Map(Object.entries(sessions).map(([scope, session]) => [
    `/__bulkimart_push_session__/${scope}`, JSON.stringify({ sessionId: 'fixture-session', ...session }),
  ]));
  const path = key => new URL(typeof key === 'string' ? key : key.url, 'https://fixture.invalid').pathname;
  const cache = {
    async match(key) { const value = entries.get(path(key)); return value ? new Response(value) : undefined; },
    async put(key, response) { entries.set(path(key), await response.text()); },
    async delete(key) { return entries.delete(path(key)); },
  };
  return { entries, cache, caches: { async open(name) {
    if (name !== 'bulkimart-push-sessions-v1') throw new Error('Unexpected push cache');
    return cache;
  } } };
}
