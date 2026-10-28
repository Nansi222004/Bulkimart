import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { formatCurrency } from '../utils/helpers';
import { boundedFetch } from '../../../utils/portalRequests';
import { useStorefront } from '../context/StorefrontContext';
import { countdown } from '../../../utils/storefront';
import { MerchandisingCard } from '../components/StorefrontSections';
import Celebration from '../components/Celebration';

/**
 * Where a Campaign banner lands. Reads only the public, already-filtered
 * campaign endpoints — everything here is either ACTIVE right now or it
 * isn't shown at all, the same rule the backend enforces at checkout.
 */
const CampaignLandingPage = () => {
  // Campaign-page effects stay inside the deal hero below.
  const { now, effect } = useStorefront();
  const { selectedCampaignId, setSelectedCampaignId, setSelectedCategoryFilter, setActiveMode } = useUser();

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
  // A category deal links to its category, opened in that category's own storefront.
  const target = campaign?.targetCategory;
  const shopCategory = () => {
    setSelectedCampaignId(null);
    if (target.type) setActiveMode(target.type === 'grocery' ? 'quick' : 'shop-all');
    setSelectedCategoryFilter({ _id: target.id, slug: target.slug, name: target.name });
  };
  const shopButton = target && <button type="button" className="sf-deal-shop" onClick={shopCategory}>Shop {target.name} →</button>;
  const day = date => new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

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
          {/* The banner image, when there is one, then the deal details: shown in both cases. */}
          {campaign.bannerImage && (
            <div className="sf-deal-banner">
              <img src={campaign.bannerImage} alt={campaign.name} />
              <Celebration effect={effect} now={now} />
            </div>
          )}
          <div className="sf-deal-details">
            {!campaign.bannerImage && <Celebration effect={effect} now={now} />}
            <div className="sf-deal-details-copy">
              <p className="sf-deal-name">{campaign.name}</p>
              {campaign.description && <p className="sf-deal-description">{campaign.description}</p>}
              {Number(campaign.discountValue) > 0 && <p className="sf-deal-discount">{campaign.discountValue}% OFF</p>}
              <p className="sf-deal-dates">{day(campaign.startAt)} → {day(campaign.endAt)} · Ends in <time className="sf-countdown">{countdown(campaign.endAt, now)}</time></p>
              {shopButton}
            </div>
          </div>

          {products.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8', fontSize: 13 }}>
              <p style={{ margin: '0 0 12px' }}>No products are participating in this deal yet.</p>
              {shopButton}
            </div>
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
