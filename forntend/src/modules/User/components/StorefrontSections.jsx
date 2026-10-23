import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { useProducts } from '../hooks/useProducts';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { countdown } from '../../../utils/storefront';
import WishlistHeartButton from './WishlistHeartButton';
import StorefrontMedia from './StorefrontMedia';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import { openWholesaleProduct } from '../utils/productRoute';
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
export function MerchandisingCard({ product, deal = false, wholesale = false }) {
  const { addToCart, setSelectedProduct, setActiveNav } = useUser();
  const navigate = usePromotionNavigation();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const id = product.id || product._id;
  const wholesaleVariants = wholesale ? (product.variants || []).filter(v => v.available) : [];
  const tierPrices = wholesaleVariants.flatMap(v => (v.priceTiers || []).map(t => Number(t.unitPrice))).filter(p => Number.isFinite(p) && p >= 0);
  const price = wholesale ? (tierPrices.length ? Math.min(...tierPrices) : null) : deal ? product.campaignPrice : product.price;
  const original = wholesale ? null : deal ? product.price : product.mrp;
  const available = wholesale ? wholesaleVariants.length > 0 : product.fulfillmentType === 'digital' || product.stock > 0 || product.variants?.some(v => v.stock > 0);
  const firstImage = product.images?.[0];
  const artwork = wholesale ? (typeof firstImage === 'string' ? firstImage : firstImage?.url || firstImage?.secure_url || '') : product.image;
  const open = () => wholesale ? openWholesaleProduct(id, wholesaleVariants[0]?.variantId) : deal ? navigate({ type: 'PRODUCT', id }) : setSelectedProduct(product);
  const add = async () => {
    if (busy) return;
    // Existing product details resolve variants and current authoritative deal prices.
    if (wholesale || deal || product.variants?.length) { open(); return; }
    setBusy(true); setMessage('');
    try { const result = await addToCart(product); if (result?.ok) setMessage('Added to cart'); else if (/sign in/i.test(result?.message || '')) setActiveNav('account'); else setMessage(result?.message || 'Could not add item'); }
    catch { setMessage('Could not add item. Try again.'); } finally { setBusy(false); }
  };
  return <article className="sf-product">
    <div className="sf-product-image"><button onClick={open} aria-label={`View ${product.name}`}>{artwork && !failed ? <img src={artwork.startsWith('/uploads/') ? apiUrl(artwork) : artwork} alt={product.name} loading="lazy" onError={() => setFailed(true)} /> : <span className="sf-no-image">Image unavailable</span>}</button>{!wholesale && <WishlistHeartButton productId={id} size={18} />}</div>
    <div className="sf-product-body"><button className="sf-product-title" onClick={open}>{product.name}</button>
      {product.rating > 0 && <span className="sf-rating" aria-label={`${product.rating} out of 5 stars`}>★ {Number(product.rating).toFixed(1)}</span>}
      <div className="sf-price"><strong>{price == null ? 'Price unavailable' : `${wholesale ? 'From ' : ''}${money(price)}`}</strong>{Number(original) > Number(price) && <><del>{money(original)}</del><span>{Math.floor((original - price) / original * 100)}% off</span></>}</div>
      {wholesale && available && <small>Per unit · Minimum {Math.min(...wholesaleVariants.map(v => v.minimumQuantity || 1))} units. Price depends on quantity.</small>}
      <button className="sf-add" disabled={!available || busy} onClick={add}>{!available ? 'Out of stock' : busy ? 'Adding…' : wholesale ? 'View bulk options' : deal || product.variants?.length ? 'Choose options' : 'Add to cart +'}</button>
      {message && <small role="status">{message}</small>}
    </div>
  </article>;
}
export function StorefrontSection({ section }) {
  const { activeMode, setActiveNav } = useUser();
  const { now, device } = useStorefront();
  const c = section.config, type = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  const navigate = usePromotionNavigation();
  const regular = useProducts({ type, category: c.source === 'category' ? c.categoryId : undefined, featured: c.source === 'featured', maxPrice: c.source === 'price' ? c.maxPrice : undefined, limit: c.limit, enabled: !['campaign', 'wholesale'].includes(c.source) });
  const [deal, setDeal] = useState({ products: [], loading: true, error: '' }), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!['campaign', 'wholesale'].includes(c.source)) return;
    let cancelled = false; const controller = new AbortController();
    setDeal({ products: [], loading: true, error: '' });
    const path = c.source === 'wholesale' ? `/api/products/wholesale/catalog?limit=${c.limit}` : `/api/campaigns/${c.campaignId}/products?type=${type}`;
    boundedFetch(apiUrl(path), { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error('Deals unavailable');
      const products = c.source === 'wholesale' ? body.data : (body.data?.products || []).filter(p => p.type === type);
      if (!Array.isArray(products)) throw new Error('Invalid collection response');
      if (!cancelled) setDeal({ products: products.slice(0, c.limit), loading: false, error: '' });
    }).catch(() => { if (!cancelled) setDeal({ products: [], loading: false, error: 'Deals could not be loaded' }); });
    return () => { cancelled = true; controller.abort(); };
  }, [c.source, c.campaignId, c.limit, type, retry]);
  if (section.endAt && Date.parse(section.endAt) <= now) return null;
  const remoteCollection = ['campaign', 'wholesale'].includes(c.source);
  const result = remoteCollection ? deal : regular;
  if (!result.loading && !result.error && !result.products.length) return null;
  return <section className={`sf-section sf-section--${c.variant}`}>
    {section.banner && <div className="sf-section-banner"><StorefrontMedia banner={section.banner} device={device} active={false} />{section.banner.destination.type !== 'NONE' && <button className="sf-cta" onClick={() => navigate(section.banner.destination)}>{section.banner.cta || 'Explore collection'} →</button>}</div>}
    <div className="sf-section-heading"><div><span className="sf-eyebrow">{c.source === 'campaign' ? 'LIMITED-TIME DEALS' : c.source === 'wholesale' ? 'FOR YOUR BUSINESS' : 'CURATED FOR YOU'}</span><h2>{c.title}</h2></div>{c.source === 'campaign' && section.endAt && <time className="sf-countdown" aria-label="Time remaining">{countdown(section.endAt, now)}</time>}{c.source === 'wholesale' && <button className="sf-text-button" onClick={() => setActiveNav('wholesale')}>View all →</button>}</div>
    {result.loading ? <div className="sf-product-skeleton" role="status">Loading products…</div> : result.error ? <p role="alert">{result.error} <button onClick={() => remoteCollection ? setRetry(r => r + 1) : regular.retry()}>Retry</button></p> : <div className="sf-product-rail">{result.products.map(p => <MerchandisingCard key={p.id || p._id} product={p} deal={c.source === 'campaign'} wholesale={c.source === 'wholesale'} />)}</div>}
  </section>;
}
export function StorefrontAnnouncement() {
  const { announcement } = useStorefront(); const navigate = usePromotionNavigation();
  if (!announcement) return null;
  return <aside className="sf-announcement"><span>{announcement.banner.title}</span>{announcement.banner.destination.type !== 'NONE' && <button onClick={() => navigate(announcement.banner.destination)}>{announcement.banner.cta || 'Explore'} →</button>}</aside>;
}
export default function StorefrontSections() {
  const { sections } = useStorefront();
  return sections.map(section => <StorefrontSection key={`${section.id}:${section.revision}`} section={section} />);
}
