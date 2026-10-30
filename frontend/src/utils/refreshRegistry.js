import { useEffect, useRef } from 'react';

// What "pull down to refresh" does on the screen the user is looking at. A page registers the same
// action its old Refresh button ran; the most recently mounted page wins, so a detail view on top of a
// list refreshes itself rather than the list underneath.
const handlers = [];

export function registerRefresh(handler) {
  handlers.push(handler);
  return () => { const index = handlers.lastIndexOf(handler); if (index >= 0) handlers.splice(index, 1); };
}

/** Runs the current page's refresh. Resolves false when no page registered one. */
export async function runRefresh() {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  await handler();
  return true;
}

/** enabled: register only while it is true (e.g. while one section of a page is open). */
export function useRefreshHandler(handler, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => (enabled ? registerRefresh(() => latest.current()) : undefined), [enabled]);
}
