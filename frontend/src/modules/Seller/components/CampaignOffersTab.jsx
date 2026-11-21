import React, { useCallback, useEffect, useState } from 'react';
import { rupees } from '../utils/sellerFinanceRead';
import { apiUrl } from '../../../utils/api';

// Platform campaigns the admin invited this seller's products into. Nothing is discounted until the seller
// accepts (business rule A): pending offers are listed here to accept or decline, accepted ones can be withdrawn.
const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? rupees(n) : '—');
const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS_STYLE = {
  PENDING: { background: '#fef3c7', color: '#b45309', label: 'Awaiting your decision' },
  ACCEPTED: { background: '#dcfce7', color: '#15803d', label: 'Accepted' },
  REJECTED: { background: '#f1f5f9', color: '#475569', label: 'Declined' },
  CANCELLED: { background: '#f1f5f9', color: '#475569', label: 'Cancelled' },
};

const call = async (path, options = {}) => {
  const token = localStorage.getItem('sellerToken');
  const res = await fetch(apiUrl(path), { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.message || 'Request failed');
  return body;
};

export const CampaignOffersTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setCampaigns((await call('/api/sellers/campaigns')).data || []); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  const open = useCallback(async (id) => {
    setOpenId(id); setDetail(null); setSelected(new Set()); setNotice('');
    try { setDetail((await call(`/api/sellers/campaigns/${id}`)).data); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (action, body) => {
    setBusy(true); setNotice(''); setError('');
    try {
      const res = await call(`/api/sellers/campaigns/${openId}/${action}`, { method: 'PATCH', body: JSON.stringify(body) });
      const skipped = res.data?.skipped?.length ? ` ${res.data.skipped.length} skipped (already in another running campaign).` : '';
      setNotice(`${res.message || 'Updated'}.${skipped}`);
      await Promise.all([open(openId), load()]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const ids = (status) => (detail?.products || []).filter((p) => p.status === status && selected.has(String(p.productId))).map((p) => String(p.productId));

  return (
    <section className="seller-tab-panel" style={{ padding: 20 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Campaign offers</h2>
      <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
        Bulkimart invites your products into sale campaigns. A product is sold at the campaign price only after you accept it; you can withdraw at any time.
      </p>
      {error && <div role="alert" style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {notice && <div role="status" style={{ background: '#f0fdf4', color: '#15803d', padding: 10, borderRadius: 8, marginBottom: 12 }}>{notice}</div>}
      {loading ? <p>Loading…</p> : !campaigns.length ? <p style={{ color: '#64748b' }}>No campaign offers yet.</p> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {campaigns.map((c) => (
            <div key={c.campaignId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{c.name} · {c.discountValue}% off</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{date(c.startAt)} – {date(c.endAt)} · {String(c.lifecycle || '').toLowerCase()}</div>
                  <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>{c.pending} awaiting decision · {c.accepted} accepted · {c.rejected} declined</div>
                </div>
                <button type="button" onClick={() => (openId === String(c.campaignId) ? setOpenId(null) : open(String(c.campaignId)))}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}>
                  {openId === String(c.campaignId) ? 'Close' : c.pending ? 'Review' : 'View'}
                </button>
              </div>
              {openId === String(c.campaignId) && (
                <div style={{ marginTop: 12 }}>
                  {!detail ? <p>Loading…</p> : (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr style={{ textAlign: 'left', color: '#64748b' }}><th style={{ padding: 6 }} /><th style={{ padding: 6 }}>Product</th><th style={{ padding: 6 }}>Your price</th><th style={{ padding: 6 }}>Campaign price</th><th style={{ padding: 6 }}>Status</th></tr></thead>
                          <tbody>
                            {detail.products.map((p) => {
                              const s = STATUS_STYLE[p.status] || STATUS_STYLE.CANCELLED;
                              const actionable = p.status === 'PENDING' || p.status === 'ACCEPTED';
                              return (
                                <tr key={p.participationId} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: 6 }}>{actionable && <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(String(p.productId))} onChange={() => toggle(String(p.productId))} />}</td>
                                  <td style={{ padding: 6 }}>{p.name || 'Product'}</td>
                                  <td style={{ padding: 6 }}>{money(p.currentPrice)}</td>
                                  <td style={{ padding: 6, fontWeight: 700 }}>{money(p.dealPrice)}</td>
                                  <td style={{ padding: 6 }}><span style={{ ...s, padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{s.label}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0' }}>Your earning on a campaign sale is calculated from the campaign price.</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={busy || !ids('PENDING').length} onClick={() => act('accept', { productIds: ids('PENDING') })}
                          style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#16a34a', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: busy || !ids('PENDING').length ? 0.5 : 1 }}>Accept selected</button>
                        <button type="button" disabled={busy || !ids('PENDING').length} onClick={() => act('reject', { productIds: ids('PENDING') })}
                          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600, cursor: 'pointer', opacity: busy || !ids('PENDING').length ? 0.5 : 1 }}>Decline selected</button>
                        <button type="button" disabled={busy || !ids('ACCEPTED').length} onClick={() => act('withdraw', { productIds: ids('ACCEPTED') })}
                          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontWeight: 600, cursor: 'pointer', opacity: busy || !ids('ACCEPTED').length ? 0.5 : 1 }}>Withdraw selected</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default CampaignOffersTab;
