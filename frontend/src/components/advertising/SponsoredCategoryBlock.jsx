import React, { useEffect, useState, useRef } from 'react';
import { observeAdImpressions, sendAdEvent } from './advertisingTelemetry';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { useUser } from '../../modules/User/context/UserContext';
import { normalizeProduct } from '../../modules/User/hooks/useProducts';
import WishlistHeartButton from '../../modules/User/components/WishlistHeartButton';
import './advertising.css';

export function uniqueSponsoredProducts(rows, skipIds = []) {
  const seen = new Set(skipIds.map(String)), result = [];
  for (const row of rows || []) {
    const id = row.product?._id;
    if (!id || seen.has(String(id)) || !['NON_BILLABLE_PILOT','PAID_CATEGORY'].includes(row.mode) || row.disclosure !== 'Sponsored') continue;
    seen.add(String(id)); result.push(row);
  }
  return result.slice(0, 4);
}

// Optional independent read. Organic rendering never waits on this request.
// An advertised product usually also belongs to the page's own product list, so it is never left
// out here: the page hides the products reported through onShown from its list instead, and each
// product still appears once.
export default function SponsoredCategoryBlock({ channel, categoryId, ready = true, onShown }) {
  const { getDeliveryPoint, setSelectedProduct, addToCart, setActiveNav } = useUser();
  const point = getDeliveryPoint?.();
  const lat = point?.lat, lng = point?.lng;
  const context = `${channel}:${categoryId}:${lat}:${lng}`;
  const [result, setResult] = useState(null), [tick, setTick] = useState(0);
  const blockRef=useRef(null);
  useEffect(() => {
    if (!ready || !categoryId || !['ecommerce', 'grocery'].includes(channel)) return;
    let alive = true;
    setResult(null);
    const controller = new AbortController();
    const query = new URLSearchParams({ type: channel, category: categoryId });
    if (Number.isFinite(lat) && Number.isFinite(lng)) { query.set('lat', String(lat)); query.set('lng', String(lng)); }
    boundedFetch(apiUrl(`/api/advertising/placements?${query}`), { signal: controller.signal, cache: 'no-store' }, 4000)
      .then(async response => {
        const body = await response.json();
        if (alive && response.ok && ['NON_BILLABLE_PILOT','SPONSORED_CATEGORY'].includes(body.meta?.mode)) {
          setResult({ context, rows: uniqueSponsoredProducts(body.data) });
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
  const shownKey = rows.map(row => String(row.product._id)).join(',');
  useEffect(() => { onShown?.(shownKey ? shownKey.split(',') : []); }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  return <section ref={blockRef} className="sponsored-category-block" aria-labelledby="sponsored-for-you">
    <header className="sponsored-head">
      <h2 id="sponsored-for-you">Sponsored for you <span className="sponsored-ad-pill" title="These products are promoted by sellers">Ad</span></h2>
      <p>{rows.every(r=>r.mode==='NON_BILLABLE_PILOT') ? 'Non-billable pilot' : 'Promoted products in this category'}</p>
    </header>
    <div className="sponsored-rail" role="list">
      {rows.map((row,index) => {
        const product = normalizeProduct(row.product);
        // Preserve the promoted variant through the existing detail selection.
        product.variants.sort((a, b) => Number(b.id === row.variantId) - Number(a.id === row.variantId));
        const open = () => {sendAdEvent(row.serveToken,'CLICK');setSelectedProduct(product);};
        return <SponsoredProductCard key={product.id} index={index} product={product} variantId={row.variantId} pilot={row.mode==='NON_BILLABLE_PILOT'}
          onOpen={open} addToCart={addToCart} onSignIn={() => setActiveNav?.('account')} />;
      })}
    </div>
  </section>;
}

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
// One sponsored product, shaped like the storefront's product cards (MerchandisingCard): the whole
// card opens the product; the cart and wishlist buttons act on their own. A product with several
// variants opens its details to choose one, as elsewhere in the shop; otherwise the promoted
// variant is added directly.
export function SponsoredProductCard({ product, variantId, index, pilot = false, onOpen, addToCart, onSignIn }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const available = product.fulfillmentType === 'digital' || product.stock > 0;
  const choose = product.variants.length > 1;
  const discount = Number(product.mrp) > Number(product.price) ? Math.floor((product.mrp - product.price) / product.mrp * 100) : 0;
  const image = product.image && !failed ? (product.image.startsWith('/uploads/') ? apiUrl(product.image) : product.image) : '';
  const add = async event => {
    event.stopPropagation();
    if (busy) return;
    if (choose) { onOpen(); return; }
    setBusy(true); setMessage('');
    try {
      const result = await addToCart(product, 1, variantId || undefined);
      if (result?.ok) setMessage('Added to cart');
      else if (/sign in/i.test(result?.message || '')) onSignIn?.();
      else if (result?.message) setMessage(result.message);
    } catch { setMessage('Could not add item. Try again.'); } finally { setBusy(false); }
  };
  return <article data-ad-index={index} className="sponsored-category-item" role="listitem" onClick={onOpen}>
    <div className="sponsored-media">
      {image ? <img src={image} alt={product.name} loading="lazy" onError={() => setFailed(true)} /> : <span className="sponsored-no-image">Image unavailable</span>}
      <span className="sponsored-disclosure">Sponsored</span>
      <WishlistHeartButton productId={product.id} size={16} className="sponsored-wishlist" />
    </div>
    <div className="sponsored-body">
      <button className="sponsored-product-link" type="button" onClick={event => { event.stopPropagation(); onOpen(); }}>{product.name}</button>
      {product.sellerName && <span className="sponsored-seller">{product.sellerName}</span>}
      {pilot && <small className="sponsored-pilot">Non-billable pilot</small>}
      <div className="sponsored-price">
        <strong>{money(product.price)}</strong>
        {discount > 0 && <><del>{money(product.mrp)}</del><span>{discount}% off</span></>}
      </div>
      <button type="button" className="sponsored-add" disabled={!available || busy} onClick={add}>
        {!available ? 'Out of stock' : busy ? 'Adding…' : choose ? 'Choose options' : 'Add to cart'}
      </button>
      {message && <small className="sponsored-message" role="status">{message}</small>}
    </div>
  </article>;
}
