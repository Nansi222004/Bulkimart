/**
 * Central API configuration
 * All fetch/axios calls should use this base URL so the backend URL
 * is controlled from .env and never hardcoded across the codebase.
 */

// VITE_API_BASE_URL is the host-only legacy form. VITE_API_URL may include
// the /api suffix; apiUrl() de-duplicates it when callers already pass /api.
const rawApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;

export const API_BASE_URL = (rawApiUrl !== undefined && rawApiUrl !== null && rawApiUrl !== '')
  ? rawApiUrl
  : (typeof window !== 'undefined' ? window.location.origin : '');



/**
 * Convenience helper — prepends the base URL to any path.
 * Usage:  apiUrl('/api/auth/login')
 */
export const apiUrl = (path) => {
  const base = API_BASE_URL.replace(/\/$/, '');
  const route = path.startsWith('/') ? path : `/${path}`;
  if (base.endsWith('/api') && route.startsWith('/api/')) {
    return `${base}${route.slice(4)}`;
  }
  return `${base}${route}`;
};

