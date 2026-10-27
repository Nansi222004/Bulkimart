import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { apiUrl } from '../../../utils/api';
import { useSeller } from '../context/SellerContext';
import { boundedFetch } from '../../../utils/portalRequests';
import { socket } from '../../../utils/socket';
import { isSellerReturnNotification } from '../utils/returnNotification';
import ModalPortal from '../../../components/ModalPortal';

/**
 * Seller returns and explicit pickup selection for the seller's own products.
 */
const token = () => localStorage.getItem('sellerToken');
const authHeaders = () => ({ Authorization: 'Bearer ' + token() });

const PICKUP_LABEL = {
  NOT_ASSIGNED: 'No rider yet', 
  ASSIGNED: 'Rider on the way', 
  PICKED_UP: 'Picked up — in transit to you',
  DELIVERED_TO_SELLER: 'Received', 
  CANCELLED: 'Pickup cancelled',
};

const STATUS_LABEL = {
  RETURN_REQUESTED: 'Requested', 
  UNDER_REVIEW: 'Under Review', 
  APPROVED: 'Approved',
  AWAITING_RETURN: 'Awaiting Return', 
  RETURN_RECEIVED: 'Received', 
  REFUND_PENDING: 'Refund Pending',
  REFUND_FAILED: 'Refund Failed',
  REFUNDED: 'Refunded',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

// Each KPI card counts, and filters to, the same group of statuses.
const KPI_GROUPS = {
  requested: ['RETURN_REQUESTED', 'UNDER_REVIEW'],
  pickup: ['APPROVED', 'AWAITING_RETURN', 'RETURN_RECEIVED'],
  refunded: ['REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'],
};
const groupFilter = key => KPI_GROUPS[key].join(',');

const RETURN_ID = /^[a-f\d]{24}$/i;
const returnIdFromUrl = () => {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('return');
  return RETURN_ID.test(id || '') ? id : null;
};

const formatDate = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** What happens next for this return, from the seller's point of view. */
const nextStep = r => {
  switch (r.status) {
    case 'RETURN_REQUESTED':
    case 'UNDER_REVIEW': return 'Review the reason and photos, then approve or reject this return.';
    case 'APPROVED':
    case 'AWAITING_RETURN':
      if (r.pickup?.status === 'DELIVERED_TO_SELLER') return 'You confirmed receipt. Bulkimart will inspect the item and process the refund.';
      if (r.pickup?.status === 'PICKED_UP') return 'The rider has collected the item. Mark it received once it reaches you.';
      if (r.reverseBooking?.trackingState === 'DELIVERED') return 'The courier delivered the item. Mark it received once you have checked the package.';
      if (r.pickup?.status === 'ASSIGNED') return 'A rider is on the way to collect the item from the customer.';
      if (r.pickupMethod === 'SHIPROCKET') return 'Shiprocket reverse pickup is booked. Refresh courier tracking for the latest scan.';
      if (r.pickupMethod === 'MANUAL') return 'Looking for a nearby rider. If none accepts, cancel the search and try again or use Shiprocket.';
      return 'Choose a pickup method: a local rider (same city only) or Shiprocket reverse pickup.';
    case 'RETURN_RECEIVED':
    case 'REFUND_PENDING': return 'Inspection is complete. The customer refund is being processed.';
    case 'REFUND_FAILED': return 'The refund attempt failed. Bulkimart will retry it.';
    case 'REFUNDED': return 'The customer has been refunded. Your earning for this item is adjusted in Earnings.';
    case 'REJECTED': return 'This return was rejected. No pickup is needed.';
    default: return 'This return is closed.';
  }
};

const STATUS_COLOR = {
  RETURN_REQUESTED: { bg: '#fef3c7', fg: '#92400e', label: 'Requested 🕒' },
  UNDER_REVIEW: { bg: '#fef3c7', fg: '#92400e', label: 'Under Review' },
  APPROVED: { bg: '#dbeafe', fg: '#1e40af', label: 'Approved 🚚' },
  AWAITING_RETURN: { bg: '#dbeafe', fg: '#1e40af', label: 'Awaiting Return' },
  RETURN_RECEIVED: { bg: '#ede9fe', fg: '#6d28d9', label: 'Received' },
  REFUND_PENDING: { bg: '#dbeafe', fg: '#1e40af', label: 'Refund Pending' },
  REFUNDED: { bg: '#dcfce7', fg: '#166534', label: 'Refunded ✓' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected' },
  CANCELLED: { bg: '#f1f5f9', fg: '#64748b', label: 'Cancelled' },
};

export const SellerReturnsTab = () => {
  const { selectedTypes, activeMode, setActiveMode } = useSeller();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionId, setActionId] = useState(null);
  const [toast, setToast] = useState('');
  const [pickupChoices, setPickupChoices] = useState({});
  const [rejectReasons, setRejectReasons] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [statusCounts, setStatusCounts] = useState(null);
  const [detailId, setDetailId] = useState(returnIdFromUrl);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const alive = useRef(true), generation = useRef(0), detailGeneration = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const sessionToken = token(), epoch = ++generation.current;
    if (!quiet) setLoading(true);
    const current = () => alive.current && epoch === generation.current && sessionToken === token();
    try {
      const qs = `?limit=100${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`;
      const res = await boundedFetch(apiUrl(`/api/sellers/returns${qs}`), { headers: { Authorization: 'Bearer ' + sessionToken } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not load returns');
      if (current()) { setReturns(body.data || []); setStatusCounts(body.meta?.statusCounts || null); }
    } catch (err) {
      console.error(err);
    } finally {
      if (current()) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    alive.current = true; load();
    const refresh = () => { void load(true); };
    const onNotification = notification => { if (isSellerReturnNotification(notification)) refresh(); };
    socket.on('notification_new', onNotification); socket.on('connect', refresh);
    window.addEventListener('focus', refresh); window.addEventListener('seller_return_notification', refresh);
    return () => {
      alive.current = false; generation.current++;
      socket.off('notification_new', onNotification); socket.off('connect', refresh);
      window.removeEventListener('focus', refresh); window.removeEventListener('seller_return_notification', refresh);
    };
  }, [load]);

  const loadDetail = useCallback(async (id) => {
    const sessionToken = token(), epoch = ++detailGeneration.current;
    const current = () => alive.current && epoch === detailGeneration.current && sessionToken === token();
    setDetailError('');
    try {
      const res = await boundedFetch(apiUrl(`/api/sellers/returns/${id}`), { headers: { Authorization: 'Bearer ' + sessionToken } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not load this return');
      if (current()) setDetail(body.data);
    } catch (err) {
      if (current()) setDetailError(err.message || 'Could not load this return');
    }
  }, []);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setDetail(null); void loadDetail(detailId);
  }, [detailId, loadDetail]);

  // A notification opened while this tab is already showing.
  useEffect(() => {
    const onOpen = event => { const id = event.detail?.returnId; if (RETURN_ID.test(id || '')) setDetailId(id); };
    window.addEventListener('seller_open_return', onOpen);
    return () => window.removeEventListener('seller_open_return', onOpen);
  }, []);

  const openDetail = id => {
    setDetailId(id);
    window.history.replaceState(null, '', `/seller/item-returns?return=${id}`);
  };
  const closeDetail = () => {
    detailGeneration.current++; setDetailId(null); setDetailError('');
    if (window.location.search) window.history.replaceState(null, '', '/seller/item-returns');
  };
  // After any pickup action, refresh both the list and an open detail.
  const reloadAll = async () => { await load(); if (detailId) await loadDetail(detailId); };

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const assignRider = async (id) => {
    if (!pickupChoices[id]) return;
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/pickup`), { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ pickupMethod: pickupChoices[id] }) });
      const body = await res.json();
      showToast(res.ok ? (body.message || 'Pickup updated') : (body.message || 'Could not arrange pickup'));
      await reloadAll();
    } catch { showToast('Could not confirm pickup; reload before retrying');
    } finally {
      setActionId(null);
    }
  };

  const courierAction = async (id, action) => {
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/pickup/${action}`), { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      showToast(body.message || (res.ok ? 'Pickup updated' : 'Pickup needs review'));
      await reloadAll();
    } catch { showToast('Could not update pickup; reload before retrying'); }
    finally { setActionId(null); }
  };

  const markReceived = async (id) => {
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/mark-received`), { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      showToast(res.ok ? (body.message || 'Marked as received') : (body.message || 'Could not mark as received'));
      await reloadAll();
    } catch { showToast('Could not confirm receipt; reload before retrying');
    } finally {
      setActionId(null);
    }
  };

  // KPI counts come from the server's unfiltered per-status totals, so they
  // don't shrink to the active filter or the first page. Older responses
  // without them fall back to counting the loaded rows.
  const countOf = useCallback(statuses => statusCounts
    ? statuses.reduce((sum, s) => sum + (statusCounts[s] || 0), 0)
    : returns.filter(r => statuses.includes(r.status)).length, [statusCounts, returns]);
  const totalCount = statusCounts ? Object.values(statusCounts).reduce((a, b) => a + b, 0) : returns.length;
  const requestedCount = countOf(KPI_GROUPS.requested);
  const approvedCount = countOf(KPI_GROUPS.pickup);
  const refundedCount = countOf(KPI_GROUPS.refunded);

  // Search filtered returns
  const filteredReturns = useMemo(() => {
    return returns.filter(r => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;
      return (
        (r.returnNumber || '').toLowerCase().includes(query) ||
        (r.productName || '').toLowerCase().includes(query) ||
        (r.reason || '').toLowerCase().includes(query)
      );
    });
  }, [returns, searchQuery]);

  const decide = async (id, decision) => {
    const rejectionReason = (rejectReasons[id] || '').trim();
    if (decision === 'REJECTED' && rejectionReason.length < 3) { showToast('Enter a reason for rejecting this return'); return; }
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/decision`), { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, rejectionReason }) });
      const body = await res.json();
      showToast(body.message || (res.ok ? 'Return updated' : 'Could not update this return'));
      if (res.ok) setRejectingId(null);
      await reloadAll();
    } catch { showToast('Could not save your decision; reload before retrying'); }
    finally { setActionId(null); }
  };

  const decisionPanel = r => ['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(r.status) && (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rejectingId === r._id ? <>
        <textarea aria-label="Rejection reason" rows={2} placeholder="Why are you rejecting this return? The customer will see this."
          value={rejectReasons[r._id] || ''} onChange={e => setRejectReasons({ ...rejectReasons, [r._id]: e.target.value })}
          style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: 8, fontSize: 12, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" disabled={actionId === r._id} onClick={() => setRejectingId(null)}
            style={{ border: '1.5px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>Back</button>
          <button type="button" disabled={actionId === r._id} onClick={() => decide(r._id, 'REJECTED')}
            style={{ border: 'none', background: '#dc2626', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: actionId === r._id ? 0.6 : 1 }}>
            {actionId === r._id ? 'Saving…' : 'Confirm rejection'}
          </button>
        </div>
      </> : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" disabled={actionId === r._id} onClick={() => setRejectingId(r._id)}
            style={{ border: '1.5px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>Reject</button>
          <button type="button" disabled={actionId === r._id} onClick={() => decide(r._id, 'APPROVED')}
            style={{ border: 'none', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: actionId === r._id ? 0.6 : 1 }}>
            {actionId === r._id ? 'Saving…' : 'Approve return'}
          </button>
        </div>
      )}
    </div>
  );

  const pickupPanel = r => ['APPROVED', 'AWAITING_RETURN'].includes(r.status) && (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <div style={{ fontSize: 11.5, color: '#475569', fontWeight: 600 }}>
        <b>Pickup Logistics:</b> {r.pickupMethod === 'SHIPROCKET' ? (r.reverseBooking?.trackingState || r.reverseBooking?.state || 'Awaiting booking') : (PICKUP_LABEL[r.pickup?.status] || 'Choose a pickup method')}
        {r.pickup?.partnerId?.userId?.name ? ` — ${r.pickup.partnerId.userId.name}` : ''}
      </div>
      {(!r.pickupMethod || ['failed', 'cancelled'].includes(r.reverseBooking?.state)) && ['NOT_ASSIGNED', 'CANCELLED'].includes(r.pickup?.status || 'NOT_ASSIGNED') && (
        <>
        <select aria-label="Pickup method" value={pickupChoices[r._id] || ''} onChange={e => setPickupChoices({ ...pickupChoices, [r._id]: e.target.value })}>
          <option value="">Choose pickup method</option>
          <option value="MANUAL">Manual Delivery / Local Rider</option>
          <option value="SHIPROCKET">Shiprocket Reverse Pickup</option>
        </select>
        <button 
          disabled={actionId === r._id || !pickupChoices[r._id]}
          onClick={() => assignRider(r._id)}
          style={{
            border: 'none', 
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', 
            color: '#fff', 
            borderRadius: 8, 
            padding: '7px 14px',
            fontSize: 11, 
            fontWeight: 800, 
            cursor: actionId === r._id ? 'not-allowed' : 'pointer', 
            opacity: actionId === r._id ? 0.6 : 1,
            boxShadow: '0 2px 6px rgba(3, 105, 161, 0.2)'
          }}
        >
          {actionId === r._id ? 'Booking…' : 'Confirm pickup method'}
        </button>
        </>
      )}
      {r.pickupMethod === 'SHIPROCKET' && <>
        <span>{r.awbNumber ? `AWB: ${r.awbNumber}` : ''} {r.reverseBooking?.error}</span>
        <button disabled={actionId === r._id} onClick={() => courierAction(r._id, 'refresh')}>Refresh courier tracking</button>
        {r.reverseBooking?.state === 'booked' && (r.reverseBooking?.trackingRank || 0) < 2 && <button disabled={actionId === r._id} onClick={() => courierAction(r._id, 'cancel')}>Request courier cancellation</button>}
      </>}
      {r.pickupMethod === 'MANUAL' && r.pickup?.status === 'NOT_ASSIGNED' && <>
        <button disabled={actionId === r._id} onClick={() => courierAction(r._id, 'cancel')}>Cancel rider search</button>
      </>}
      {(r.pickup?.status === 'PICKED_UP' || r.reverseBooking?.trackingState === 'DELIVERED' && r.pickup?.status !== 'DELIVERED_TO_SELLER') && (
        <button 
          disabled={actionId === r._id} 
          onClick={() => markReceived(r._id)} 
          style={{
            border: 'none', 
            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', 
            color: '#fff', 
            borderRadius: 8, 
            padding: '7px 14px',
            fontSize: 11, 
            fontWeight: 800, 
            cursor: actionId === r._id ? 'not-allowed' : 'pointer', 
            opacity: actionId === r._id ? 0.6 : 1,
            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.2)'
          }}
        >
          {actionId === r._id ? 'Saving…' : 'Mark Received'}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .ret-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .ret-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .ret-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          cursor: pointer;
        }
        .ret-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .return-row-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .return-row-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
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
              Item Returns
            </h1>
            <span style={{
              backgroundColor: '#fef3c7',
              color: '#b45309',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              LOGISTICS & REFUNDS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            You approve or reject returns and arrange pickup — refunds are processed by Bulkimart after inspection.
          </p>
        </div>
      </div>

      {/* Mode Switcher Toggle */}
      {selectedTypes && selectedTypes.includes('ecommerce') && selectedTypes.includes('quick') && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          margin: '0 0 16px 0'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '2px',
            backgroundColor: '#f1f5f9',
            borderRadius: '12px',
            border: '1.5px solid #e2e8f0'
          }}>
            <button 
              onClick={() => setActiveMode('ecommerce')}
              style={{
                border: 'none',
                background: activeMode === 'ecommerce' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'none',
                color: activeMode === 'ecommerce' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'ecommerce' ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              📦 E-Commerce
            </button>
            <button 
              onClick={() => setActiveMode('quick')}
              style={{
                border: 'none',
                background: activeMode === 'quick' ? 'linear-gradient(135deg, #10b981, #047857)' : 'none',
                color: activeMode === 'quick' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'quick' ? '0 2px 4px rgba(16, 185, 129, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              ⚡ Quick Commerce
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="ret-kpi-grid">
        <div className="ret-kpi-card" onClick={() => setStatusFilter('all')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>TOTAL RETURNS</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>↩️</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>{totalCount}</div>
        </div>

        <div className="ret-kpi-card" onClick={() => setStatusFilter(groupFilter('requested'))}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>REQUESTED</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⏳</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#b45309', fontFamily: "'Outfit', sans-serif" }}>{requestedCount}</div>
        </div>

        <div className="ret-kpi-card" onClick={() => setStatusFilter(groupFilter('pickup'))}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>APPROVED / PICKUP</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🚚</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Outfit', sans-serif" }}>{approvedCount}</div>
        </div>

        <div className="ret-kpi-card" onClick={() => setStatusFilter(groupFilter('refunded'))}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>REFUNDED</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✅</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#166534', fontFamily: "'Outfit', sans-serif" }}>{refundedCount}</div>
        </div>
      </div>

      {toast && (
        <div style={{ margin: '0 0 16px', padding: '10px 14px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>
          {toast}
        </div>
      )}

      {/* Filter Tabs & Search Bar Row */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginBottom: 16
      }}>
        {/* Status Filter Pills */}
        <div style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 4
        }}>
          {['all', ...Object.keys(STATUS_LABEL)].map((s) => {
            const isActive = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  border: 'none',
                  background: isActive ? '#10b981' : '#f1f5f9',
                  color: isActive ? '#fff' : '#64748b',
                  fontSize: 11,
                  fontWeight: isActive ? '800' : '700',
                  padding: '7px 16px',
                  borderRadius: 100,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: isActive ? '0 2px 6px rgba(16,185,129,0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>

        {/* Search Input Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#fff',
          border: '1.5px solid #e2e8f0',
          borderRadius: 100,
          padding: '8px 14px',
          width: '100%',
          maxWidth: '400px'
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            placeholder="Search by Return ID, Product, or Reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              background: 'none',
              fontSize: 12,
              fontWeight: 600,
              color: '#0f172a',
              width: '100%'
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Return Items List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
          Loading return requests…
        </div>
      ) : returns.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13, backgroundColor: '#fff', borderRadius: 16, border: '1.5px solid #f1f5f9' }}>
          No return requests recorded yet.
        </div>
      ) : filteredReturns.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 12, fontWeight: 600, backgroundColor: '#fff', borderRadius: 16, border: '1.5px solid #f1f5f9' }}>
          No returns found matching search query.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredReturns.map((r) => {
            const badge = STATUS_COLOR[r.status] || STATUS_COLOR.RETURN_REQUESTED;
            return (
              <div key={r._id} className="return-row-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{r.returnNumber}</div>
                    <div style={{ fontSize: 12, color: '#475569', fontWeight: 700, marginTop: 2 }}>
                      {r.productName} × {r.quantity}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>
                      {r.reason?.replace(/_/g, ' ')} · Requested {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                    </div>
                    {r.customerDescription && (
                      <div className="seller-return-description" style={{ fontSize: 12, color: '#334155', marginTop: 6, padding: '6px 10px', background: '#f8fafc', borderRadius: 8, overflowWrap: 'anywhere' }}>
                        “{r.customerDescription}”
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 12px', borderRadius: 20, background: badge.bg, color: badge.fg }}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>

                {r.rejectionReason && (
                  <div style={{ margin: '8px 0 0', fontSize: 11.5, color: '#991b1b', backgroundColor: '#fee2e2', padding: '6px 10px', borderRadius: 8 }}>
                    <b>Rejected:</b> {r.rejectionReason}
                  </div>
                )}

                {r.refundStatus && (
                  <div style={{ margin: '8px 0 0', fontSize: 11.5, color: '#059669', fontWeight: 700 }}>
                    Refund Status: {r.refundStatus}{r.refundAmount != null ? ` · ₹${r.refundAmount}` : ''}
                  </div>
                )}

                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{nextStep(r)}</span>
                  <button type="button" onClick={() => openDetail(r._id)}
                    style={{ border: '1.5px solid #cbd5e1', background: '#fff', color: '#0f172a', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    View details
                  </button>
                </div>

                {decisionPanel(r)}
                {pickupPanel(r)}
              </div>
            );
          })}
        </div>
      )}

      {detailId && (
        <ModalPortal className="seller-modal-overlay" style={{ zIndex: 100 }} role="dialog" aria-modal="true" aria-label="Return details"
          onClick={event => { if (event.target === event.currentTarget) closeDetail(); }}>
          <div className="seller-modal-sheet" style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-sheet-header">
              <h3>{detail?.returnNumber || 'Return details'}</h3>
              <button type="button" aria-label="Close return details" onClick={closeDetail}>✕</button>
            </div>
            {detailError ? (
              <div role="alert" style={{ fontSize: 12, color: '#991b1b' }}>
                {detailError} <button type="button" onClick={() => loadDetail(detailId)}>Retry</button>
              </div>
            ) : !detail ? (
              <p role="status" style={{ fontSize: 12, color: '#64748b' }}>Loading return…</p>
            ) : (
              <ReturnDetail r={detail} pickupPanel={pickupPanel} decisionPanel={decisionPanel} />
            )}
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

const Row = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
    <span style={{ color: '#64748b', fontWeight: 600 }}>{label}</span>
    <span style={{ color: '#0f172a', fontWeight: 700, textAlign: 'right' }}>{children ?? '—'}</span>
  </div>
);

const Section = ({ title, children }) => (
  <section style={{ marginTop: 14 }}>
    <h4 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{title}</h4>
    {children}
  </section>
);

const ReturnDetail = ({ r, pickupPanel, decisionPanel }) => {
  const badge = STATUS_COLOR[r.status] || STATUS_COLOR.RETURN_REQUESTED;
  const address = r.order?.pickupAddress;
  const rider = r.pickup?.partnerId;
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {r.productImage
          ? <img src={r.productImage} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
          : <div style={{ width: 56, height: 56, borderRadius: 10, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📦</div>}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{r.productName} × {r.quantity}</div>
          <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: badge.bg, color: badge.fg }}>
            {STATUS_LABEL[r.status] || r.status}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#f0f9ff', color: '#075985', fontSize: 12, fontWeight: 600 }}>
        <b>Next step:</b> {nextStep(r)}
      </div>
      {decisionPanel(r)}

      {r.rejectionReason && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '8px 10px', borderRadius: 8 }}>
          <b>Rejected:</b> {r.rejectionReason}
        </div>
      )}

      <Section title="Customer's reason">
        <Row label="Reason">{r.reason?.replace(/_/g, ' ')}</Row>
        {r.customerDescription && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#334155' }}>{r.customerDescription}</p>}
        {r.attachments?.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {r.attachments.map(file => file.mimeType === 'application/pdf'
              ? <a key={file.url} href={file.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{file.fileName || 'Attachment (PDF)'}</a>
              : <a key={file.url} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.fileName || 'Return photo'} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} /></a>)}
          </div>
        )}
      </Section>

      <Section title="Order">
        <Row label="Order">{r.order?.orderNo}</Row>
        <Row label="Customer">{r.customerName}</Row>
        <Row label="Delivered">{formatDate(r.order?.deliveredAt)}</Row>
        <Row label="Unit price">{r.unitPriceSnapshot != null ? `₹${r.unitPriceSnapshot}` : null}</Row>
        <Row label="Return window ends">{formatDate(r.returnEligibleUntilSnapshot)}</Row>
        {address && <Row label="Pickup from">{[address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ')}</Row>}
      </Section>

      <Section title="Pickup">
        <Row label="Method">{r.pickupMethod === 'SHIPROCKET' ? 'Shiprocket reverse pickup' : r.pickupMethod === 'MANUAL' ? 'Local rider' : 'Not chosen yet'}</Row>
        {r.pickupMethod === 'MANUAL' && <Row label="Rider status">{PICKUP_LABEL[r.pickup?.status] || r.pickup?.status}</Row>}
        {rider?.userId?.name && <Row label="Rider">{rider.userId.name}{rider.userId.phone ? ` · ${rider.userId.phone}` : ''}{rider.vehicleNo ? ` · ${rider.vehicleNo}` : ''}</Row>}
        {r.pickupMethod === 'SHIPROCKET' && <>
          <Row label="Courier">{r.courierName}</Row>
          <Row label="AWB">{r.awbNumber}</Row>
          <Row label="Tracking">{r.reverseBooking?.trackingState || r.reverseBooking?.state}</Row>
          {r.trackingUrl && <Row label="Track"><a href={r.trackingUrl} target="_blank" rel="noreferrer">Open tracking</a></Row>}
        </>}
        <Row label="Picked up">{formatDate(r.pickedUpAt)}</Row>
        <Row label="You confirmed receipt">{formatDate(r.pickup?.sellerConfirmedReceivedAt)}</Row>
        {pickupPanel(r)}
      </Section>

      {(r.refundStatus || r.refundAmount != null || r.restockDecision) && (
        <Section title="Inspection & refund">
          <Row label="Restock decision">{r.restockDecision?.replace(/_/g, ' ').toLowerCase()}</Row>
          <Row label="Customer refund">{r.refundAmount != null ? `₹${r.refundAmount}` : null}</Row>
          <Row label="Refund status">{r.refundStatus}</Row>
          <Row label="Refunded on">{formatDate(r.refundedAt)}</Row>
        </Section>
      )}

      {r.history?.length > 0 && (
        <Section title="Timeline">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#334155' }}>
            {r.history.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <b>{STATUS_LABEL[h.toStatus] || h.toStatus}</b>{h.comment ? ` — ${h.comment}` : ''}
                <span style={{ color: '#94a3b8' }}> · {formatDate(h.timestamp)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
};

export default SellerReturnsTab;
