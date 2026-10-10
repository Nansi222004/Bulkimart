import React, { useState, useEffect, useMemo } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Consumer Users -> Orders — every order ever placed, across BOTH
 * channels, always current. This used to silently hardcode
 * `type: 'ecommerce'` (SectionModuleTab's generic shell), so a Quick
 * Commerce order never once showed up here — fixed by making `type`
 * optional server-side (admin.controller.js::getCustomerOrders) and
 * defaulting this screen to "All Channels".
 *
 * "+ Add New Entry" is gone — nobody hand-authors an order record — and
 * "Export CSV" now actually writes a file, off exactly the page of rows
 * currently on screen.
 */

const CHANNEL_LABELS = { ecommerce: 'E-Commerce', grocery: 'Quick Commerce', subscription: 'Subscription' };
const CHANNEL_COLORS = {
  ecommerce: { bg: '#e0f2fe', fg: '#075985' },
  grocery: { bg: '#fef3c7', fg: '#92400e' },
  subscription: { bg: '#f3e8ff', fg: '#6b21a8' },
};

const STATUS_OPTIONS = [
  'placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery',
  'delivered', 'cancelled', 'return_requested', 'returned', 'refunded',
];
const STATUS_COLORS = {
  placed: { bg: '#e0f2fe', fg: '#075985' }, confirmed: { bg: '#e0f2fe', fg: '#075985' },
  preparing: { bg: '#fef9c3', fg: '#854d0e' }, dispatched: { bg: '#fef9c3', fg: '#854d0e' },
  out_for_delivery: { bg: '#fef9c3', fg: '#854d0e' }, delivered: { bg: '#dcfce7', fg: '#166534' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' }, return_requested: { bg: '#fee2e2', fg: '#991b1b' },
  returned: { bg: '#fee2e2', fg: '#991b1b' }, refunded: { bg: '#f1f5f9', fg: '#475569' },
};

const toCsv = (rows, columns) => {
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(','));
  return [header, ...lines].join('\r\n');
};

const downloadCsv = (filename, csvString) => {
  const blob = new Blob([`﻿${csvString}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const ConsumerOrdersTab = () => {
  const { customerOrders, customerOrdersLoading, customerOrdersMeta, fetchCustomerOrders, triggerToast } = useAdmin();

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Any filter change starts back at page 1 — staying on page 4 of a
  // narrower result set would just show "no matching records" for no
  // visible reason.
  useEffect(() => { setPage(1); }, [search, channelFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchCustomerOrders({
        search: search || undefined,
        type: channelFilter === 'All' ? undefined : channelFilter,
        status: statusFilter === 'All' ? undefined : statusFilter,
        page, limit: 20,
      });
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, channelFilter, statusFilter, page, fetchCustomerOrders]);

  const rows = useMemo(() => customerOrders.map((o) => ({
    id: o._id,
    orderNo: o.orderNo,
    customerName: o.userId?.name || 'Buyer',
    customerPhone: o.userId?.phone || '—',
    channelKey: o.type,
    channel: CHANNEL_LABELS[o.type] || o.type,
    items: (o.items || []).length,
    amount: o.pricing?.totalAmount ?? 0,
    statusKey: o.status,
    placedOn: o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    courier: o.shiprocket?.courier || null,
    tracking: o.shiprocket?.awb || null,
    // Whichever vendor fulfilled this order's item(s) — Seller and SHGStore
    // are mutually exclusive per item, so at most one of these is ever set.
    shopName: o.items?.[0]?.sellerId?.businessName || o.items?.[0]?.shgStoreId?.groupName || null,
    // Delivery partner — vehicle details live on DeliveryPartner, name/phone
    // on the User behind it. Absent until a rider actually accepts the job.
    riderName: o.deliveryPartnerId?.userId?.name || null,
    riderPhone: o.deliveryPartnerId?.userId?.phone || null,
    riderVehicle: o.deliveryPartnerId
      ? [o.deliveryPartnerId.vehicleType, o.deliveryPartnerId.vehicleNo].filter(Boolean).join(' — ')
      : null,
    // The address snapshot FROZEN on this order at checkout — never the
    // customer's live saved addresses, which may have changed since.
    deliveryAddress: o.shippingAddress
      ? [o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.city, o.shippingAddress.state, o.shippingAddress.pincode].filter(Boolean).join(', ')
      : null,
  })), [customerOrders]);

  const handleExportCsv = () => {
    if (rows.length === 0) { triggerToast('Nothing to export — no matching records on this page.'); return; }
    const csv = toCsv(rows, [
      { label: 'Order ID', value: (r) => r.orderNo },
      { label: 'Customer', value: (r) => r.customerName },
      { label: 'Phone', value: (r) => r.customerPhone },
      { label: 'Delivery Address', value: (r) => r.deliveryAddress || '' },
      { label: 'Channel', value: (r) => r.channel },
      { label: 'Seller / Shop', value: (r) => r.shopName || '' },
      { label: 'Items', value: (r) => r.items },
      { label: 'Total Amount (₹)', value: (r) => r.amount },
      { label: 'Status', value: (r) => r.statusKey },
      { label: 'Placed On', value: (r) => r.placedOn },
      { label: 'Rider Name', value: (r) => r.riderName || '' },
      { label: 'Rider Phone', value: (r) => r.riderPhone || '' },
      { label: 'Vehicle', value: (r) => r.riderVehicle || '' },
    ]);
    downloadCsv(`consumer-orders-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    triggerToast(`Exported ${rows.length} record(s) from this page to CSV.`);
  };

  const pages = customerOrdersMeta.pages || 0;

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Customer Orders</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {customerOrdersMeta.total} Total Orders
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Every order ever placed, across E-Commerce and Quick Commerce — always current.
          </p>
        </div>

        <button
          className="sa-btn-primary"
          style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
          onClick={handleExportCsv}
        >
          ⬇ Export CSV
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: '1 1 260px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by order ID, customer name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="sa-select" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
          <option value="All">All Channels</option>
          <option value="ecommerce">E-Commerce</option>
          <option value="grocery">Quick Commerce</option>
        </select>

        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Order ID', 'Customer', 'Channel', 'Items', 'Total Amount', 'Status', 'Placed On'].map((col) => (
                <th key={col} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {col}
                </th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {customerOrdersLoading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No matching orders found.</td></tr>
            ) : (
              rows.map((row, idx) => {
                const channelColor = CHANNEL_COLORS[row.channelKey] || CHANNEL_COLORS.ecommerce;
                const statusColor = STATUS_COLORS[row.statusKey] || STATUS_COLORS.placed;
                return (
                  <tr key={row.id} style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sa-text-secondary)' }}>{row.orderNo}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--sa-text-primary)' }}>
                      {row.customerName}
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sa-text-muted)' }}>{row.customerPhone}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 10, backgroundColor: channelColor.bg, color: channelColor.fg }}>
                        {row.channel}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)', fontWeight: 600 }}>{row.items}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-primary)', fontWeight: 800 }}>₹{row.amount.toLocaleString('en-IN')}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 10, backgroundColor: statusColor.bg, color: statusColor.fg, textTransform: 'capitalize' }}>
                        {row.statusKey.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)', fontWeight: 600 }}>{row.placedOn}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => setSelectedOrder(row)}>
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--sa-border)' }}>
            <span style={{ fontSize: 11.5, color: 'var(--sa-text-muted)' }}>
              Page {customerOrdersMeta.page} of {pages} — {customerOrdersMeta.total} total orders
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="sa-action-btn" style={{ width: 'auto', padding: '5px 12px' }}
                disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                className="sa-action-btn" style={{ width: 'auto', padding: '5px 12px' }}
                disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedOrder && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 480 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Order {selectedOrder.orderNo}</h3>
              <button className="admin-modal-close" onClick={() => setSelectedOrder(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Customer', selectedOrder.customerName],
                ['Phone', selectedOrder.customerPhone],
                ['Delivery Address', selectedOrder.deliveryAddress || 'Not captured on this order'],
                ['Channel', selectedOrder.channel],
                ['Items', selectedOrder.items],
                ['Total Amount', `₹${selectedOrder.amount.toLocaleString('en-IN')}`],
                ['Status', selectedOrder.statusKey.replace(/_/g, ' ')],
                ['Placed On', selectedOrder.placedOn],
                ...(selectedOrder.shopName ? [['Seller / Shop', selectedOrder.shopName]] : []),
                ...(selectedOrder.courier ? [['Courier Partner', selectedOrder.courier]] : []),
                ...(selectedOrder.tracking ? [['Tracking #', selectedOrder.tracking]] : []),
              ].map(([label, value]) => (
                <div key={label} className="admin-item-row" style={{ padding: '4px 0' }}>
                  <span className="admin-item-label">{label}</span>
                  <span className="admin-item-value" style={{ fontWeight: 700, textTransform: label === 'Status' ? 'capitalize' : 'none' }}>{value}</span>
                </div>
              ))}

              {(selectedOrder.riderName || selectedOrder.riderVehicle) && (
                <>
                  <hr style={{ borderColor: 'var(--admin-border-color)', margin: '4px 0' }} />
                  <span className="admin-item-label" style={{ fontWeight: 800 }}>Delivery Partner</span>
                  {selectedOrder.riderName && (
                    <div className="admin-item-row" style={{ padding: '4px 0' }}>
                      <span className="admin-item-label">Rider Name</span>
                      <span className="admin-item-value" style={{ fontWeight: 700 }}>{selectedOrder.riderName}</span>
                    </div>
                  )}
                  {selectedOrder.riderPhone && (
                    <div className="admin-item-row" style={{ padding: '4px 0' }}>
                      <span className="admin-item-label">Rider Phone</span>
                      <span className="admin-item-value" style={{ fontWeight: 700 }}>{selectedOrder.riderPhone}</span>
                    </div>
                  )}
                  {selectedOrder.riderVehicle && (
                    <div className="admin-item-row" style={{ padding: '4px 0' }}>
                      <span className="admin-item-label">Vehicle</span>
                      <span className="admin-item-value" style={{ fontWeight: 700, textTransform: 'capitalize' }}>{selectedOrder.riderVehicle}</span>
                    </div>
                  )}
                </>
              )}
              {!selectedOrder.riderName && !selectedOrder.riderVehicle && selectedOrder.channelKey === 'grocery' && (
                <span style={{ fontSize: 11, color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>
                  No rider assigned yet.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsumerOrdersTab;
