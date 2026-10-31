// Port of modules/User/hooks/useUnifiedCart.js: the whole basket as server-priced delivery groups.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boundedFetch, request } from '../api/client';
import { local } from '../lib/storage';

export const useUnifiedCart = (destination, couponCode, purchaseMode = 'retail') => {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef(null);
  const customerToken = local.getItem('userToken');
  const lat = destination?.lat;
  const lng = destination?.lng;
  const dataScope = JSON.stringify([customerToken, lat ?? null, lng ?? null, purchaseMode]);
  const data = snapshot?.scope === dataScope ? snapshot.data : null;

  const load = useCallback(async () => {
    const requestId = ++generation.current;
    controller.current?.abort(); controller.current = new AbortController();
    const token = local.getItem('userToken');
    if (!token) { setSnapshot(null); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (purchaseMode === 'basket') qs.set('purchaseMode', 'basket');
      if (lat !== undefined && lng !== undefined) { qs.set('lat', String(lat)); qs.set('lng', String(lng)); }
      if (couponCode) qs.set('coupon', couponCode);
      const res = await boundedFetch('/api/cart/unified?' + qs, { headers: { Authorization: 'Bearer ' + token }, signal: controller.current.signal });
      const body = await res.json().catch(() => ({}));
      if (requestId !== generation.current || token !== local.getItem('userToken')) return;
      if (!res.ok) { setError(body.message || 'Could not load your basket'); setSnapshot(null); return; }
      setSnapshot({ scope: dataScope, data: body.data || null });
    } catch (err) {
      if (requestId !== generation.current || err.name === 'AbortError') return;
      setError(err.message || 'Network error — please try again.');
      setSnapshot(null);
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, [lat, lng, couponCode, purchaseMode, dataScope]);

  useEffect(() => { load(); return () => { generation.current++; controller.current?.abort(); }; }, [load]);

  /** Writes the mode to every line in the group; the server regroups and reprices. */
  const setGroupMode = useCallback(async (group, mode) => {
    if (!local.getItem('userToken')) return { ok: false, message: 'Please sign in' };
    try {
      for (const item of group.items) {
        const { ok, body } = await request('/api/cart/' + item.itemId, { method: 'PUT', body: { deliveryMode: mode } });
        if (!ok) return { ok: false, message: body.message || 'Could not set the delivery option' };
      }
      await load();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }, [load]);

  const basketItems = useMemo(() => (data?.groups || []).flatMap(g => g.items.map(it => ({
    ...it, _id: it.itemId, channel: g.channel, salesChannel: g.salesChannel || 'retail', deliveryMode: g.deliveryMode, modeChosen: g.modeChosen, sellerName: g.seller?.name || null, groupKey: g.key,
  }))), [data]);

  return { data, basketItems, loading, error, reload: load, setGroupMode };
};
export default useUnifiedCart;
