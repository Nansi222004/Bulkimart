import { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet, qs } from '../../../utils/adminApi';

/**
 * Live dispatch data from GET /api/admin/delivery-live, shared by the fleet
 * dashboard, Active Deliveries and Delivery Tracking.
 *
 * Polls while the tab is visible (trips move every few minutes) and drops any
 * response that arrives after a newer request, so a slow reply can never put
 * an old filter's rows back on screen.
 */
export const LIVE_POLL_MS = 30000;

export const STAGE_LABELS = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  arrived_at_store: 'At store',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  arrived_at_customer: 'At customer',
};

export const STAGE_TONES = {
  assigned: { color: '#b45309', background: '#fffbeb' },
  accepted: { color: '#b45309', background: '#fffbeb' },
  arrived_at_store: { color: '#1d4ed8', background: '#eff6ff' },
  picked_up: { color: '#047857', background: '#ecfdf5' },
  in_transit: { color: '#047857', background: '#ecfdf5' },
  arrived_at_customer: { color: '#6d28d9', background: '#f5f3ff' },
};

export const KIND_LABELS = { order: 'Order', return_pickup: 'Return pickup', subscription: 'Subscription' };

export const formatMinutes = (mins) => {
  if (mins === null || mins === undefined) return '—';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export const formatClock = (value) => (value
  ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  : '—');

export function useLiveDispatch({ stage = 'all', search = '', overEta = false, poll = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const { data: body } = await adminGet(`/delivery-live${qs({ stage: stage === 'all' ? undefined : stage, search: search.trim() || undefined, overEta: overEta ? 'true' : undefined })}`);
      if (current !== request.current) return;
      setData(body);
      setError('');
    } catch (err) {
      if (current !== request.current) return;
      setError(err.message || 'Could not load live deliveries');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [stage, search, overEta]);

  // Debounced so typing a search does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (!poll) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(tick, LIVE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [load, poll]);

  return { data, loading, error, reload: load };
}
