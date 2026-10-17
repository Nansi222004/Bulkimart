import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, qs } from '../../../utils/adminApi';

/**
 * Admin — Seller Promotions.
 *
 * A Seller Promotion is a PAID ADVERTISEMENT request, never a discount —
 * kept entirely separate from CampaignsTab.jsx. This is the verification
 * queue Section 15's "what exactly is this seller asking me to advertise?"
 * review screen, showing banner + seller + shop + products + package in
 * one place.
 */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const MODULE_LABEL = { QUICK: 'Quick', ECOMMERCE: 'E-Commerce' };

const STATUS_CLASS = {
  DRAFT: 'pending', PENDING_REVIEW: 'processing', CHANGES_REQUESTED: 'pending',
  APPROVED: 'approved', PAYMENT_PENDING: 'pending', ACTIVE: 'approved',
  EXPIRED: 'rejected', REJECTED: 'rejected', CANCELLED: 'rejected', DISABLED: 'rejected',
};

export const SellerPromotionsTab = () => {
  const { triggerToast } = useAdmin();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedbackBox, setShowFeedbackBox] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/promotions${qs({ status: statusFilter, module: moduleFilter, search })}`);
      setRows(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load promotions');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter, moduleFilter]);

  const openDetail = async (id) => {
    setDetailLoading(true);
    setDetail({ _id: id });
    setShowFeedbackBox(false);
    setFeedbackText('');
    try {
      const res = await adminGet(`/promotions/${id}`);
      setDetail(res.data);
    } catch (err) {
      triggerToast(err.message || 'Could not load promotion detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const act = async (path, body, successMsg) => {
    setBusy(true);
    try {
      await adminPost(`/promotions/${detail._id}${path}`, body);
      triggerToast(successMsg);
      setDetail(null);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => act('/approve', {}, 'Promotion approved.');
  const sendFeedback = () => {
    if (!feedbackText.trim()) { triggerToast('Enter what needs to change.'); return; }
    act('/request-changes', { feedback: feedbackText }, 'Feedback sent to the seller.');
  };
  const reject = () => {
    const reason = window.prompt('Reason for rejection (optional):') || '';
    act('/reject', { reason }, 'Promotion rejected.');
  };
  const disable = () => {
    if (!window.confirm('Disable this active promotion? It will stop appearing to customers immediately.')) return;
    act('/disable', {}, 'Promotion disabled.');
  };

  const filtered = rows.filter((r) => !search.trim() || r.title.toLowerCase().includes(search.trim().toLowerCase()) || r.seller?.name?.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Seller Promotions</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Paid advertisement requests — verify banner, seller, shop and products before approving.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" className="sa-search-input" placeholder="Search by title or seller..." value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <select className="sa-select" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="all">All Modules</option>
          <option value="QUICK">Quick</option>
          <option value="ECOMMERCE">E-Commerce</option>
        </select>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {['PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PAYMENT_PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED', 'DISABLED'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Seller', 'Shop', 'Module', 'Promotion', 'Products', 'Amount', 'Submitted', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No promotions found.</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r._id} onClick={() => openDetail(r._id)} style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--sa-border)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>{r.seller?.name}</td>
                <td style={{ padding: '12px 16px' }}>{r.seller?.shopName || '—'}</td>
                <td style={{ padding: '12px 16px' }}>{MODULE_LABEL[r.module] || r.module}</td>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{r.title}</td>
                <td style={{ padding: '12px 16px' }}>{r.productsCount}</td>
                <td style={{ padding: '12px 16px' }}>{r.amount !== undefined ? money(r.amount) : '—'}</td>
                <td style={{ padding: '12px 16px' }}>{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${STATUS_CLASS[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 620 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">
                {detail.title || 'Promotion'}
                {detail.module && (
                  <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}>
                    {MODULE_LABEL[detail.module] || detail.module}
                  </span>
                )}
              </h3>
              <button className="admin-modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>

            {detailLoading ? (
              <p style={{ color: 'var(--sa-text-muted)', fontSize: 12.5 }}>Loading…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {detail.bannerImage && (
                  <img src={detail.bannerImage} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--sa-border)' }} />
                )}

                <div>
                  <p style={{ margin: 0, fontSize: 12.5 }}><b>Seller:</b> {detail.seller?.name}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5 }}><b>Shop:</b> {detail.seller?.shopName}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5 }}><b>Address:</b> {detail.seller?.address || '—'}</p>
                  {detail.description && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--sa-text-secondary)' }}>{detail.description}</p>}
                </div>

                <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
                  <span><b>Package:</b> {detail.packageNameSnapshot || detail.packageId?.name || '—'}</span>
                  <span><b>Duration:</b> {detail.durationDaysSnapshot} days</span>
                  <span><b>Amount:</b> {detail.amountSnapshot !== undefined ? money(detail.amountSnapshot) : '—'}</span>
                </div>

                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 800 }}>Selected Products</p>
                  <div style={{ border: '1px solid var(--sa-border)', borderRadius: 10, maxHeight: 200, overflowY: 'auto' }}>
                    {(detail.selectedProducts || []).map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--sa-border)' }}>
                        <img src={p.image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                        <span style={{ flex: 1, fontSize: 12.5 }}>{p.name}</span>
                        <span style={{ fontSize: 12 }}>{money(p.price)}</span>
                        {!p.available && <span style={{ fontSize: 10, color: 'var(--sa-error)' }}>Unavailable</span>}
                      </div>
                    ))}
                    {(!detail.selectedProducts || detail.selectedProducts.length === 0) && (
                      <p style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--sa-text-muted)' }}>No products selected.</p>
                    )}
                  </div>
                </div>

                {detail.adminFeedback && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 10, fontSize: 12 }}>
                    Previous feedback: "{detail.adminFeedback}"
                  </div>
                )}

                {showFeedbackBox && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Reason / Improvement Required</label>
                    <textarea rows={3} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1.5px solid var(--sa-border)', fontSize: 13, resize: 'vertical' }}
                      placeholder="Banner text is not clearly readable. Please improve the heading and use a clearer product image." />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="sa-btn-primary" disabled={busy} onClick={sendFeedback}>Send Feedback</button>
                      <button className="sa-action-btn" style={{ width: 'auto', padding: '0 14px' }} onClick={() => setShowFeedbackBox(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                {!showFeedbackBox && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {detail.status === 'PENDING_REVIEW' && (
                      <>
                        <button className="sa-btn-primary" disabled={busy} onClick={approve}>Approve</button>
                        <button className="sa-action-btn" style={{ width: 'auto', padding: '0 14px' }} disabled={busy} onClick={() => setShowFeedbackBox(true)}>Request Changes</button>
                        <button className="sa-action-btn" style={{ width: 'auto', padding: '0 14px', color: 'var(--sa-error)' }} disabled={busy} onClick={reject}>Reject</button>
                      </>
                    )}
                    {detail.status === 'ACTIVE' && (
                      <button className="sa-action-btn" style={{ width: 'auto', padding: '0 14px', color: 'var(--sa-error)' }} disabled={busy} onClick={disable}>Disable</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SellerPromotionsTab;
