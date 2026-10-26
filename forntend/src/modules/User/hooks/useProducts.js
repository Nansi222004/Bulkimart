import { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';

const catalogRequests = new Map();
// Share identical public catalog requests across merchandising sections.
export async function readCatalog(url, fresh = false) {
  const existing = catalogRequests.get(url);
  if (existing && (!fresh || !existing.done) && (!existing.done || existing.until > Date.now())) return existing.promise;
  const entry = { done: false, until: 0 };
  entry.promise = boundedFetch(url).then(async res => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || `Products unavailable (${res.status})`);
    const rows = body.products || body.data;
    if (!Array.isArray(rows)) throw new Error('Products returned an invalid response');
    entry.done = true; entry.until = Date.now() + 15000;
    return rows.map(normalizeProduct);
  }).catch(error => { if (catalogRequests.get(url) === entry) catalogRequests.delete(url); throw error; });
  catalogRequests.set(url, entry);
  if (catalogRequests.size > 50) catalogRequests.delete(catalogRequests.keys().next().value);
  return entry.promise;
}

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
  description: p.description,
  brandName: p.brandName,
  sku: p.sku,
  detailSource: p.detailSource,
  retailAvailable: p.retailAvailable,
  image: p.images?.[0] || '',
  images: p.images || [],
  price: p.price,
  mrp: p.mrp,
  discountPercent: p.discountPercent,
  unit: p.unit,
  // E-books without a seller copy limit never run out.
  stock: p.fulfillmentType === 'digital' && !p.digital?.stockTracked ? 1 : p.stock,
  variants: (p.variants || []).map((variant) => ({
    id: variant._id,
    name: variant.name,
    price: variant.price,
    mrp: variant.mrp,
    stock: variant.stock,
    sku: variant.sku,
    unit: variant.unit,
    weight: variant.weight,
    attributes: variant.attributes || [],
  })),
  // the old cards showed a vendor line under the name
  shg: p.shgStoreId?.groupName || p.sellerId?.storeDetails?.name || p.sellerId?.businessName || '',
  category: p.category?.name || '',
  categoryId: p.category?._id || p.category,
  type: p.type,
  fulfillmentType: p.fulfillmentType || 'physical',
  digital: p.digital ? {
    author: p.digital.author,
    language: p.digital.language,
    licenseTerms: p.digital.licenseTerms,
    format: p.digital.format,
    stockTracked: Boolean(p.digital.stockTracked),
  } : null,
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
export const useProducts = ({ type, category, limit = 12, featured, maxPrice, lat, lng, enabled = true } = {}) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!enabled) { setProducts([]); setLoading(false); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams();
        if (type) qs.set('type', type);
        if (category) qs.set('category', category);
        if (featured) qs.set('isFeatured', 'true');
        if (maxPrice !== undefined) qs.set('maxPrice', String(maxPrice));
        if (lat !== undefined && lat !== null) qs.set('lat', String(lat));
        if (lng !== undefined && lng !== null) qs.set('lng', String(lng));
        qs.set('limit', String(limit));

        const rows = await readCatalog(apiUrl(`/api/products?${qs.toString()}`), retryToken > 0);
        if (cancelled) return;
        setProducts(rows);
      } catch (err) {
        if (!cancelled) { setError(err.message); setProducts([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [type, category, limit, featured, maxPrice, lat, lng, retryToken, enabled]);

  const retry = () => setRetryToken((value) => value + 1);

  return { products, loading, error, retry };
};

export default useProducts;
