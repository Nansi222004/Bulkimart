import { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * What delivery each product on screen can actually get.
 *
 * The answer belongs to the server and nowhere else. A seller ticking a box is
 * one condition out of eight — the distance, the stock, the cut-off, the packing
 * time, the day and whether any rider is free all decide it too, and all of them
 * change while a page is open. So this asks, and renders whatever comes back.
 *
 * Batched deliberately: one request for the whole grid rather than one per card.
 * Twenty products would otherwise mean twenty geo queries every time somebody
 * scrolls.
 *
 * Returns a map keyed by product id. A product missing from it has no verdict
 * yet, which the cards treat as "say nothing" rather than as "unavailable" —
 * silence during loading must not read as a refusal.
 */
export const useDeliveryOptions = (productIds, destination) => {
  const [options, setOptions] = useState({});
  const [loading, setLoading] = useState(false);

  // Joined into a primitive so the effect compares by value. A fresh array on
  // every render would restart this on every render.
  const key = (productIds || []).join(',');
  const lat = destination?.lat;
  const lng = destination?.lng;

  useEffect(() => {
    const ids = key ? key.split(',') : [];

    // No address means no answer to give. Asking anyway would spend a request to
    // be told what we already know.
    if (ids.length === 0 || lat === undefined || lng === undefined) {
      setOptions({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(apiUrl('/api/products/delivery-options'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: ids, destination: { lat, lng } }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setOptions(res.ok ? (body.data || {}) : {});
      } catch {
        // A failed lookup shows no badge. Showing one anyway would be promising
        // a delivery on the strength of a request that never arrived.
        if (!cancelled) setOptions({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [key, lat, lng]);

  return { options, loading };
};

/**
 * The same question for one product, with the quantity the customer wants.
 *
 * Separate from the batch because the product page has a quantity selector, and
 * three of something is a different question from one when two are in stock.
 */
export const useProductDeliveryOptions = (productId, destination, qty = 1) => {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);

  const lat = destination?.lat;
  const lng = destination?.lng;

  useEffect(() => {
    if (!productId || lat === undefined || lng === undefined) {
      setOptions(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const qs = new URLSearchParams({ lat: String(lat), lng: String(lng), qty: String(qty) });
        const res = await fetch(apiUrl(`/api/products/${productId}/delivery-options?${qs}`));
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setOptions(res.ok ? (body.data || null) : null);
      } catch {
        if (!cancelled) setOptions(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [productId, lat, lng, qty]);

  return { options, loading };
};
