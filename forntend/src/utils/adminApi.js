import { apiUrl } from './api';

/**
 * Thin client for the /api/admin surface.
 *
 * The backend answers with a standard envelope:
 *   { success, data, message, meta }
 * These helpers unwrap it so callers just get `data`, and throw an Error
 * carrying `message` on failure.
 */

const authHeaders = (json = true) => {
  const token = localStorage.getItem('adminToken');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

/**
 * FormData needs no Content-Type header at all — the browser sets one with
 * the correct multipart boundary itself. Setting it manually (or via the
 * json:true default) strips that boundary and the server can't parse the
 * body, so a FormData payload always calls authHeaders(false).
 */
const isFormData = (payload) => typeof FormData !== 'undefined' && payload instanceof FormData;

const handle = async (response) => {
  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    // token expired or invalid — force a re-login
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    throw new Error(body.message || 'Session expired. Please sign in again.');
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${response.status})`);
  }

  // Newer endpoints use the { success, data, message, meta } envelope, but the
  // six original controllers still answer with a bare array or an ad-hoc object
  // (e.g. /api/categories/tree). Accept both so callers always get `data`.
  if (Array.isArray(body)) return { data: body, meta: {}, message: '' };
  if (body.data === undefined) {
    return { data: body, meta: body.meta || {}, message: body.message || '' };
  }

  return { data: body.data, meta: body.meta || {}, message: body.message };
};

export const adminGet = async (path) =>
  handle(await fetch(apiUrl(`/api/admin${path}`), { headers: authHeaders(false) }));

/** Fetch a private admin-only file without ever turning it into a public URL. */
export const adminGetBlob = async (path) => {
  const response = await fetch(apiUrl(`/api/admin${path}`), { headers: authHeaders(false) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
    }
    throw new Error(body.message || `File request failed (${response.status})`);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'ebook.pdf';
  return { blob: await response.blob(), filename };
};

export const adminPatch = async (path, payload = {}) =>
  handle(
    await fetch(apiUrl(`/api/admin${path}`), {
      method: 'PATCH',
      headers: authHeaders(!isFormData(payload)),
      body: isFormData(payload) ? payload : JSON.stringify(payload),
    })
  );

export const adminPost = async (path, payload = {}) =>
  handle(
    await fetch(apiUrl(`/api/admin${path}`), {
      method: 'POST',
      headers: authHeaders(!isFormData(payload)),
      body: isFormData(payload) ? payload : JSON.stringify(payload),
    })
  );

export const adminDelete = async (path) =>
  handle(await fetch(apiUrl(`/api/admin${path}`), { method: 'DELETE', headers: authHeaders(false) }));

/** Build a query string, dropping empty/undefined values. */
export const qs = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'All') search.append(k, v);
  });
  const str = search.toString();
  return str ? `?${str}` : '';
};

/* --------------------------------------------------------------------------
 * Generic authenticated calls for admin-guarded endpoints that do NOT live
 * under /api/admin — categories are at /api/categories with requireAdmin.
 * ----------------------------------------------------------------------- */

export const authGet = async (path) =>
  handle(await fetch(apiUrl(path), { headers: authHeaders(false) }));

export const authPost = async (path, payload = {}) =>
  handle(
    await fetch(apiUrl(path), {
      method: 'POST',
      headers: authHeaders(!isFormData(payload)),
      body: isFormData(payload) ? payload : JSON.stringify(payload),
    })
  );

export const authPut = async (path, payload = {}) =>
  handle(
    await fetch(apiUrl(path), {
      method: 'PUT',
      headers: authHeaders(!isFormData(payload)),
      body: isFormData(payload) ? payload : JSON.stringify(payload),
    })
  );

export const authDelete = async (path) =>
  handle(await fetch(apiUrl(path), { method: 'DELETE', headers: authHeaders(false) }));
