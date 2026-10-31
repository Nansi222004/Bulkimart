// App-wide events that the web dispatched on `window` ('cart:changed', 'app:soft-refresh',
// 'bulkimart:session-changed', 'online', 'foreground').
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of [...(listeners.get(event) || [])]) {
    try { handler(payload); } catch { /* one listener must not break the others */ }
  }
}

export const EVENTS = {
  SESSION_CHANGED: 'bulkimart:session-changed',
  SESSION_EXPIRED: 'bulkimart:session-expired',
  CART_CHANGED: 'cart:changed',
  SOFT_REFRESH: 'app:soft-refresh',
  ONLINE: 'online',
  FOREGROUND: 'foreground',
};
