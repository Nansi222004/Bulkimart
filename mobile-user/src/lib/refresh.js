// Port of frontend/src/utils/refreshRegistry.js: "pull down to refresh" runs the action of the screen on top.
import { useEffect, useRef } from 'react';

const handlers = [];
export function registerRefresh(handler) {
  handlers.push(handler);
  return () => { const index = handlers.lastIndexOf(handler); if (index >= 0) handlers.splice(index, 1); };
}
export async function runRefresh() {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  await handler();
  return true;
}
export function useRefreshHandler(handler, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => (enabled ? registerRefresh(() => latest.current()) : undefined), [enabled]);
}
