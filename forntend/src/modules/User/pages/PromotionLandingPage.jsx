import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';

/**
 * Where a Seller Promotion banner lands (Section 25). Reads only the public
 * GET /api/promotions/:id endpoint, which already enforces the full
 * visibility gate (APPROVED + PAYMENT_CONFIRMED + ACTIVE + not expired) and
 * fetches products live — a deleted/deactivated product just isn't in the
 * list, same as CampaignLandingPage.jsx does for its own domain.
 */
const PromotionLandingPage = () => {
  const { selectedPromotionId, setSelectedPromotionId, addToCart, setSelectedProduct } = useUser();

  const [promotion, setPromotion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedPromotionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl(`/api/promotions/${selectedPromotionId}`));
        if (!res.ok) throw new Error('This promotion has ended or is not available right now.');
        const body = await res.json();
        if (!cancelled) setPromotion(body.data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load this promotion.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPromotionId]);

  if (!selectedPromotionId) return null;

  return (
    <div className="product-detail-page">
      <div className="pd-sticky-header">
        <button className="pd-back-btn" onClick={() => setSelectedPromotionId(null)} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{promotion?.shop?.name || 'Store'}</span>
        <div style={{ width: 36 }} />
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8', fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{error}</p>
        </div>
      ) : (
        <>
          {promotion.bannerImage && (
            <div style={{ margin: '16px 16px 12px', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <img src={promotion.bannerImage} alt={promotion.title} style={{ width: '100%', height: 'auto', aspectRatio: '2.6 / 1', objectFit: 'cover', display: 'block' }} />
            </div>
          )}

          <div style={{ padding: '0 16px 12px' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{promotion.shop?.name}</h2>
            <p style={{ margin: '0 0 2px', fontSize: 12.5, color: '#64748b' }}>{promotion.shop?.sellerName}</p>
            {promotion.shop?.address && (
              <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#64748b' }}>📍 {promotion.shop.address}</p>
            )}
            {promotion.shop?.description && (
              <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#475569' }}>{promotion.shop.description}</p>
            )}
          </div>

          <p style={{ margin: '4px 16px 8px', fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Featured Products</p>

          {(!promotion.products || promotion.products.length === 0) ? (
            <p style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: 13 }}>
              No products are currently available from this promotion.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '4px 16px 24px' }}>
              {promotion.products.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProduct({ id: p.id, _id: p.id, name: p.name, image: p.image, images: [p.image], price: p.price, mrp: p.mrp, stock: p.stock, type: p.type })}
                  style={{ background: '#fff', borderRadius: 14, border: '1px solid #f1f5f9', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                >
                  <div style={{ aspectRatio: '1 / 1', background: '#f8fafc' }}>
                    {p.image ? <img src={p.image} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.name}
                    </p>
                    <span style={{ fontSize: 13.5, fontWeight: 900, color: '#0f172a' }}>{formatCurrency(p.price)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                      style={{ marginTop: 'auto', padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
                    >
                      Add to Cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PromotionLandingPage;
