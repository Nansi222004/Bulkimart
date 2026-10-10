import { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Real product data for the customer app.
 *
 * The landing-page sections used to render hardcoded demo arrays from
 * constants/index.js. They now read live listings, so a section is empty until a
 * seller actually publishes into it — which is the honest behaviour.
 *
 * The API shape differs from the old mock shape, so results are normalised once
 * here and every section keeps rendering the same fields it always did.
 */

/** API product → the shape the existing cards expect. */
export const normalizeProduct = (p) => ({
  id: p._id,
  _id: p._id,
  name: p.name,
  image: p.images?.[0] || '',
  images: p.images || [],
  price: p.price,
  mrp: p.mrp,
  discountPercent: p.discountPercent,
  unit: p.unit,
  stock: p.stock,
  // the old cards showed a vendor line under the name
  shg: p.shgStoreId?.groupName || p.sellerId?.storeDetails?.name || p.sellerId?.businessName || '',
  category: p.category?.name || '',
  categoryId: p.category?._id || p.category,
  type: p.type,
  rating: p.ratings?.average || 0,
  raw: p,
});

/**
 * @param {object} options
 *   type      - 'ecommerce' | 'grocery' | 'shg'
 *   category  - category _id
 *   limit     - how many to fetch (default 12)
 *   featured  - only featured products
 */
export const useProducts = ({ type, category, limit = 12, featured, lat, lng } = {}) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams();
        if (type) qs.set('type', type);
        if (category) qs.set('category', category);
        if (featured) qs.set('isFeatured', 'true');
        if (lat !== undefined && lat !== null) qs.set('lat', String(lat));
        if (lng !== undefined && lng !== null) qs.set('lng', String(lng));
        qs.set('limit', String(limit));

        const res = await fetch(apiUrl(`/api/products?${qs.toString()}`));
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.message || `Products unavailable (${res.status})`);

        // /api/products answers { success, total, page, limit, products }
        const rows = body.products || body.data || [];
        setProducts(rows.map(normalizeProduct));
      } catch (err) {
        if (!cancelled) { setError(err.message); setProducts([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [type, category, limit, featured, lat, lng, retryToken]);

  const retry = () => setRetryToken((value) => value + 1);

  return { products, loading, error, retry };
};

export default useProducts;
