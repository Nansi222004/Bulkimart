import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../../utils/api';

const prettyStatus = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export const VendorOrdersTab = ({ defaultMode = 'active', isShgOnly = false }) => {
  const [mode, setMode] = useState(defaultMode); // 'active' | 'history'
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 15, totalPages: 1, total: 0 });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [financialAudit, setFinancialAudit] = useState(null);

  const getAuthHeader = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''),
  });

  const fetchOrders = useCallback(async (page = 1, currentMode = mode, currentStatus = statusFilter, currentSearch = search) => {
    setLoading(true);
    setError('');
    try {
      let query = `/api/admin/vendor-orders?mode=${currentMode}&page=${page}&limit=15`;
      if (isShgOnly) query += `&shgOnly=true`;
      if (currentStatus && currentStatus !== 'all') query += `&status=${encodeURIComponent(currentStatus)}`;
      if (currentSearch && currentSearch.trim()) query += `&search=${encodeURIComponent(currentSearch.trim())}`;

      const res = await fetch(apiUrl(query), { headers: getAuthHeader() });
      const body = await res.json();

      if (body.success) {
        setOrders(body.data || []);
        const meta = body.meta || body.pagination || {};
        setPagination({
          page: meta.page || page,
          limit: meta.limit || 15,
          totalPages: meta.pages || meta.totalPages || 1,
          total: meta.total || (body.data || []).length,
        });
      } else {
        setError(body.message || 'Failed to load vendor orders');
      }
    } catch (err) {
      console.error('Error fetching vendor orders:', err);
      setError(err.message || 'Network error fetching orders');
    } finally {
      setLoading(false);
    }
  }, [mode, statusFilter, search]);

  useEffect(() => {
    setMode(defaultMode);
    setStatusFilter('all');
  }, [defaultMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders(1, mode, statusFilter, search);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [mode, statusFilter, search, fetchOrders]);

  useEffect(() => {
    if (!selectedOrder?._id) { setFinancialAudit(null); return undefined; }
    let active = true;
    fetch(apiUrl(`/api/admin/orders/${selectedOrder._id}/financial-breakdown`), { headers: getAuthHeader() })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => { if (active) setFinancialAudit(response.ok ? body.data : { error: body.message }); })
      .catch((err) => { if (active) setFinancialAudit({ error: err.message }); });
    return () => { active = false; };
  }, [selectedOrder?._id]);

  const getStatusBadgeStyle = (st) => {
    const s = String(st || '').toLowerCase();
    if (s === 'delivered' || s === 'completed') return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
    if (s === 'out_for_delivery' || s === 'in_transit' || s === 'dispatch') return { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' };
    if (s === 'confirmed' || s === 'preparing' || s === 'accepted' || s === 'processing' || s === 'packing') return { bg: '#fef3c7', color: '#b45309', border: '#fde68a' };
    if (s === 'cancelled' || s === 'rejected') return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
    return { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
  };

  const activeStatusOptions = [
    { value: 'all', label: 'All Active Orders' },
    { value: 'placed', label: 'Placed / New' },
    { value: 'confirmed', label: 'Accepted' },
    { value: 'preparing', label: 'Preparing' },
    { value: 'dispatched', label: 'Ready / Dispatched' },
    { value: 'out_for_delivery', label: 'Out for Delivery' },
  ];

  const historyStatusOptions = [
    { value: 'all', label: 'All History' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'refunded', label: 'Refunded' },
  ];

  const currentOptions = mode === 'active' ? activeStatusOptions : historyStatusOptions;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header Banner */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: mode === 'active' ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '24px', borderRadius: '16px', color: '#ffffff', boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>
              {mode === 'active' ? '🛒 Live Vendor Orders Pipeline' : '📜 Vendor Order History Logs'}
            </h2>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
            {mode === 'active'
              ? 'Real-time order flow across all registered vendor stores and dark stores.'
              : 'Complete historical log of fulfilled, delivered, cancelled, and refunded vendor orders.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setMode(mode === 'active' ? 'history' : 'active')}
            style={{
              padding: '10px 16px', backgroundColor: 'rgba(255, 255, 255, 0.15)',
              color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '10px',
              fontWeight: '700', cursor: 'pointer', fontSize: '13px'
            }}
          >
            {mode === 'active' ? 'Switch to Order History →' : 'Switch to Active Pipeline →'}
          </button>
          <button
            onClick={() => fetchOrders(pagination.page)}
            style={{
              padding: '10px 16px', backgroundColor: '#15803d',
              color: '#ffffff', border: 'none', borderRadius: '10px',
              fontWeight: '700', cursor: 'pointer', fontSize: '13px'
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by Order No, Customer Name, Phone, or City..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: '280px', padding: '12px 16px',
            border: '1.5px solid #cbd5e1', borderRadius: '10px',
            fontSize: '14px', outline: 'none'
          }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          {currentOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              style={{
                padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                border: statusFilter === opt.value ? '2px solid #15803d' : '1px solid #cbd5e1',
                backgroundColor: statusFilter === opt.value ? '#f0fdf4' : '#ffffff',
                color: statusFilter === opt.value ? '#15803d' : '#475569',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>
            {mode === 'active' ? 'Total Pipeline Orders' : 'Total Historical Orders'}
          </span>
          <h3 style={{ margin: '6px 0 0 0', fontSize: '22px', fontWeight: '900', color: '#0f172a' }}>
            {pagination.total || 0}
          </h3>
        </div>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>Showing On Page</span>
          <h3 style={{ margin: '6px 0 0 0', fontSize: '22px', fontWeight: '900', color: '#0f172a' }}>
            {orders.length}
          </h3>
        </div>
      </div>

      {/* Orders Table */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
            Loading vendor orders...
          </div>
        ) : error ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#ef4444', fontWeight: '700' }}>
            {error}
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            No vendor orders found matching your criteria.
          </div>
        ) : (
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <th style={{ padding: '14px 16px' }}>Order Ref</th>
                  <th style={{ padding: '14px 16px' }}>Vendor Store</th>
                  <th style={{ padding: '14px 16px' }}>Customer</th>
                  <th style={{ padding: '14px 16px' }}>Items</th>
                  <th style={{ padding: '14px 16px' }}>Total Amount</th>
                  <th style={{ padding: '14px 16px' }}>Payment</th>
                  <th style={{ padding: '14px 16px' }}>Date</th>
                  <th style={{ padding: '14px 16px' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const bStyle = getStatusBadgeStyle(o.status);
                  return (
                    <tr
                      key={o._id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        borderLeft: '4px solid transparent',
                      }}
                    >
                      <td style={{ padding: '14px 16px', fontWeight: '800', fontFamily: 'monospace', color: '#1e293b' }}>
                        {o.orderNo || o._id.substring(0, 10)}{o.salesChannel === 'wholesale' ? ' · Wholesale' : ''}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: '700', color: '#0f172a' }}>{o.storeNames}</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{o.customerName}</div>
                        <div style={{ fontSize: '11.5px', color: '#64748b' }}>{o.customerPhone} • {o.city}</div>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#334155' }}>
                        <span style={{ fontWeight: '700' }}>{o.itemCount} items</span>
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: '900', color: '#0f172a' }}>
                        {money(o.totalAmount)}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#475569', fontSize: '12.5px' }}>
                        {prettyStatus(o.paymentMethod)} · {prettyStatus(o.paymentStatus)}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '12px' }}>
                        {fmtDate(o.createdAt)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '800',
                          backgroundColor: bStyle.bg, color: bStyle.color, border: `1px solid ${bStyle.border}`
                        }}>
                          {prettyStatus(o.status)}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={() => setSelectedOrder(o)}
                          style={{
                            padding: '6px 12px', backgroundColor: '#f1f5f9', color: '#1e293b',
                            border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: '700',
                            fontSize: '12px', cursor: 'pointer'
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} orders)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={pagination.page <= 1}
                onClick={() => fetchOrders(pagination.page - 1)}
                style={{
                  padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
                  backgroundColor: pagination.page <= 1 ? '#f1f5f9' : '#ffffff',
                  cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700'
                }}
              >
                Previous
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchOrders(pagination.page + 1)}
                style={{
                  padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
                  backgroundColor: pagination.page >= pagination.totalPages ? '#f1f5f9' : '#ffffff',
                  cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700'
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ORDER DETAILS MODAL */}
      {selectedOrder && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff', borderRadius: '16px', width: '100%', maxWidth: '650px',
            maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                    Order {selectedOrder.orderNo}{selectedOrder.salesChannel === 'wholesale' ? ' · Wholesale' : ''}
                  </h3>
                </div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Placed on {fmtDate(selectedOrder.createdAt)}</span>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Customer & Address */}
              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>Delivery & Customer Info</span>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginTop: '4px' }}>
                  {selectedOrder.customerName} ({selectedOrder.customerPhone})
                </div>
                {selectedOrder.shippingAddress && (
                  <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '4px' }}>
                    {[selectedOrder.shippingAddress.line1, selectedOrder.shippingAddress.line2, selectedOrder.shippingAddress.city, selectedOrder.shippingAddress.state, selectedOrder.shippingAddress.pincode].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>

              {/* Items List */}
              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>Lifecycle & Fulfillment</span>
                <div style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 4 }}>
                  <div>Channel: {selectedOrder.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}</div>
                  <div>Vendor decision: {prettyStatus(selectedOrder.vendorDecision?.status || 'pending')}{selectedOrder.vendorDecision?.reason ? ` — ${selectedOrder.vendorDecision.reason}` : ''}</div>
                  <div>Method: {prettyStatus(selectedOrder.fulfillment?.method || selectedOrder.deliveryMode || 'not selected')}</div>
                  <div>Rider: {selectedOrder.deliveryPartnerId || 'Not assigned'}</div>
                  <div>Provider: {selectedOrder.shiprocket?.courier || '—'}</div>
                  <div>AWB: {selectedOrder.shiprocket?.awb || '—'}</div>
                  <div>Tracking status: {selectedOrder.shiprocket?.status || '—'}</div>
                  {selectedOrder.shiprocket?.lastError && <div style={{ color: '#b91c1c' }}>Shipment failure: {selectedOrder.shiprocket.lastError}</div>}
                  {selectedOrder.needsManualAssignment && <div style={{ color: '#b45309' }}>Manual assignment required</div>}
                  {selectedOrder.fulfillment?.quote && <div>Courier {money(selectedOrder.fulfillment.quote.courierCharge)} + service fee {money(selectedOrder.fulfillment.quote.serviceFee)} · {selectedOrder.fulfillment.chargeStatus}</div>}
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>Seller financial audit</span>
                {financialAudit?.error ? <div style={{ color: '#b91c1c', marginTop: 6 }}>{financialAudit.error}</div>
                  : !financialAudit ? <div style={{ color: '#64748b', marginTop: 6 }}>Loading financial audit…</div>
                    : financialAudit.snapshot ? <div style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 4 }}>
                      <div>Accounting status: {prettyStatus(financialAudit.snapshot.accountingStatus)}</div>
                      <div>Customer delivery charge available: {money(financialAudit.snapshot.customerDeliveryChargeAvailableForFreight)}</div>
                      <div>Allocated to freight: {money(financialAudit.snapshot.customerFreightContribution)}</div>
                      <div>Quoted / final freight: {money(financialAudit.snapshot.quotedCourierFreight)} / {financialAudit.snapshot.finalProviderFreight == null ? 'Pending' : money(financialAudit.snapshot.finalProviderFreight)}</div>
                      <div>Vendor freight share: {money(financialAudit.snapshot.vendorFreightShare)}</div>
                      <div>Bulkimart fee: {money(financialAudit.snapshot.serviceFee?.amount)} · {financialAudit.snapshot.serviceFee?.version}</div>
                      <div style={{ fontWeight: 800 }}>Vendor obligation: {money(financialAudit.snapshot.vendorDeliveryFeeObligation)}</div>
                      <div>Ledger postings: {financialAudit.entries?.length || 0}</div>
                    </div> : <div style={{ color: '#64748b', marginTop: 6 }}>No immutable Quick third-party financial snapshot. Provisional quotes are not charges.</div>}
              </div>

              {/* Items List */}
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
                  Order Items ({selectedOrder.items?.length || 0})
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(selectedOrder.items || []).map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {it.image && <img src={it.image} alt={it.name} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px' }} />}
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{it.name}</div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Qty: {it.qty} × {money(it.price)}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '13.5px', fontWeight: '800', color: '#0f172a' }}>
                        {money((it.price || 0) * (it.qty || 1))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>Total Amount Paid</span>
                <span style={{ fontSize: '18px', fontWeight: '900', color: '#15803d' }}>{money(selectedOrder.totalAmount)}</span>
              </div>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                onClick={() => setSelectedOrder(null)}
                style={{ padding: '8px 16px', backgroundColor: '#1e293b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorOrdersTab;
