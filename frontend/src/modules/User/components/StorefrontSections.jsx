import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { useProducts } from '../hooks/useProducts';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { countdown } from '../../../utils/storefront';
import WishlistHeartButton from './WishlistHeartButton';
import StorefrontMedia from './StorefrontMedia';
import Celebration from './Celebration';
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
  const dealDisc = Number(product.discountValue) || 0;
  const computedDealPrice = product.campaignPrice != null
    ? Number(product.campaignPrice)
    : (dealDisc > 0 ? Math.max(0, Math.round(Number(product.price) * (1 - dealDisc / 100))) : Number(product.price));
  const price = wholesale ? (tierPrices.length ? Math.min(...tierPrices) : null) : deal ? computedDealPrice : product.price;
  const original = wholesale ? null : deal ? (product.mrp || product.price) : product.mrp;
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
  const computedPercent = Number(original) > Number(price) ? Math.floor((original - price) / original * 100) : 0;
  const percent = deal && dealDisc > 0 ? Math.max(dealDisc, computedPercent) : computedPercent;
  return <article className="sf-product">
    <div className="sf-product-image"><button type="button" onClick={open} aria-label={`View ${product.name}`}>{artwork && !failed ? <img src={artwork.startsWith('/uploads/') ? apiUrl(artwork) : artwork} alt={product.name} loading="lazy" onError={() => setFailed(true)} /> : <span className="sf-no-image">Image unavailable</span>}</button>{!wholesale && <WishlistHeartButton productId={id} size={18} />}</div>
    <div className="sf-product-body"><button type="button" className="sf-product-title" onClick={open}>{product.name}</button>
      {product.rating > 0 && <span className="sf-rating" aria-label={`${product.rating} out of 5 stars`}>★ {Number(product.rating).toFixed(1)}</span>}
      <div className="sf-price"><strong>{price == null ? 'Price unavailable' : `${wholesale ? 'From ' : ''}${money(price)}`}</strong>{percent >= 1 && <><del>{money(original)}</del><span>{percent}% off</span></>}</div>
      {wholesale && available && <small>Per unit · Minimum {Math.min(...wholesaleVariants.map(v => v.minimumQuantity || 1))} units. Price depends on quantity.</small>}
      <button type="button" className="sf-add" disabled={!available || busy} onClick={add}>{!available ? 'Out of stock' : busy ? 'Adding…' : wholesale ? 'View bulk options' : deal || product.variants?.length ? 'Choose options' : 'Add to cart +'}</button>
      {message && <small role="status">{message}</small>}
    </div>
  </article>;
}
export function FestiveDealCard({ product, deal = false }) {
  const { setSelectedProduct } = useUser();
  const navigate = usePromotionNavigation();
  const [failed, setFailed] = useState(false);
  const id = product.id || product._id;
  const dealDisc = Number(product.discountValue) || 0;
  const computedDealPrice = product.campaignPrice != null
    ? Number(product.campaignPrice)
    : (dealDisc > 0 ? Math.max(0, Math.round(Number(product.price) * (1 - dealDisc / 100))) : Number(product.price));
  const price = deal ? computedDealPrice : product.price;
  const firstImage = product.images?.[0] || product.image;
  const artwork = typeof firstImage === 'string' ? firstImage : firstImage?.url || firstImage?.secure_url || '';
  const open = () => deal ? navigate({ type: 'PRODUCT', id }) : setSelectedProduct(product);

  return (
    <article className="sf-festive-deal-card" onClick={open} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && open()} aria-label={`View deal for ${product.name}`}>
      <div className="sf-festive-deal-art">
        {artwork && !failed ? (
          <img src={artwork.startsWith('/uploads/') ? apiUrl(artwork) : artwork} alt={product.name} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span className="sf-no-image">No image</span>
        )}
      </div>
      <div className="sf-festive-deal-title">{product.name}</div>
      <div className="sf-festive-deal-price">From {money(price)}*</div>
    </article>
  );
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
      if (!cancelled) setDeal({ products: products.slice(0, c.limit), campaign: body.data?.campaign || null, discountValue: body.data?.campaign?.discountValue, loading: false, error: '' });
    }).catch(() => { if (!cancelled) setDeal({ products: [], loading: false, error: 'Deals could not be loaded' }); });
    return () => { cancelled = true; controller.abort(); };
  }, [c.source, c.campaignId, c.limit, type, retry]);
  if (section.endAt && Date.parse(section.endAt) <= now) return null;
  const remoteCollection = ['campaign', 'wholesale'].includes(c.source);
  const result = remoteCollection ? deal : regular;
  if (!result.loading && !result.error && !result.products.length) return null;
  const isFestiveDeals = c.variant === 'festive_deals' || c.layout === 'festive_grid';
  return <section className={`sf-section sf-section--${c.variant}`} data-source={c.source} data-layout={c.layout || 'rail'} style={{ '--section-background': c.appearance?.background, '--section-text': c.appearance?.text, '--section-accent': c.appearance?.accent }}>
    {section.banner && <div className="sf-section-banner"><StorefrontMedia banner={section.banner} device={device} /><Celebration effect={section.banner.animation} now={now} />{section.banner.destination.type !== 'NONE' && <button className="sf-cta" onClick={() => navigate(section.banner.destination)}>{section.banner.cta || 'Explore collection'} →</button>}</div>}
    {isFestiveDeals ? (
      <div style={{ textAlign: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <span style={{ color: '#d97706', fontSize: '13px', fontWeight: 800 }}>✨ ━━━━ ✦</span>
          <h2 style={{ margin: '0 8px', fontSize: '24px', fontWeight: 900, color: c.appearance?.text || '#b91c1c', letterSpacing: '-0.3px' }}>{c.title}</h2>
          <span style={{ color: '#d97706', fontSize: '13px', fontWeight: 800 }}>✦ ━━━━ ✨</span>
        </div>
        {Boolean(section.description || c.description || deal?.campaign?.description || section.deal?.description) && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#78350f', opacity: 0.9 }}>
            {section.description || c.description || deal?.campaign?.description || section.deal?.description}
          </p>
        )}
      </div>
    ) : (
      <div className="sf-section-heading"><div><span className="sf-eyebrow">{c.source === 'campaign' ? 'LIMITED-TIME DEALS' : c.source === 'wholesale' ? 'FOR YOUR BUSINESS' : 'CURATED FOR YOU'}</span><h2>{c.title}</h2>{Boolean(section.description || c.description || deal?.campaign?.description || section.deal?.description) && <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.88 }}>{section.description || c.description || deal?.campaign?.description || section.deal?.description}</p>}</div>{c.source === 'campaign' && (deal?.discountValue > 0 || deal?.campaign?.discountValue > 0 || section.deal?.discountValue > 0) && <span style={{ backgroundColor: '#dc2626', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontWeight: 900, fontSize: '11px', alignSelf: 'center', marginRight: '8px' }}>UP TO {deal?.discountValue || deal?.campaign?.discountValue || section.deal?.discountValue}% OFF</span>}{c.source === 'campaign' && section.endAt && <time className="sf-countdown" aria-label="Time remaining">{countdown(section.endAt, now)}</time>}{c.source === 'wholesale' && <button className="sf-text-button" onClick={() => setActiveNav('wholesale')}>View all →</button>}</div>
    )}
    {result.loading ? (
      <div className="sf-product-skeleton" role="status">Loading products…</div>
    ) : result.error ? (
      <p role="alert">{result.error} <button onClick={() => remoteCollection ? setRetry(r => r + 1) : regular.retry()}>Retry</button></p>
    ) : isFestiveDeals ? (
      <div className="sf-festive-grid">
        {result.products.map(p => (
          <FestiveDealCard key={p.id || p._id} product={p} deal={c.source === 'campaign'} />
        ))}
      </div>
    ) : (
      <div className="sf-product-rail">
        {result.products.map(p => (
          <MerchandisingCard key={p.id || p._id} product={p} deal={c.source === 'campaign'} wholesale={c.source === 'wholesale'} />
        ))}
      </div>
    )}
    {isFestiveDeals && (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '28px', marginTop: '16px', borderTop: '2px solid rgba(245, 158, 11, 0.35)', paddingTop: '10px' }}>
        <span style={{ fontSize: '18px' }}>🪔</span>
        <span style={{ fontSize: '26px' }}>🪔</span>
        <span style={{ fontSize: '18px' }}>🪔</span>
      </div>
    )}
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
