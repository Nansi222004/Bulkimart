import { httpError } from './response.js';

// Fixed internal codes only. Never include headers, JWTs, claims, user IDs,
// request bodies, provider errors, or signing-key fingerprints in diagnostics.
export function authFailure(req, code, message, status = 401) {
  console.warn(JSON.stringify({ event: 'authentication_rejected', code, status,
    requestId: req.requestId, instance: process.pid }));
  return httpError(status, message, { code });
}
