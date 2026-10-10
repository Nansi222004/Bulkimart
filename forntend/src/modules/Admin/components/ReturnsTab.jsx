import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPatch, adminPost } from '../../../utils/adminApi';

/**
 * Admin — Returns & Refunds (item-level, Phase 4/5/6). Every action here is a
 * validated state-machine transition on the backend (services/return.service.js)
 * — no arbitrary status dropdown. Refund execution (Phase 6) is real:
 * "Process Refund" calls the actual PhonePe refund / COD manual-settlement
 * path — nothing here ever claims a refund succeeded on its own authority.
 * No Shiprocket/AWB/pickup UI — not implemented yet.
 */

const STATUS_LABEL = {
  RETURN_REQUESTED: 'Requested', UNDER_REVIEW: 'Under Review', APPROVED: 'Approved',
  AWAITING_RETURN: 'Awaiting Return', RETURN_RECEIVED: 'Received', REFUND_PENDING: 'Refund Pending',
  REFUND_FAILED: 'Refund Failed', REFUNDED: 'Refunded', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
const STATUS_BADGE = {
  RETURN_REQUESTED: 'pending', UNDER_REVIEW: 'pending', APPROVED: 'approved', AWAITING_RETURN: 'approved',
  RETURN_RECEIVED: 'approved', REFUND_PENDING: 'approved', REFUND_FAILED: 'rejected', REFUNDED: 'approved', REJECTED: 'rejected', CANCELLED: 'rejected',
};

export const ReturnsTab = () => {
  const { triggerToast } = useAdmin();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectFor, setShowRejectFor] = useState(null);
  const [restockChoice, setRestockChoice] = useState('RESTOCKABLE');
  const [processing, setProcessing] = useState(false);
  const [codNote, setCodNote] = useState('');
  const [showCodSettle, setShowCodSettle] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (search) qs.set('search', search);
      const res = await adminGet(`/returns?${qs.toString()}`);
      setReturns(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load returns');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (id) => {
    try {
      const res = await adminGet(`/returns/${id}`);
      setDetail(res.data);
    } catch (err) {
      triggerToast(err.message || 'Could not load return');
    }
  };

  const doTransition = async (id, status, extra = {}) => {
    try {
      const res = await adminPatch(`/returns/${id}/status`, { status, ...extra });
      triggerToast(res.message || `Return is now ${status}`);
      setDetail(res.data);
      setShowRejectFor(null);
      setRejectReason('');
      load();
    } catch (err) {
      // Stale-data case: the backend rejects an invalid transition (someone
      // else already acted on it) — surface the real error and refresh.
      triggerToast(err.message || 'Could not update this return');
      openDetail(id);
      load();
    }
  };

  // Real refund execution (Phase 6) — same idempotent endpoint handles the
  // first attempt AND a retry after REFUND_FAILED, so this button never
  // needs to know which case it is.
  const processRefund = async (id) => {
    setProcessing(true);
    try {
      const res = await adminPost(`/returns/${id}/refund`, {});
      triggerToast(res.message || 'Refund processed');
      setDetail(res.data);
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not process this refund');
      openDetail(id);
      load();
    } finally {
      setProcessing(false);
    }
  };

  const codSettle = async (id) => {
    if (!codNote.trim()) return;
    setProcessing(true);
    try {
      const res = await adminPost(`/returns/${id}/cod-settle`, { note: codNote.trim() });
      triggerToast(res.message || 'Marked as refunded');
      setDetail(res.data);
      setShowCodSettle(false);
      setCodNote('');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not settle this COD refund');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Returns & Refunds</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
          Item-level return requests. Refund execution and inventory restock are a later phase — this stops at Refund Pending.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input
          className="sa-select" placeholder="Search return # or product…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ flex: 1 }}
        />
        <button className="sa-btn-primary" onClick={load}>Search</button>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Return #', 'Customer', 'Seller', 'Product', 'Qty', 'Reason', 'Status', 'Requested'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : returns.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No returns yet.</td></tr>
            ) : returns.map((r, i) => (
              <tr key={r._id} onClick={() => openDetail(r._id)} style={{ borderBottom: i === returns.length - 1 ? 'none' : '1px solid var(--sa-border)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{r.returnNumber}</td>
                <td style={{ padding: '12px 16px' }}>{r.customerId?.name || r.customerId?.phone || '—'}</td>
                <td style={{ padding: '12px 16px' }}>{r.sellerId?.businessName || '—'}</td>
                <td style={{ padding: '12px 16px' }}>{r.productName}</td>
                <td style={{ padding: '12px 16px' }}>{r.quantity}</td>
                <td style={{ padding: '12px 16px' }}>{r.reason?.replace(/_/g, ' ')}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                <td style={{ padding: '12px 16px' }}>{new Date(r.requestedAt).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="admin-modal-overlay" onClick={() => { setDetail(null); setShowRejectFor(null); }}>
          <div className="admin-modal-sheet" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{detail.returnNumber}</h3>
              <button className="admin-modal-close" onClick={() => { setDetail(null); setShowRejectFor(null); }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
              <p style={{ margin: 0 }}><b>Status:</b> <span className={`sa-status-pill ${STATUS_BADGE[detail.status]}`}>{STATUS_LABEL[detail.status] || detail.status}</span></p>
              <p style={{ margin: 0 }}>
                <b>Customer:</b> {detail.customerId?.name || '—'}
                {detail.customerId?.phone ? ` · ${detail.customerId.phone}` : ''}
                {detail.customerId?.email ? ` · ${detail.customerId.email}` : ''}
              </p>
              {/*
                An SHG return has no sellerId — the cooperative is the vendor —
                so the group name is the seller for those, and the label says
                which kind it is rather than showing a bare name.
              */}
              <p style={{ margin: 0 }}>
                <b>Seller:</b>{' '}
                {detail.sellerId
                  ? `${detail.sellerId.storeDetails?.name || detail.sellerId.businessName}${detail.sellerId.storeDetails?.phone ? ` · ${detail.sellerId.storeDetails.phone}` : ''}`
                  : detail.shgStoreId
                    ? `${detail.shgStoreId.groupName} (SHG${detail.shgStoreId.district ? ` · ${detail.shgStoreId.district}` : ''})`
                    : '—'}
              </p>
              <p style={{ margin: 0 }}>
                <b>Order:</b> {detail.order?.orderNo || '—'}
                {detail.order?.status ? ` · ${detail.order.status.replace(/_/g, ' ')}` : ''}
              </p>
              <p style={{ margin: 0 }}>
                <b>Payment:</b> {detail.order?.paymentMethod ? detail.order.paymentMethod.toUpperCase() : '—'}
                {detail.order?.pricing?.totalAmount != null ? ` · order total ₹${detail.order.pricing.totalAmount}` : ''}
                {/* The gateway's own record — whether the money was actually
                    captured, which decides if a refund is even possible. */}
                {detail.order?.paymentId?.status ? ` · ${detail.order.paymentId.status}` : ''}
                {detail.order?.paymentId?.transactionId ? ` · txn ${detail.order.paymentId.transactionId}` : ''}
              </p>
              <p style={{ margin: 0 }}><b>Product:</b> {detail.productName} × {detail.quantity} @ ₹{detail.unitPriceSnapshot}</p>
              <p style={{ margin: 0 }}><b>Category:</b> {detail.headerCategoryName || '—'} · Return window: {detail.returnWindowDaysSnapshot ?? '—'} day(s)</p>
              <p style={{ margin: 0 }}><b>Return deadline:</b> {detail.returnEligibleUntilSnapshot ? new Date(detail.returnEligibleUntilSnapshot).toLocaleString('en-IN') : '—'}</p>
              <p style={{ margin: 0 }}><b>Reason:</b> {detail.reason?.replace(/_/g, ' ')}{detail.customerDescription ? ` — "${detail.customerDescription}"` : ''}</p>

              {detail.pickup && detail.pickup.status !== 'NOT_ASSIGNED' && (
                <div style={{ background: '#f8fafc', border: '1px solid var(--sa-border)', borderRadius: 10, padding: 10 }}>
                  <p style={{ margin: 0, fontWeight: 800 }}>Reverse pickup: {detail.pickup.status.replace(/_/g, ' ')}</p>
                  {detail.pickup.partnerId?.userId?.name && (
                    <p style={{ margin: '4px 0 0' }}>Rider: {detail.pickup.partnerId.userId.name} ({detail.pickup.partnerId.userId.phone || '—'})</p>
                  )}
                  {detail.pickup.sellerConfirmedReceivedAt && (
                    <p style={{ margin: '4px 0 0' }}>Seller confirmed received: {new Date(detail.pickup.sellerConfirmedReceivedAt).toLocaleString('en-IN')}</p>
                  )}
                </div>
              )}

              {detail.attachments?.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detail.attachments.map((a, idx) => (
                    <a key={idx} href={a.url} target="_blank" rel="noreferrer">
                      <img src={a.url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--sa-border)' }} />
                    </a>
                  ))}
                </div>
              )}

              {detail.refundEstimate && (
                <div style={{ background: '#f8fafc', border: '1px solid var(--sa-border)', borderRadius: 10, padding: 10 }}>
                  <p style={{ margin: 0, fontWeight: 800 }}>
                    {['REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'].includes(detail.status) ? 'Refund breakdown' : 'Estimated refund'}: ₹{detail.refundEstimate.refundAmount}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--sa-text-muted)' }}>
                    Item ₹{detail.refundEstimate.itemGrossAmount} − coupon ₹{detail.refundEstimate.allocatedCouponDiscount || 0} − CDS ₹{detail.refundEstimate.allocatedCdsDiscount || 0} − Coins ₹{detail.refundEstimate.allocatedCoinDiscount || 0}
                    {detail.refundEstimate.allocatedCoinsCount > 0 ? ` (${detail.refundEstimate.allocatedCoinsCount} Coins to restore)` : ''}
                  </p>
                  {detail.refundEstimate.limitations?.map((l, idx) => (
                    <p key={idx} style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--sa-text-muted)' }}>⚠ {l}</p>
                  ))}
                </div>
              )}

              {detail.refundStatus && (
                <p style={{ margin: 0, fontSize: 12 }}>
                  <b>Refund:</b> {detail.refundStatus}
                  {detail.refundAmount != null ? ` · ₹${detail.refundAmount}` : ''}
                  {detail.refundReference ? ` · Ref: ${detail.refundReference}` : ''}
                  {detail.refundedAt ? ` · ${new Date(detail.refundedAt).toLocaleString('en-IN')}` : ''}
                </p>
              )}
              {detail.refundFailureReason && (
                <p style={{ margin: 0, fontSize: 11.5, color: '#991b1b' }}><b>Failure reason:</b> {detail.refundFailureReason}</p>
              )}

              {detail.rejectionReason && <p style={{ margin: 0, color: '#991b1b' }}><b>Rejection reason:</b> {detail.rejectionReason}</p>}

              <div style={{ borderTop: '1px solid var(--sa-border)', paddingTop: 10 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', color: 'var(--sa-text-muted)' }}>History</p>
                {(detail.history || []).map((h, idx) => (
                  <p key={idx} style={{ margin: '0 0 4px', fontSize: 11.5 }}>
                    <b>{STATUS_LABEL[h.toStatus] || h.toStatus}</b> — {new Date(h.timestamp).toLocaleString('en-IN')}{h.comment ? ` — ${h.comment}` : ''}
                  </p>
                ))}
              </div>

              {/* Actions — exactly the transitions the current status allows. */}
              {detail.status === 'RETURN_REQUESTED' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="sa-btn-primary" onClick={() => doTransition(detail._id, 'UNDER_REVIEW')}>Start Review</button>
                  <button className="sa-action-btn" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowRejectFor(detail._id)}>Reject</button>
                </div>
              )}
              {detail.status === 'UNDER_REVIEW' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="sa-btn-primary" onClick={() => doTransition(detail._id, 'APPROVED')}>Approve</button>
                  <button className="sa-action-btn" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowRejectFor(detail._id)}>Reject</button>
                </div>
              )}
              {detail.status === 'APPROVED' && (
                <button className="sa-btn-primary" onClick={() => doTransition(detail._id, 'AWAITING_RETURN')}>Move to Awaiting Return</button>
              )}
              {detail.status === 'AWAITING_RETURN' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="sa-select" value={restockChoice} onChange={(e) => setRestockChoice(e.target.value)}>
                    <option value="RESTOCKABLE">Restockable</option>
                    <option value="NON_RESTOCKABLE">Non-restockable</option>
                  </select>
                  <button className="sa-btn-primary" onClick={() => doTransition(detail._id, 'RETURN_RECEIVED', { restockDecision: restockChoice })}>
                    Mark Return Received
                  </button>
                </div>
              )}
              {detail.status === 'RETURN_RECEIVED' && (
                <button className="sa-btn-primary" disabled={processing} onClick={() => processRefund(detail._id)}>
                  {processing ? 'Processing…' : 'Process Refund'}
                </button>
              )}
              {detail.status === 'REFUND_PENDING' && detail.refundStatus === 'manual_pending' && (
                showCodSettle ? (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 11.5, color: '#92400e' }}>
                      COD order — no automatic refund mechanism exists. Confirm only after the cash has actually been returned to the customer.
                    </p>
                    <textarea
                      value={codNote} onChange={(e) => setCodNote(e.target.value)}
                      placeholder="How/when was the cash returned? (required)" rows={2}
                      style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #fde68a', fontSize: 12.5, fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="sa-btn-primary" disabled={!codNote.trim() || processing} onClick={() => codSettle(detail._id)}>
                        Confirm Manual Refund
                      </button>
                      <button className="sa-action-btn" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowCodSettle(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="sa-btn-primary" onClick={() => setShowCodSettle(true)}>Mark COD Refund Settled Manually</button>
                )
              )}
              {detail.status === 'REFUND_PENDING' && detail.refundStatus !== 'manual_pending' && (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--sa-text-muted)' }}>
                  Refund is with PhonePe (async) — retry if it doesn't resolve.
                  {' '}<button className="sa-action-btn" style={{ width: 'auto', padding: '6px 12px', marginLeft: 6 }} disabled={processing} onClick={() => processRefund(detail._id)}>Check / Retry</button>
                </p>
              )}
              {detail.status === 'REFUND_FAILED' && (
                <button className="sa-btn-primary" disabled={processing} onClick={() => processRefund(detail._id)}>
                  {processing ? 'Retrying…' : 'Retry Refund'}
                </button>
              )}

              {showRejectFor === detail._id && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection (required)" rows={2}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #fecaca', fontSize: 12.5, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="sa-btn-primary"
                      style={{ background: '#dc2626' }}
                      disabled={!rejectReason.trim()}
                      onClick={() => doTransition(detail._id, 'REJECTED', { rejectionReason: rejectReason.trim() })}
                    >
                      Confirm Reject
                    </button>
                    <button className="sa-action-btn" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowRejectFor(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReturnsTab;
