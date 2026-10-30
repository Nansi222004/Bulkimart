import { apiUrl } from './api';

const backendOrigin = () => new URL(apiUrl('/api/auth/me'), typeof window !== 'undefined' && window.location?.origin || 'http://localhost').origin;
const key = scope => `bulkimart:${scope}:session-api-origin`;
export const bindSessionBackend = scope => localStorage.setItem(key(scope), backendOrigin());
export const clearSessionBackend = scope => localStorage.removeItem(key(scope));
// Legacy sessions have no binding. They still require server verification
// before FCM registration; never infer a valid signature from decoded claims.
export const sessionMatchesBackend = scope => !localStorage.getItem(key(scope)) || localStorage.getItem(key(scope)) === backendOrigin();
