import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPatch } from '../../../utils/adminApi';

/** Admin — Packaging Orders: read-only visibility + the one V1-honest transition (CONFIRMED -> PROCESSING). No Shiprocket/fake shipping controls. */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const STATUS_BADGE = { PAYMENT_PENDING: 'pending', CONFIRMED: 'approved', PROCESSING: 'approved', CANCELLED: 'rejected' };

export const PackagingOrdersTab = () => {
  const { triggerToast } = useAdmin();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/packaging/orders${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`);
      setOrders(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load orders');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (id) => {
    try {
      const res = await adminGet(`/packaging/orders/${id}`);
      setDetail(res.data);
    } catch (err) {
      triggerToast(err.message || 'Could not load order');
    }
  };

  const markProcessing = async (id) => {
    try {
      await adminPatch(`/packaging/orders/${id}/status`, { status: 'PROCESSING' });
      triggerToast('Order marked as processing.');
      setDetail(null);
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update order');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Packaging Orders</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
          Seller purchases of Bulkimart branded packaging — package or bulk. V1 stops at Confirmed/Processing; shipping is a future integration.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="PAYMENT_PENDING">Payment Pending</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PROCESSING">Processing</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Order #', 'Seller', 'Type', 'Items', 'Amount', 'Payment', 'Status', 'Date'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No packaging orders yet.</td></tr>
            ) : orders.map((o, i) => (
              <tr key={o._id} onClick={() => openDetail(o._id)} style={{ borderBottom: i === orders.length - 1 ? 'none' : '1px solid var(--sa-border)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{o.orderNumber}</td>
                <td style={{ padding: '12px 16px' }}>{o.sellerId?.businessName || o.sellerId?.userId?.name || '—'}</td>
                <td style={{ padding: '12px 16px' }}>{o.orderType}</td>
                <td style={{ padding: '12px 16px' }}>{o.totalItems}</td>
                <td style={{ padding: '12px 16px' }}>{money(o.payableAmount)}</td>
                <td style={{ padding: '12px 16px' }}>{o.paymentStatus}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${STATUS_BADGE[o.orderStatus]}`}>{o.orderStatus}</span></td>
                <td style={{ padding: '12px 16px' }}>{new Date(o.createdAt).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="admin-modal-overlay" onClick={() => setDetail(null)}>
          <div className="admin-modal-sheet" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{detail.orderNumber}</h3>
              <button className="admin-modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
              <p style={{ margin: 0 }}><b>Type:</b> {detail.orderType}{detail.packageNameSnapshot ? ` — ${detail.packageNameSnapshot} × ${detail.packageQuantity}` : ''}</p>
              <p style={{ margin: 0 }}><b>Seller:</b> {detail.sellerId?.businessName || detail.sellerId?.userId?.name}</p>
              <p style={{ margin: 0 }}><b>Payment:</b> {detail.paymentStatus} · <b>Order Status:</b> {detail.orderStatus}</p>
              {detail.shippingAddressSnapshot?.address && (
                <p style={{ margin: 0 }}><b>Ships to:</b> {[detail.shippingAddressSnapshot.address, detail.shippingAddressSnapshot.city, detail.shippingAddressSnapshot.state, detail.shippingAddressSnapshot.pincode].filter(Boolean).join(', ')}</p>
              )}
              <div style={{ border: '1px solid var(--sa-border)', borderRadius: 10, overflow: 'hidden', marginTop: 6 }}>
                {(detail.items || []).map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--sa-border)' }}>
                    <span>{it.materialNameSnapshot} {it.specificationSnapshot ? `(${it.specificationSnapshot})` : ''} × {it.quantity}</span>
                    <span>{money(it.lineTotal)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                <span>Total Items: {detail.totalItems}</span>
                <span>Payable: {money(detail.payableAmount)}</span>
              </div>
              {detail.orderStatus === 'CONFIRMED' && (
                <button className="sa-btn-primary" style={{ justifyContent: 'center', marginTop: 8 }} onClick={() => markProcessing(detail._id)}>
                  Mark as Processing
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PackagingOrdersTab;
