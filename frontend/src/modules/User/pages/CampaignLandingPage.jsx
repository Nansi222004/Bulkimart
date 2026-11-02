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
          const rawCamp = campaignBody.data || productsBody.data?.campaign || {};
          setCampaign({
            ...rawCamp,
            description: rawCamp.description || productsBody.data?.campaign?.description || '',
            discountValue: rawCamp.discountValue != null ? rawCamp.discountValue : productsBody.data?.campaign?.discountValue,
          });
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
    if (!target) return;
    const catChannel = target.channel || target.type;
    if (catChannel) setActiveMode(catChannel === 'grocery' ? 'quick' : 'shop-all');
    setSelectedCategoryFilter({
      _id: target._id || target.id,
      id: target.id || target._id,
      slug: target.slug || target._id || target.id,
      name: target.name,
      channel: catChannel,
      type: catChannel,
    });
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
          {Boolean(campaign.bannerImage || campaign.image) && (
            <div className="sf-deal-banner" style={{ overflow: 'hidden', borderRadius: 16, border: '1.5px solid #f59e0b', margin: '14px 16px 0' }}>
              <img
                src={(() => {
                  const src = campaign.bannerImage || campaign.image || '';
                  return src.startsWith('/uploads/') ? apiUrl(src) : src;
                })()}
                alt={campaign.name}
                style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
              />
              <Celebration effect={effect} now={now} />
            </div>
          )}
          <div className="sf-deal-details" style={{ margin: '14px 16px', borderRadius: 18, border: '1.5px solid #f59e0b', background: 'linear-gradient(135deg, #450a0a, #7f1d1d, #991b1b)', padding: '20px' }}>
            <Celebration effect={effect} now={now} />
            <div className="sf-deal-details-copy" style={{ position: 'relative', zIndex: 2 }}>
              <div style={{ display: 'inline-block', background: 'rgba(254, 240, 138, 0.22)', border: '1px solid #fde047', padding: '3px 10px', borderRadius: 999, color: '#fef08a', fontSize: 11, fontWeight: 900, marginBottom: 8, letterSpacing: '0.5px' }}>
                ✦ BULKIMART DIOTSAV SPECIAL ✦
              </div>
              <p className="sf-deal-name" style={{ color: '#fff', fontSize: 22, fontWeight: 900, margin: '4px 0 8px' }}>{campaign.name}</p>
              {campaign.description && <p className="sf-deal-description" style={{ color: '#fef2f2', fontSize: 13, lineHeight: '20px', margin: '0 0 10px' }}>{campaign.description}</p>}
              {Number(campaign.discountValue) > 0 && <p className="sf-deal-discount" style={{ display: 'inline-block', background: '#fef08a', color: '#78350f', padding: '4px 12px', borderRadius: 8, fontWeight: 900, fontSize: 16, margin: '6px 0' }}>UP TO {campaign.discountValue}% OFF</p>}
              <p className="sf-deal-dates" style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: 12, margin: '8px 0 14px' }}>
                {day(campaign.startAt)} → {day(campaign.endAt)} · Ends in <time className="sf-countdown" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: '#fef08a' }}>{countdown(campaign.endAt, now)}</time>
              </p>
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
