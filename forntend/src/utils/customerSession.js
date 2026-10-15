import { createContext } from 'react';
import { apiUrl } from './api';

export const CustomerSessionContext = createContext(null);
export const SESSION_TIMEOUT_MS = 10000;
const pending = new Map();

// Share only in-flight verification. Completed identities are never cached as
// authorization. Delayed disposal permits StrictMode's cleanup/remount cycle.
export function acquireCustomerSession(token, timeoutMs = SESSION_TIMEOUT_MS) {
  let entry = pending.get(token);
  if (!entry) {
    const controller = new AbortController();
    entry = { users: 0, controller };
    const timeout = new Promise((_, reject) => {
      entry.timer = setTimeout(() => { reject(new Error('Session verification timed out')); controller.abort(); }, timeoutMs);
    });
    entry.promise = Promise.race([
      fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(async res => ({ res, body: await res.json().catch(() => ({})) })),
      timeout,
    ]).finally(() => { clearTimeout(entry.timer); if (pending.get(token) === entry) pending.delete(token); });
    pending.set(token, entry);
  }
  entry.users++;
  clearTimeout(entry.dispose);
  return { promise: entry.promise, release() {
    entry.users--;
    if (!entry.users) entry.dispose = setTimeout(() => {
      if (entry.users) return;
      entry.controller.abort(); clearTimeout(entry.timer);
      if (pending.get(token) === entry) pending.delete(token);
    }, 0);
  } };
}

export function isPublicCustomerPath(path) {
  return /^\/(?:$|(?:home|smart-buy|hot-deals|fashion|groceries|garments|electronics|coupons|categories|search)(?:\/|$))/.test(path);
}
