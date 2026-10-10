import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Seller — Packaging Material: buy NHCONE branded packaging (jars, bottles,
 * pouches...) either as a predefined admin Package or as a custom 500+
 * item Bulk Order. Every price shown here is a live quote from the server
 * — nothing is computed client-side and trusted for payment; the amount
 * actually charged always comes back from the create-order call itself.
 */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const token = () => localStorage.getItem('userToken');
const authHeaders = (json = true) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  Authorization: 'Bearer ' + token(),
});

const api = {
  materials: () => fetch(apiUrl('/api/sellers/packaging/materials'), { headers: authHeaders(false) }).then((r) => r.json()),
  packages: () => fetch(apiUrl('/api/sellers/packaging/packages'), { headers: authHeaders(false) }).then((r) => r.json()),
  packageDetail: (id) => fetch(apiUrl(`/api/sellers/packaging/packages/${id}`), { headers: authHeaders(false) }).then((r) => r.json()),
  buyPackage: (packageId, quantity) => fetch(apiUrl('/api/sellers/packaging/orders/package'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ packageId, quantity }) }).then((r) => r.json()),
  buyBulk: (items) => fetch(apiUrl('/api/sellers/packaging/orders/bulk'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ items }) }).then((r) => r.json()),
  myOrders: () => fetch(apiUrl('/api/sellers/packaging/orders'), { headers: authHeaders(false) }).then((r) => r.json()),
  orderDetail: (id) => fetch(apiUrl(`/api/sellers/packaging/orders/${id}`), { headers: authHeaders(false) }).then((r) => r.json()),
};

const BULK_MIN = 500;

const btnPrimary = { padding: '10px 18px', borderRadius: 10, border: 'none', background: '#10b981', color: '#fff', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' };
const btnGhost = { padding: '8px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' };
const cardStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 };

const ORDER_STATUS_BADGE = {
  PAYMENT_PENDING: { bg: '#fef3c7', fg: '#92400e', label: 'Payment Pending' },
  CONFIRMED:       { bg: '#dcfce7', fg: '#166534', label: 'Confirmed' },
  PROCESSING:      { bg: '#dbeafe', fg: '#1e40af', label: 'Processing' },
  CANCELLED:       { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' },
};

export const SellerPackagingTab = () => {
  const [subTab, setSubTab] = useState('packages'); // 'packages' | 'bulk' | 'orders'

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Packaging Material</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>Bulkimart branded jars, bottles, pouches & more — for sellers who need packaging.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[['packages', 'Available Packages'], ['bulk', 'Bulk Order'], ['orders', 'My Packaging Orders']].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{
            padding: '8px 14px', borderRadius: 999, border: 'none', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
            background: subTab === id ? '#10b981' : '#f1f5f9', color: subTab === id ? '#fff' : '#64748b',
          }}>{label}</button>
        ))}
      </div>

      {subTab === 'packages' && <PackagesPanel />}
      {subTab === 'bulk' && <BulkOrderPanel />}
      {subTab === 'orders' && <MyOrdersPanel />}
    </div>
  );
};

const PackagesPanel = () => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await api.packages();
      setPackages(res.data || []);
      setLoading(false);
    })();
  }, []);

  const open = async (pkgId) => {
    setQty(1);
    const res = await api.packageDetail(pkgId);
    if (!res.success) { alert(res.message || 'This package is no longer available.'); return; }
    setDetail(res.data);
  };

  const buy = async () => {
    if (!detail) return;
    setBuying(true);
    try {
      const res = await api.buyPackage(detail._id, qty);
      if (!res.success) { alert(res.message || 'Could not start payment.'); return; }
      window.location.href = res.data.redirectUrl;
    } finally {
      setBuying(false);
    }
  };

  if (detail) {
    return (
      <div style={{ maxWidth: 560 }}>
        <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginBottom: 12, padding: 0 }}>← Back</button>
        <div style={cardStyle}>
          {detail.image && <img src={detail.image} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, marginBottom: 12 }} />}
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 900 }}>{detail.name}</h3>
          {detail.description && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#64748b' }}>{detail.description}</p>}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
            {(detail.items || []).map((it, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                <span>{it.material?.name} {it.material?.specification ? `(${it.material.specification})` : ''} × {it.quantity}</span>
                <span>{money(it.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span>Total Items (per unit)</span><b>{detail.totalItems}</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>Package Units</label>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 70, padding: '6px 10px', borderRadius: 8, border: '1.5px solid #e2e8f0' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 900, marginBottom: 14 }}>
            <span>Estimated Total</span><span style={{ color: '#10b981' }}>{money(detail.subtotal * qty)}</span>
          </div>
          <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '0 0 12px' }}>The final amount charged is recalculated by the server at checkout.</p>
          <button style={btnPrimary} disabled={buying} onClick={buy}>{buying ? 'Starting payment…' : 'Pay with PhonePe'}</button>
        </div>
      </div>
    );
  }

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 12.5 }}>Loading…</p>;
  if (packages.length === 0) return <p style={{ color: '#94a3b8', fontSize: 12.5, textAlign: 'center', padding: '40px 0' }}>No packages published yet — check back later.</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
      {packages.map((p) => (
        <div key={p._id} onClick={() => open(p._id)} style={{ ...cardStyle, cursor: 'pointer' }}>
          {p.image && <img src={p.image} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />}
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5 }}>{p.name}</p>
          <p style={{ margin: '4px 0 8px', fontSize: 11.5, color: '#64748b' }}>{p.totalItems} items · {(p.items || []).length} material kind(s)</p>
          <b style={{ fontSize: 15, color: '#10b981' }}>{money(p.subtotal)}</b>
        </div>
      ))}
    </div>
  );
};

