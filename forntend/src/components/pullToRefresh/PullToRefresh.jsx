import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { runRefresh } from '../../utils/refreshRegistry';
import { attachPullGesture, THRESHOLD } from './pullGesture';
import './pullToRefresh.css';

const HOLD = 56;        // where the spinner rests while loading
const MIN_SPIN_MS = 700;

/**
 * Pull down from the top of a scroll area to refresh, like most phone apps. The page's own refresh comes
 * from useRefreshHandler (the action its Refresh button used to run); with none registered, `fallback`
 * runs (default: reload).
 */
export default function PullToRefresh({ scrollRef, fallback, disabled = false }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const options = useRef({ fallback, disabled });
  options.current = { fallback, disabled };

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || typeof window === 'undefined') return undefined;
    return attachPullGesture(el, {
      isDisabled: () => options.current.disabled || busy.current,
      onProgress: setPull,
      onRelease: () => {
        busy.current = true; setRefreshing(true); setPull(HOLD);
        const started = Date.now();
        (async () => {
          try {
            if (!await runRefresh()) await (options.current.fallback ? options.current.fallback() : window.location.reload());
          } catch { /* the page shows its own error state */ }
          setTimeout(() => { busy.current = false; setRefreshing(false); setPull(0); }, Math.max(0, MIN_SPIN_MS - (Date.now() - started)));
        })();
        return true;
      },
    });
  }, [scrollRef]);

  if (typeof document === 'undefined' || (!pull && !refreshing)) return null;
  const visible = Math.min(1, pull / THRESHOLD);
  return createPortal(
    <div className="ptr-indicator" role="status" aria-live="polite" aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
      style={{ transform: `translate(-50%, ${pull}px)`, opacity: refreshing ? 1 : visible, transition: pull === 0 || refreshing ? 'transform .25s ease, opacity .2s' : 'none' }}>
      <svg className={refreshing ? 'ptr-spin' : ''} style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" />
      </svg>
    </div>, document.body);
}
