import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';
import { boundedFetch } from '../../../utils/portalRequests';
import { useStorefront } from '../context/StorefrontContext';
import { countdown } from '../../../utils/storefront';
import { MerchandisingCard } from '../components/StorefrontSections';

/**
 * Where a Campaign banner lands. Reads only the public, already-filtered
 * campaign endpoints — everything here is either ACTIVE right now or it
 * isn't shown at all, the same rule the backend enforces at checkout.
 */
const CampaignLandingPage = () => {
  const { now } = useStorefront();
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
          boundedFetch(apiUrl(`/api/campaigns/${selectedCampaignId}`)),
          boundedFetch(apiUrl(`/api/campaigns/${selectedCampaignId}/products`)),
        ]);
        if (!campaignRes.ok) throw new Error('This deal has ended or is not available right now.');
        if (!productsRes.ok) throw new Error('Deal products could not be loaded. Reopen this deal to retry.');
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
      ) : error || (campaign?.endAt && Date.parse(campaign.endAt) <= now) ? (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{error || 'This deal has ended.'}</p>
        </div>
      ) : (
        <>
          <p style={{ padding: '12px 16px' }}>Ends in <time className="sf-countdown">{countdown(campaign.endAt, now)}</time></p>
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
              {products.map(p => <MerchandisingCard key={p.id} product={p} deal />)}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CampaignLandingPage;
