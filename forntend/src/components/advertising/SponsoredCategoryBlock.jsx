import React, { useEffect, useState, useRef } from 'react';
import { observeAdImpressions, sendAdEvent } from './advertisingTelemetry';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { useUser } from '../../modules/User/context/UserContext';
import { normalizeProduct } from '../../modules/User/hooks/useProducts';
import ProductCard from '../../modules/User/components/CategoryProductCard';
import './advertising.css';

export function uniqueSponsoredProducts(rows, organicIds) {
  const seen = new Set(organicIds.map(String)), result = [];
  for (const row of rows || []) {
    const id = row.product?._id;
    if (!id || seen.has(String(id)) || !['NON_BILLABLE_PILOT','PAID_CATEGORY'].includes(row.mode) || row.disclosure !== 'Sponsored') continue;
    seen.add(String(id)); result.push(row);
  }
  return result.slice(0, 4);
}

// Optional independent read. Organic rendering never waits on this request.
export default function SponsoredCategoryBlock({ channel, categoryId, organicProducts = [], ready = true }) {
  const { getDeliveryPoint, setSelectedProduct, addToCart } = useUser();
  const point = getDeliveryPoint?.();
  const lat = point?.lat, lng = point?.lng;
  const organicKey = organicProducts.map(p => String(p.id || p._id)).sort().join(',');
  const context = `${channel}:${categoryId}:${lat}:${lng}:${organicKey}`;
  const [result, setResult] = useState(null), [tick, setTick] = useState(0);
  const blockRef=useRef(null);
  useEffect(() => {
    if (!ready || !categoryId || !['ecommerce', 'grocery'].includes(channel)) return;
    let alive = true;
    setResult(null);
    const controller = new AbortController();
    const query = new URLSearchParams({ type: channel, category: categoryId });
    if (organicKey) query.set('exclude', organicKey);
    if (Number.isFinite(lat) && Number.isFinite(lng)) { query.set('lat', String(lat)); query.set('lng', String(lng)); }
    boundedFetch(apiUrl(`/api/advertising/placements?${query}`), { signal: controller.signal, cache: 'no-store' }, 4000)
      .then(async response => {
        const body = await response.json();
        if (alive && response.ok && ['NON_BILLABLE_PILOT','SPONSORED_CATEGORY'].includes(body.meta?.mode)) {
          setResult({ context, rows: uniqueSponsoredProducts(body.data, organicKey ? organicKey.split(',') : []) });
        }
      }).catch(() => {});
    // Refresh live eligibility; merely returning cards never records a view.
    const timer = setTimeout(() => { if (alive) { setResult(null); setTick(n => n + 1); } }, 30000);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [context, ready, tick]);
  useEffect(() => {
    if (!result?.rows.length) return;
    const expiry = Math.min(...result.rows.map(row => new Date(row.expiresAt).getTime()));
    if (!Number.isFinite(expiry)) { setResult(null); return; }
    const timer = setTimeout(() => setResult(null), Math.max(1, Math.min(2147483647, expiry - Date.now())));
    return () => clearTimeout(timer);
  }, [result]);
  useEffect(()=>observeAdImpressions(blockRef.current,ready&&result?.context===context?result.rows:[]),[result,context,ready]);
  const rows = ready && result?.context === context ? result.rows : [];
  if (!rows.length) return null;
  return <section ref={blockRef} className="sponsored-category-block" aria-label="Sponsored products">
    <header><h2>Sponsored</h2><span>{rows.every(r=>r.mode==='NON_BILLABLE_PILOT')?'Non-billable pilot':'Sponsored category'}</span></header>
    <div className="sponsored-category-grid">
      {rows.map((row,index) => {
        const product = normalizeProduct(row.product);
        // Preserve the promoted variant through the existing detail selection.
        product.variants.sort((a, b) => Number(b.id === row.variantId) - Number(a.id === row.variantId));
        const open = () => {sendAdEvent(row.serveToken,'CLICK');setSelectedProduct(product);};
        return <article key={product.id} data-ad-index={index} className="sponsored-category-item">
          <span className="sponsored-disclosure">Sponsored</span>
          {row.mode==='NON_BILLABLE_PILOT'&&<small> Non-billable pilot</small>}
          <ProductCard product={product} onOpen={open} onAdd={() => addToCart(product, 1, row.variantId || undefined)} />
          <button className="sponsored-product-link" type="button" onClick={open}>View {product.name}</button>
        </article>;
      })}
    </div>
  </section>;
}
