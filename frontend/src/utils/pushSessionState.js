// Shared origin storage lets the background worker enforce logout even offline.
// No login credentials are stored here. Missing/unreadable state denies display.
export const PUSH_SESSION_CACHE = 'bulkimart-push-sessions-v1';
export const pushSessionKey = scope => `bulkimart:${scope}:push-session`;
export const pushSessionPath = scope => `/__bulkimart_push_session__/${scope}`;
const pending = new Map();
const revisions = new Map();
export const pushSessionRevision = scope => revisions.get(scope) || 0;
const enqueue = (scope, operation) => {
  const next = (pending.get(scope) || Promise.resolve()).then(operation).catch(() => false);
  pending.set(scope, next);
  void next.finally(() => { if (pending.get(scope) === next) pending.delete(scope); });
  return next;
};
export function getPushSession(scope) {
  try { return JSON.parse(localStorage.getItem(pushSessionKey(scope)) || 'null'); }
  catch { return null; }
}
export const notificationScope = data => ({ user: 'customer', buyer: 'customer', customer: 'customer', seller: 'seller', rider: 'delivery', delivery: 'delivery', admin: 'admin' })[data?.audience];

export function enablePushSession(scope, recipientId, token, isCurrent) {
  return enqueue(scope, async () => {
    if (!isCurrent() || typeof caches === 'undefined') return false;
    const session = { recipientId: String(recipientId), token, sessionId: crypto.randomUUID() };
    const cache = await caches.open(PUSH_SESSION_CACHE);
    if (!isCurrent()) return false;
    await cache.put(pushSessionPath(scope), new Response(JSON.stringify(session)));
    if (!isCurrent()) { await cache.delete(pushSessionPath(scope)); return false; }
    localStorage.setItem(pushSessionKey(scope), JSON.stringify(session));
    return true;
  });
}

export function disablePushSession(scope) {
  revisions.set(scope, pushSessionRevision(scope) + 1);
  // This synchronous marker also silences foreground messages immediately.
  try { localStorage.removeItem(pushSessionKey(scope)); } catch { /* fail closed */ }
  return enqueue(scope, async () => {
    // A later login must not be cleared by an older logout's cleanup.
    if (getPushSession(scope)) return false;
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(PUSH_SESSION_CACHE);
      if (!getPushSession(scope)) await cache.delete(pushSessionPath(scope));
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistration) {
      const worker = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
      const notifications = await worker?.getNotifications?.() || [];
      if (!getPushSession(scope)) for (const notification of notifications) {
        const data = notification.data?.FCM_MSG?.data || notification.data;
        if (notificationScope(data) === scope) notification.close();
      }
    }
    return true;
  });
}
