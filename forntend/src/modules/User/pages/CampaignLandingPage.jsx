import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';

/**
 * Where a Campaign banner lands. Reads only the public, already-filtered
 * campaign endpoints — everything here is either ACTIVE right now or it
 * isn't shown at all, the same rule the backend enforces at checkout.
 */
const CampaignLandingPage = () => {
  const { selectedCampaignId, setSelectedCampaignId, addToCart, setSelectedProduct } = useUser();

  const [campaign, setCampaign] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedCampaignId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [campaignRes, productsRes] = await Promise.all([
          fetch(apiUrl(`/api/campaigns/${selectedCampaignId}`)),
          fetch(apiUrl(`/api/campaigns/${selectedCampaignId}/products`)),
        ]);
        if (!campaignRes.ok) throw new Error('This deal has ended or is not available right now.');
        const campaignBody = await campaignRes.json();
        const productsBody = await productsRes.json().catch(() => ({}));
        if (!cancelled) {
          setCampaign(campaignBody.data);
          setProducts(productsBody.data?.products || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load this deal.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCampaignId]);

  if (!selectedCampaignId) return null;

  return (
    <div className="product-detail-page">
      <div className="pd-sticky-header">
        <button className="pd-back-btn" onClick={() => setSelectedCampaignId(null)} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{campaign?.name || 'Deal'}</span>
        <div style={{ width: 36 }} />
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8', fontSize: 13 }}>Loading deal…</p>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{error}</p>
        </div>
      ) : (
        <>
          {campaign.bannerImage ? (
            <div style={{ margin: '16px 16px 12px', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <img src={campaign.bannerImage} alt={campaign.name} style={{ width: '100%', height: 'auto', aspectRatio: '2.6 / 1', objectFit: 'cover', display: 'block' }} />
            </div>
          ) : (
            <div style={{
              margin: 16, padding: 18, borderRadius: 16, color: '#fff',
              background: 'linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)',
            }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{campaign.name}</p>
              {campaign.description && <p style={{ margin: '6px 0 0', fontSize: 12.5, opacity: 0.9 }}>{campaign.description}</p>}
              <p style={{ margin: '10px 0 0', fontSize: 22, fontWeight: 900 }}>{campaign.discountValue}% OFF</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.85 }}>
                {new Date(campaign.startAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                {' → '}
                {new Date(campaign.endAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
          )}

          {products.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: 13 }}>
              No products are participating in this deal yet.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '4px 16px 24px' }}>
              {products.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProduct({ id: p.id, _id: p.id, name: p.name, image: p.image, images: p.images, price: p.price, type: p.type })}
                  style={{ background: '#fff', borderRadius: 14, border: '1px solid #f1f5f9', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                >
                  <div style={{ aspectRatio: '1 / 1', background: '#f8fafc' }}>
                    {p.image ? <img src={p.image} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.name}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 900, color: '#b91c1c' }}>{formatCurrency(p.campaignPrice)}</span>
                      <s style={{ fontSize: 11, color: '#94a3b8' }}>{formatCurrency(p.price)}</s>
                    </div>
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

export default CampaignLandingPage;
