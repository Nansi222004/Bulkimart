import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * The whole basket, already split into the deliveries it will become.
 *
 * Read-only, and deliberately so for now: this shows what the shopper is holding
 * across both storefronts and how it would travel. Choosing a delivery mode and
 * placing the order still go through the existing per-channel screens.
 *
 * Every figure here is the server's. Nothing on this side adds up a delivery
 * charge or decides whether Same-Day is on offer — those live in one place each
 * (pricing.service and sameDay.service) and a second opinion in the browser is
 * how the two ends start disagreeing.
 */
export const useUnifiedCart = (destination, couponCode) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lat = destination?.lat;
  const lng = destination?.lng;

  const load = useCallback(async () => {
    if (!localStorage.getItem('userToken')) { setData(null); return; }

    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (lat !== undefined && lng !== undefined) {
        qs.set('lat', String(lat));
        qs.set('lng', String(lng));
      }
      if (couponCode) {
        qs.set('coupon', couponCode);
      }
      const res = await fetch(apiUrl('/api/cart/unified?' + qs), {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message || 'Could not load your basket'); setData(null); return; }
      setData(body.data || null);
    } catch (err) {
      setError(err.message || 'Network error — is the server running?');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lat, lng, couponCode]);

  useEffect(() => { load(); }, [load]);

  /**
   * Choose how one group travels.
   *
   * Written to every line in the group, because the group IS the lines that
   * share a mode — setting one and leaving the others would split the group in
   * two on the next read, which is not what "choose Same-Day for this shop"
   * means. The server then regroups and reprices, so the totals shown after this
   * are the server's, not an optimistic guess made here.
   */
  const setGroupMode = useCallback(async (group, mode) => {
    const token = localStorage.getItem('userToken');
    if (!token) return { ok: false, message: 'Please sign in' };

    try {
      for (const item of group.items) {
        const res = await fetch(apiUrl('/api/cart/' + item.itemId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ deliveryMode: mode }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, message: body.message || 'Could not set the delivery option' };
        }
      }
      await load();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }, [load]);

  /**
   * The basket as one list, however many deliveries it becomes.
   *
   * The groups exist because the parcels travel separately; the shopper still
   * put everything into one basket, and the item list has to say so. The cart
   * screen was reading one channel's cart, so a basket holding a Quick item and
   * a Shop All item showed one of them and quietly hid the other — the group
   * summary above it named both, which made the omission look like a bug in the
   * summary rather than in the list.
   *
   * Flattened from the groups rather than from `data.items`, because which shop
   * an item comes from and how it is travelling are properties of its group, and
   * the row needs both to label itself. No prices are touched here: `lineTotal`
   * is the server's.
   */
  const basketItems = useMemo(() => (data?.groups || []).flatMap((g) => (
    g.items.map((it) => ({
      ...it,
      _id: it.itemId,                 // cart line id — what the qty and remove APIs take
      channel: g.channel,
      deliveryMode: g.deliveryMode,
      modeChosen: g.modeChosen,
      sellerName: g.seller?.name || null,
      groupKey: g.key,
    }))
  )), [data]);

  return { data, basketItems, loading, error, reload: load, setGroupMode };
};

export default useUnifiedCart;
