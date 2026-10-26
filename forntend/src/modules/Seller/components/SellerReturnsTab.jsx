import React, { useEffect, useState, useMemo } from 'react';
import { apiUrl } from '../../../utils/api';
import { useSeller } from '../context/SellerContext';

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
  REFUNDED: 'Refunded', 
  REJECTED: 'Rejected', 
  CANCELLED: 'Cancelled',
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

  const load = async () => {
    setLoading(true);
    try {
      const qs = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await fetch(apiUrl(`/api/sellers/returns${qs}`), { headers: authHeaders() });
      const body = await res.json();
      setReturns(body.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const assignRider = async (id) => {
    if (!pickupChoices[id]) return;
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/pickup`), { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ pickupMethod: pickupChoices[id] }) });
      const body = await res.json();
      showToast(res.ok ? (body.message || 'Pickup updated') : (body.message || 'Could not arrange pickup'));
      await load();
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
      await load();
    } catch { showToast('Could not update pickup; reload before retrying'); }
    finally { setActionId(null); }
  };

  const markReceived = async (id) => {
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/sellers/returns/${id}/mark-received`), { method: 'POST', headers: authHeaders() });
      const body = await res.json();
      showToast(res.ok ? (body.message || 'Marked as received') : (body.message || 'Could not mark as received'));
      await load();
    } catch { showToast('Could not confirm receipt; reload before retrying');
    } finally {
      setActionId(null);
    }
  };

  // KPI Calculations with actual counts from returns data
  const totalCount = returns.length;
  const requestedCount = useMemo(() => returns.filter(r => ['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(r.status)).length, [returns]);
  const approvedCount = useMemo(() => returns.filter(r => ['APPROVED', 'AWAITING_RETURN', 'RETURN_RECEIVED'].includes(r.status)).length, [returns]);
  const refundedCount = useMemo(() => returns.filter(r => ['REFUNDED', 'REFUND_PENDING'].includes(r.status)).length, [returns]);

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
            Approval/refund is Admin-only — pickup logistics are yours.
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

        <div className="ret-kpi-card" onClick={() => setStatusFilter('RETURN_REQUESTED')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>REQUESTED</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⏳</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#b45309', fontFamily: "'Outfit', sans-serif" }}>{requestedCount}</div>
        </div>

        <div className="ret-kpi-card" onClick={() => setStatusFilter('APPROVED')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>APPROVED / PICKUP</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🚚</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Outfit', sans-serif" }}>{approvedCount}</div>
        </div>

        <div className="ret-kpi-card" onClick={() => setStatusFilter('REFUNDED')}>
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

                {['APPROVED', 'AWAITING_RETURN'].includes(r.status) && (
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SellerReturnsTab;
