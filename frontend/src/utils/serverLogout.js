import { apiUrl } from './api';

/**
 * Server-side logout: revokes this session token so a copy of it stops working (other devices stay signed in).
 * Read the token BEFORE clearing local storage. Never blocks or fails the local sign-out: `keepalive` lets the request
 * finish even if the page navigates, and any network error is ignored (the token still expires on its own).
 */
export function revokeServerSession(token) {
  if (!token) return Promise.resolve();
  try {
    return fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
