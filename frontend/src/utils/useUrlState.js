import { useCallback, useState } from 'react';

/**
 * State that also lives in the page URL's query (?key=value), so a refresh reopens the same tab or
 * filter instead of the page's first one. Uses replaceState: switching tabs does not add history
 * entries, and moving to another admin page (a new path) starts that page fresh.
 *
 * `allowed` (optional) lists the accepted values; anything else in the URL falls back to `fallback`.
 */
// No window (server rendering, tests): nothing is read or written, and the fallback is used.
const hasWindow = () => typeof window !== 'undefined' && !!window.location && !!window.history;
export const readUrlParam = key => (hasWindow() ? new URLSearchParams(window.location.search).get(key) : null);

export function writeUrlParams(patch) {
  if (!hasWindow()) return;
  const q = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') q.delete(key);
    else q.set(key, String(value));
  }
  const search = q.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

export default function useUrlState(key, fallback, allowed) {
  const [value, setValue] = useState(() => {
    const raw = readUrlParam(key);
    if (raw !== null && raw !== '' && (!allowed || allowed.includes(raw))) return raw;
    return typeof fallback === 'function' ? fallback() : fallback;
  });
  const set = useCallback(next => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      writeUrlParams({ [key]: resolved });
      return resolved;
    });
  }, [key]);
  return [value, set];
}
