import axios from 'axios';
import { API_BASE_URL, API_CONFIGURED, APP_ENV, REQUEST_TIMEOUT_MS } from '../config/env';

/**
 * The one HTTP client for the app.
 * - Adds the rider Bearer token (held in memory; loaded from Keychain by AuthContext).
 * - Turns every failure into an ApiError { status, message, code, body }.
 * - A 401 calls the registered handler, which ends the session (expired or revoked token).
 * - It never retries writes on its own.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

let sessionToken = null;
let unauthorizedHandler = null;

export const setApiToken = (token) => { sessionToken = token || null; };
export const getApiToken = () => sessionToken;
export const setUnauthorizedHandler = (handler) => { unauthorizedHandler = handler; };

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

client.interceptors.request.use((config) => {
  // Fail closed: a debug build without a staging URL must never fall back to production.
  if (!API_CONFIGURED) {
    return Promise.reject(new ApiError(`The ${APP_ENV.name} API address is not configured. Set it in src/config/env.js.`, { status: 0, code: 'API_NOT_CONFIGURED' }));
  }
  if (sessionToken && !config.skipAuth) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${sessionToken}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error) || error instanceof ApiError) return Promise.reject(error);
    const response = error.response;
    if (!response) {
      const timedOut = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
      return Promise.reject(new ApiError(
        timedOut ? 'Request timed out. Check your connection and retry.' : 'No internet connection or the server is unreachable.',
        { status: 0, code: timedOut ? 'TIMEOUT' : 'NETWORK' },
      ));
    }
    const body = response.data && typeof response.data === 'object' ? response.data : null;
    const apiError = new ApiError(
      body?.message || (response.status >= 500 ? 'Server error. Please retry shortly.' : 'Request failed'),
      { status: response.status, code: body?.meta?.code || body?.code || null, body },
    );
    // The token sent with this request has to still be the current one, so a late reply from an old session can't log out a new one.
    const sentToken = String(error.config?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (response.status === 401 && unauthorizedHandler && !error.config?.skipUnauthorizedHandler && sentToken && sentToken === sessionToken) {
      unauthorizedHandler(apiError);
    }
    return Promise.reject(apiError);
  },
);

export const api = {
  get: (url, config) => client.get(url, config).then((r) => r.data),
  post: (url, data, config) => client.post(url, data, config).then((r) => r.data),
  put: (url, data, config) => client.put(url, data, config).then((r) => r.data),
  patch: (url, data, config) => client.patch(url, data, config).then((r) => r.data),
  delete: (url, config) => client.delete(url, config).then((r) => r.data),
};

export default client;
