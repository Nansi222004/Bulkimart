import React, { useEffect, useState, useMemo } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Campaigns / Deals — Admin-run discount campaigns seller products are invited into.
 */
const money = (n) => '₹' + Math.round(Number(n) || 0);

const STATUS_BADGE = {
  ACTIVE:    { bg: '#dcfce7', fg: '#166534', label: 'Active 🟢' },
  SCHEDULED: { bg: '#e0e7ff', fg: '#3730a3', label: 'Starts soon 🕒' },
  EXPIRED:   { bg: '#f1f5f9', fg: '#64748b', label: 'Ended' },
  DRAFT:     { bg: '#fef3c7', fg: '#92400e', label: 'Draft' },
  DISABLED:  { bg: '#fee2e2', fg: '#991b1b', label: 'Disabled' },
};

export const SellerCampaignsTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openCampaignId, setOpenCampaignId] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const token = () => localStorage.getItem('userToken');

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/sellers/campaigns'), {
        headers: { Authorization: 'Bearer ' + token() },
      });
      const body = await res.json().catch(() => ({}));
      setCampaigns(body.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchCampaigns(); }, []);

  const openDetail = async (campaignId) => {
    setOpenCampaignId(campaignId);
    setDetailLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(apiUrl(`/api/sellers/campaigns/${campaignId}`), {
        headers: { Authorization: 'Bearer ' + token() },
      });
      const body = await res.json().catch(() => ({}));
      setDetail(body.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleSelect = (productId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(productId)) next.delete(productId); else next.add(productId);
    return next;
  });

  const acceptSelected = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/sellers/campaigns/${openCampaignId}/accept`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ productIds: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.message || 'Could not accept'); return; }
      const skipped = body.data?.skipped || [];
      if (skipped.length) alert(`${skipped.length} product(s) could not join: ${skipped.map((s) => s.reason).join(', ')}`);
      await openDetail(openCampaignId);
      await fetchCampaigns();
    } finally {
      setBusy(false);
    }
  };

  const rejectCampaign = async () => {
    if (!window.confirm('Decline this campaign for all remaining pending products?')) return;
    setBusy(true);
    try {
      await fetch(apiUrl(`/api/sellers/campaigns/${openCampaignId}/reject`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({}),
      });
      await openDetail(openCampaignId);
      await fetchCampaigns();
    } finally {
      setBusy(false);
    }
  };

  // KPI calculations
  const totalCampaigns = campaigns.length;
  const activeCount = campaigns.filter(c => c.lifecycle === 'ACTIVE').length;
  const totalEligible = campaigns.reduce((sum, c) => sum + (c.eligible || 0), 0);
  const totalAccepted = campaigns.reduce((sum, c) => sum + (c.accepted || 0), 0);

  if (openCampaignId) {
    const products = detail?.products || [];
    const pending = products.filter((p) => p.status === 'PENDING');
    return (
      <div style={{ padding: '0 4px 40px 4px' }}>
        <button 
          onClick={() => { setOpenCampaignId(null); setDetail(null); }}
          style={{ 
            background: '#f1f5f9', 
            border: 'none', 
            color: '#0f172a', 
            fontWeight: 800, 
            fontSize: 12, 
            cursor: 'pointer', 
            marginBottom: 16, 
            padding: '8px 16px',
            borderRadius: 100,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          ← Back to Campaigns
        </button>

        {detailLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            Loading campaign details…
          </div>
        ) : detail ? (
          <div style={{
            backgroundColor: '#fff',
            border: '1.5px solid #f1f5f9',
            borderRadius: 20,
            padding: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>{detail.name}</h2>
                  <span style={{ backgroundColor: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                    {detail.discountValue}% OFF
                  </span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>{detail.description || 'Admin-run discount campaign.'}</p>
                <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginTop: 6 }}>
                  📅 Validity: {new Date(detail.startAt).toLocaleDateString('en-IN')} → {new Date(detail.endAt).toLocaleDateString('en-IN')}
                </div>
              </div>
            </div>

            <div style={{ border: '1.5px solid #f1f5f9', borderRadius: 14, overflow: 'hidden', marginTop: 20 }}>
              {products.map((p) => (
                <div key={p.participationId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
                  {p.status === 'PENDING' ? (
                    <input 
                      type="checkbox" 
                      checked={selected.has(String(p.productId))} 
                      onChange={() => toggleSelect(String(p.productId))} 
                      style={{ width: 18, height: 18, accentColor: '#10b981', cursor: 'pointer' }} 
                    />
                  ) : (
                    <span style={{ width: 18 }} />
                  )}
                  {p.image ? (
                    <img src={p.image} alt={p.name} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '1px solid #e2e8f0', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      📦
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{p.name}</p>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
                      <s>{money(p.currentPrice)}</s> → <b style={{ color: '#16a34a' }}>{money(p.dealPrice)}</b>
                    </p>
                  </div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 20,
                    background: p.status === 'ACCEPTED' ? '#dcfce7' : p.status === 'REJECTED' ? '#fee2e2' : '#fef3c7',
                    color: p.status === 'ACCEPTED' ? '#166534' : p.status === 'REJECTED' ? '#991b1b' : '#92400e',
                  }}>
                    {p.status === 'ACCEPTED' ? 'Participating ✓' : p.status === 'REJECTED' ? 'Not participating' : 'Pending Action'}
                  </span>
                </div>
              ))}
            </div>

            {pending.length > 0 && (
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button 
                  onClick={acceptSelected} 
                  disabled={busy || !selected.size}
                  style={{ 
                    padding: '12px 20px', 
                    borderRadius: 12, 
                    border: 'none', 
                    background: (!selected.size || busy) ? '#cbd5e1' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                    color: '#fff', 
                    fontWeight: 800, 
                    fontSize: 13, 
                    cursor: (!selected.size || busy) ? 'not-allowed' : 'pointer',
                    boxShadow: selected.size ? '0 4px 12px rgba(16,185,129,0.25)' : 'none'
                  }}
                >
                  Accept Selected ({selected.size})
                </button>
                <button 
                  onClick={rejectCampaign} 
                  disabled={busy}
                  style={{ 
                    padding: '12px 20px', 
                    borderRadius: 12, 
                    border: '1.5px solid #fecaca', 
                    background: '#fff', 
                    color: '#dc2626', 
                    fontWeight: 800, 
                    fontSize: 13, 
                    cursor: 'pointer' 
                  }}
                >
                  Decline Remaining
                </button>
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Could not load this campaign.</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .camp-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .camp-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .camp-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .camp-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .campaign-item-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 18px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .campaign-item-card:hover {
          transform: translateY(-2px);
          border-color: #cbd5e1;
          box-shadow: 0 6px 16px rgba(0,0,0,0.04);
        }
      `}} />

      {/* Header */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              Campaigns / Deals
            </h1>
            <span style={{
              backgroundColor: '#ecfdf5',
              color: '#047857',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              FEATURED DEALS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Admin-run discount campaigns your products are invited into — zero participation cost.
          </p>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="camp-kpi-grid">
        <div className="camp-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>TOTAL CAMPAIGNS</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎯</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>{totalCampaigns}</div>
        </div>

        <div className="camp-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>ACTIVE DEALS</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🔥</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#166534', fontFamily: "'Outfit', sans-serif" }}>{activeCount}</div>
        </div>

        <div className="camp-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>ELIGIBLE ITEMS</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📦</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Outfit', sans-serif" }}>{totalEligible}</div>
        </div>

        <div className="camp-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>PARTICIPATING</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✅</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#6d28d9', fontFamily: "'Outfit', sans-serif" }}>{totalAccepted}</div>
        </div>
      </div>

      {/* Campaign List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
          Loading available campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13, backgroundColor: '#fff', borderRadius: 16, border: '1.5px solid #f1f5f9' }}>
          No promotional campaigns available currently.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {campaigns.map((c) => {
            const badge = STATUS_BADGE[c.lifecycle] || STATUS_BADGE.EXPIRED;
            return (
              <div 
                key={c.campaignId} 
                onClick={() => openDetail(c.campaignId)}
                className="campaign-item-card"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{c.name}</h3>
                    <span style={{
                      backgroundColor: '#dcfce7',
                      color: '#166534',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 12
                    }}>
                      {c.discountValue}% OFF
                    </span>
                  </div>

                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                    📅 Validity: {new Date(c.startAt).toLocaleDateString('en-IN')} → {new Date(c.endAt).toLocaleDateString('en-IN')}
                  </p>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', backgroundColor: '#f1f5f9', padding: '3px 9px', borderRadius: 10 }}>
                      {c.eligible} eligible
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', backgroundColor: '#fef3c7', padding: '3px 9px', borderRadius: 10 }}>
                      {c.pending} pending
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#166534', backgroundColor: '#dcfce7', padding: '3px 9px', borderRadius: 10 }}>
                      {c.accepted} accepted
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', backgroundColor: '#fee2e2', padding: '3px 9px', borderRadius: 10 }}>
                      {c.rejected} rejected
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 800, 
                    padding: '5px 12px', 
                    borderRadius: 20, 
                    background: badge.bg, 
                    color: badge.fg, 
                    display: 'inline-block',
                    marginBottom: 8
                  }}>
                    {badge.label}
                  </span>
                  <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 800 }}>
                    View & Manage →
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SellerCampaignsTab;
