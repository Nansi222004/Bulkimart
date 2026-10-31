// The one API client. Every request goes through `boundedFetch`, which adds the timeout, and authenticated
// requests add the customer's bearer token here — screens never build headers themselves.
//
// Behaviour copied from the web (`frontend/src/utils/api.js`, `portalRequests.js`):
// - every request has a deadline (10 s default) covering the body, not just the headers;
// - identical authenticated GETs can share one in-flight request (`portalRequest`);
// - nothing is retried automatically. A screen offers Retry; POST/PUT/PATCH/DELETE are never re-sent.
// Added for the app: a 401 on a request that carried the current token ends the session once, in one place.
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config';
import { local } from '../lib/storage';
import { emit, EVENTS } from '../lib/events';

export const apiUrl = path => {
  if (/^https:\/\//i.test(path)) return path;
  const route = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${route}`;
};

// Uploaded media paths are relative to the API host on the web too.
export const mediaUrl = src => (typeof src === 'string' && src.startsWith('/uploads/') ? apiUrl(src) : src || '');

export const getToken = () => local.getItem('userToken');

export const authHeaders = (json = true) => {
  const token = getToken();
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

export const TIMEOUT_MESSAGE = 'Request timed out. Check your connection and retry.';
export const OFFLINE_MESSAGE = 'You appear to be offline. Check your connection and retry.';

const bearerOf = headers => {
  if (!headers) return null;
  const value = headers.Authorization || headers.authorization;
  return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '') : null;
};

function watchAuthFailure(response, headers) {
  if (response.status !== 401) return;
  const sent = bearerOf(headers);
  // Only the token in use right now can expire the session; an old request finishing late cannot.
  if (sent && sent === getToken()) emit(EVENTS.SESSION_EXPIRED, { status: 401 });
}

// React Native has no ReadableStream, so `response.clone()` throws there. JSON bodies are read once and
// served from memory instead; callers keep using `.ok`, `.status`, `.headers`, `.json()` and `.text()`.
function bufferedResponse(response, text) {
  return {
    ok: response.ok, status: response.status, statusText: response.statusText,
    headers: response.headers, url: response.url, redirected: response.redirected, type: response.type,
    bodyUsed: false, buffered: true,
    text: async () => text,
    json: async () => JSON.parse(text),
    clone() { return bufferedResponse(response, text); },
  };
}

export async function boundedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener?.('abort', abort);
  if (options.signal?.aborted) controller.abort();
  let timer;
  try {
    const ready = fetch(apiUrl(url), { ...options, signal: controller.signal }).then(async response => {
      // Keep the deadline active until the JSON body has arrived.
      if (response.headers.get('content-type')?.includes('application/json')) return bufferedResponse(response, await response.text());
      return response;
    });
    const response = await Promise.race([ready, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error(TIMEOUT_MESSAGE)); }, timeoutMs);
    })]);
    watchAuthFailure(response, options.headers);
    return response;
  } catch (error) {
    if (error?.name === 'AbortError' && options.signal?.aborted) throw error;
    if (error?.message === TIMEOUT_MESSAGE) throw error;
    if (error instanceof TypeError || /Network request failed/i.test(error?.message || '')) throw new Error(OFFLINE_MESSAGE);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.('abort', abort);
  }
}

/** JSON request helper: `{ ok, status, body }`. Never throws for HTTP errors; throws for network/timeout. */
export async function request(path, { method = 'GET', body, auth = true, headers = {}, timeoutMs, signal, form } = {}) {
  const finalHeaders = { ...(auth ? authHeaders(!form && body !== undefined) : (!form && body !== undefined ? { 'Content-Type': 'application/json' } : {})), ...headers };
  const response = await boundedFetch(path, {
    method,
    headers: finalHeaders,
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
  }, timeoutMs ?? (form ? 60000 : REQUEST_TIMEOUT_MS));
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: data, response };
}

// Identical authenticated GETs share one request within the app's lifetime (web `portalRequest`).
const requests = new Map();
export function clearPortalRequests(token) {
  for (const [key, entry] of requests) if (!token || key.startsWith(token + ':')) { entry.controller.abort(); requests.delete(key); }
}

export async function portalRequest(token, path, { fresh = false, cacheMs = 0, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const key = token + ':' + path;
  let entry = requests.get(key);
  if (entry && ((fresh && entry.done) || (entry.done && entry.expires <= Date.now()))) { requests.delete(key); entry = null; }
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, done: false };
    entry.promise = boundedFetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }, timeoutMs)
      .then(response => {
        entry.done = true;
        entry.expires = Date.now() + (response.ok ? cacheMs : 0);
        if ((!response.ok || !cacheMs) && requests.get(key) === entry) requests.delete(key);
        return response;
      })
      .catch(error => { if (requests.get(key) === entry) requests.delete(key); throw error; });
    requests.set(key, entry);
  }
  const response = await entry.promise;
  // Only in-memory (JSON) responses can be copied in React Native; see bufferedResponse.
  return response.buffered ? response.clone() : response;
}

// Friendly messages: never show stack traces, tokens or database internals (web `feedback.friendlyMessage`).
export function friendlyMessage(value, fallback = 'Something went wrong. Please try again.') {
  const message = typeof value === 'string' ? value : '';
  if (!message.trim() || /\b(?:Bearer\s+\S+|E11000|MongoServerError|TypeError|ReferenceError|stack trace|secret[_ -]?key|access[_ -]?token)\b|\n\s*at\s/i.test(message)) return fallback;
  return message.slice(0, 2500);
}
