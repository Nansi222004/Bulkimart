import { apiUrl } from './api';

const requests = new Map();
export async function boundedFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timer;
  try {
    const ready = fetch(url, { ...options, signal: controller.signal }).then(async response => {
      if (response.clone && response.headers.get('content-type')?.includes('application/json')) await response.clone().arrayBuffer();
      return response;
    });
    return await Promise.race([ready, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Request timed out. Check your connection and retry.')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export function clearPortalRequests(portal, token) {
  for (const [key, entry] of requests) if (key.startsWith(portal + ':' + (token ? token + ':' : ''))) {
    entry.controller.abort(); entry.cancel?.(); requests.delete(key);
  }
}

// Shared only within this JavaScript application lifecycle. Credentials remain
// in their existing portal stores. APIs still perform server authorization.
export async function portalRequest(portal, token, path, { fresh = false, cacheMs = 0, timeoutMs = 10000 } = {}) {
  const key = portal + ':' + token + ':' + path;
  let entry = requests.get(key);
  if (entry && (fresh && entry.done || entry.done && entry.expires <= Date.now())) { requests.delete(key); entry = null; }
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, done: false };
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timeout = new Promise((_, reject) => { entry.deadline = setTimeout(() => reject(new Error('Request timed out. Check your connection and retry.')), timeoutMs); });
    const cancelled = new Promise((_, reject) => { entry.cancel = () => reject(new DOMException('Session changed', 'AbortError')); });
    const responseReady = fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).then(async response => {
      // Keep the deadline active through JSON body arrival, not just headers.
      if (response.clone) await response.clone().arrayBuffer();
      return response;
    });
    entry.promise = Promise.race([responseReady, timeout, cancelled])
      .then(response => {
        entry.done = true; entry.expires = Date.now() + (response.ok ? cacheMs : 0);
        try {
          // Expiry is only a cache bound, never evidence of authentication.
          const exp = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
          if (Number.isFinite(exp)) entry.expires = Math.min(entry.expires, exp * 1000);
        } catch { /* Opaque tokens still require server verification. */ }
        if ((!response.ok || !cacheMs) && requests.get(key) === entry) requests.delete(key);
        return response;
      }).catch(error => { if (requests.get(key) === entry) requests.delete(key); throw error; })
      .finally(() => { clearTimeout(timer); clearTimeout(entry.deadline); });
    requests.set(key, entry);
  }
  const response = await entry.promise;
  return response.clone ? response.clone() : response;
}
