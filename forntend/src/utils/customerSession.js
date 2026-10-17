import { createContext } from 'react';
import { portalRequest, clearPortalRequests } from './portalRequests';

export const CustomerSessionContext = createContext(null);
export const SESSION_TIMEOUT_MS = 10000;
const pending = new Map();
export function resetCustomerSessions() {
  for (const entry of pending.values()) { clearTimeout(entry.dispose); }
  pending.clear();
}

// Share verification within this app lifecycle for up to one minute. Protected
// APIs remain server-authorized. Logout/switch invalidates it; disposal permits
// StrictMode's cleanup/remount cycle without cancelling another subscriber.
export function acquireCustomerSession(token, timeoutMs = SESSION_TIMEOUT_MS) {
  let entry = pending.get(token);
  if (!entry) {
    entry = { users: 0, finished: false };
    entry.promise = portalRequest('customer', token, '/api/auth/me', { cacheMs: 60000, timeoutMs })
      .then(async res => ({ res, body: await res.json().catch(() => ({})) }))
      .finally(() => { entry.finished = true; if (pending.get(token) === entry) pending.delete(token); });
    pending.set(token, entry);
  }
  entry.users++;
  clearTimeout(entry.dispose);
  return { promise: entry.promise, release() {
    entry.users--;
    if (!entry.users) entry.dispose = setTimeout(() => {
      if (entry.users) return;
      if (!entry.finished) clearPortalRequests('customer', token);
      if (pending.get(token) === entry) pending.delete(token);
    }, 0);
  } };
}

export function isPublicCustomerPath(path) {
  if (typeof path !== 'string') return false;
  return /^\/(?:$|(?:home|smart-buy|hot-deals|fashion|groceries|garments|electronics|coupons|categories|search|wholesale|ebooks|cart|wishlist|products?|(?:grocery|ecommerce|shg)--[a-z0-9-]+)(?:\/|\?|#|$))/i.test(path);
}