const BulkOrderPanel = () => {
  const [materials, setMaterials] = useState([]);
  const [rows, setRows] = useState([]); // [{materialId, quantity}]
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api.materials();
      setMaterials(res.data || []);
    })();
  }, []);

  const addRow = () => setRows((prev) => [...prev, { materialId: '', quantity: '' }]);
  const removeRow = (idx) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx, patch) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const totalItems = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const subtotal = rows.reduce((sum, r) => {
    const m = materials.find((mm) => String(mm._id) === String(r.materialId));
    return sum + (m ? m.unitPrice * (Number(r.quantity) || 0) : 0);
  }, 0);

  const buy = async () => {
    const items = rows.filter((r) => r.materialId && Number(r.quantity) > 0).map((r) => ({ materialId: r.materialId, quantity: Number(r.quantity) }));
    if (items.length === 0) { alert('Add at least one material and quantity.'); return; }
    if (totalItems < BULK_MIN) { alert(`A bulk order needs at least ${BULK_MIN} total items (currently ${totalItems}).`); return; }
    setBuying(true);
    try {
      const res = await api.buyBulk(items);
      if (!res.success) { alert(res.message || 'Could not start payment.'); return; }
      window.location.href = res.data.redirectUrl;
    } finally {
      setBuying(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        Custom packaging requirement — pick materials and quantities. Minimum <b>{BULK_MIN}</b> total items.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {rows.map((r, idx) => {
          const m = materials.find((mm) => String(mm._id) === String(r.materialId));
          return (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={r.materialId} onChange={(e) => updateRow(idx, { materialId: e.target.value })}
                style={{ flex: 2, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 12.5 }}>
                <option value="">Select material…</option>
                {materials.map((mm) => <option key={mm._id} value={mm._id}>{mm.name} ({money(mm.unitPrice)})</option>)}
              </select>
              <input type="number" min="1" placeholder="Qty" value={r.quantity} onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 12.5 }} />
              <span style={{ width: 80, fontSize: 11.5, color: '#64748b', textAlign: 'right' }}>{m ? money(m.unitPrice * (Number(r.quantity) || 0)) : ''}</span>
              <button onClick={() => removeRow(idx)} style={{ ...btnGhost, padding: '6px 10px' }}>✕</button>
            </div>
          );
        })}
      </div>
      <button onClick={addRow} style={{ ...btnGhost, marginBottom: 16 }}>+ Add Material</button>

      <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: totalItems >= BULK_MIN ? '#166534' : '#991b1b', fontWeight: 800 }}>
            Total Items: {totalItems} {totalItems < BULK_MIN ? `(need ${BULK_MIN - totalItems} more)` : '✓'}
          </p>
        </div>
        <b style={{ fontSize: 16, color: '#10b981' }}>{money(subtotal)}</b>
      </div>
      <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '0 0 12px' }}>This is an estimate — the server recalculates the final amount from live prices at checkout.</p>
      <button style={btnPrimary} disabled={buying || totalItems < BULK_MIN} onClick={buy}>
        {buying ? 'Starting payment…' : 'Pay with PhonePe'}
      </button>
    </div>
  );
};

const MyOrdersPanel = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await api.myOrders();
      setOrders(res.data || []);
      setLoading(false);
    })();
  }, []);

  const open = async (id) => {
    const res = await api.orderDetail(id);
    if (res.success) setDetail(res.data);
  };

  if (detail) {
    const badge = ORDER_STATUS_BADGE[detail.orderStatus] || ORDER_STATUS_BADGE.PAYMENT_PENDING;
    return (
      <div style={{ maxWidth: 560 }}>
        <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginBottom: 12, padding: 0 }}>← Back</button>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <b style={{ fontSize: 15 }}>{detail.orderNumber}</b>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{badge.label}</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#64748b' }}>
            {detail.orderType === 'PACKAGE' ? `${detail.packageNameSnapshot} × ${detail.packageQuantity}` : 'Custom Bulk Order'}
          </p>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
            {(detail.items || []).map((it, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                <span>{it.materialNameSnapshot} {it.specificationSnapshot ? `(${it.specificationSnapshot})` : ''} × {it.quantity} @ {money(it.unitPriceSnapshot)}</span>
                <span>{money(it.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 900 }}>
            <span>Paid</span><span>{money(detail.payableAmount)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 12.5 }}>Loading…</p>;
  if (orders.length === 0) return <p style={{ color: '#94a3b8', fontSize: 12.5, textAlign: 'center', padding: '40px 0' }}>No packaging orders yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {orders.map((o) => {
        const badge = ORDER_STATUS_BADGE[o.orderStatus] || ORDER_STATUS_BADGE.PAYMENT_PENDING;
        return (
          <div key={o._id} onClick={() => open(o._id)} style={{ ...cardStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>{o.orderNumber}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#94a3b8' }}>
                {o.orderType} · {o.totalItems} items · {money(o.payableAmount)} · {new Date(o.createdAt).toLocaleDateString('en-IN')}
              </p>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{badge.label}</span>
          </div>
        );
      })}
    </div>
  );
};

export default SellerPackagingTab;
