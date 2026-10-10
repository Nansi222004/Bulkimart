import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const STATUS_STYLE = {
  approved: { label: 'Approved', color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' },
  pending: { label: 'Pending', color: '#b45309', background: '#fffbeb', border: '#fde68a' },
  rejected: { label: 'Rejected', color: '#b91c1c', background: '#fef2f2', border: '#fecaca' },
};

const StatusPill = ({ value }) => {
  const s = STATUS_STYLE[value] || STATUS_STYLE.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase',
      color: s.color, backgroundColor: s.background, border: `1.5px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
};

const money = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

/**
 * The SHG catalogue — every handmade listing, whatever its approval state.
 *
 * There is no "add product" action here by design: a listing is created by
 * the cooperative that makes the item, and an admin-authored one would have
 * no SHG behind it to fulfil or be paid for it. This screen reviews what the
 * groups have listed.
 */
export const SHGProductsTab = () => {
  const {
    shgProducts, shgProductsLoading, shgProductsError,
    fetchShgProducts, approveShgProduct, rejectShgProduct,
  } = useAdmin();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    const t = setTimeout(() => fetchShgProducts({ status, search }), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchShgProducts, status, search]);

  const exportCsv = () => {
    const header = ['Product', 'SHG Vendor', 'District', 'Category', 'Price', 'MRP', 'Stock', 'Status'];
    const rows = shgProducts.map((p) => [
      p.name, p.shgName, p.district, p.category,
      p.price ?? '', p.mrp ?? '', p.stock ?? '', p.status,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shg-products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>SHG Handmade Products Catalog</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {shgProducts.length} Product{shgProducts.length === 1 ? '' : 's'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Products handcrafted by village women self-help groups. Approve a listing to publish it to the marketplace.
          </p>
        </div>

        <button
          className="sa-btn-primary"
          style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
          onClick={exportCsv}
          disabled={shgProducts.length === 0}
        >
          Export CSV
        </button>
      </div>

      {shgProductsError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {shgProductsError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)', flexWrap: 'wrap' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, minWidth: 220, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Filter by product name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="sa-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending Approval</option>
          <option value="approved">Approved / Live</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
                {['Item Name', 'SHG Vendor', 'Craft Category', 'Price', 'Stock', 'Status', 'Actions'].map((c) => (
                  <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shgProductsLoading ? (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading SHG products…</td></tr>
              ) : shgProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>
                    {search || status !== 'all'
                      ? 'No SHG products match these filters.'
                      : 'No SHG products listed yet — a cooperative adds these from their own storefront.'}
                  </td>
                </tr>
              ) : (
                shgProducts.map((p, idx) => (
                  <tr key={p.id} style={{ borderBottom: idx === shgProducts.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.image && (
                          <img src={p.image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--sa-border)' }} />
                        )}
                        <span style={{ fontWeight: 800, color: 'var(--sa-text-primary)' }}>{p.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                      {p.shgName}
                      {p.district && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--sa-text-muted)' }}>{p.district}</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{p.category}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sa-text-secondary)' }}>
                      {money(p.price)}
                      {p.unit && <span style={{ fontSize: 10.5, color: 'var(--sa-text-muted)' }}> / {p.unit}</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: p.stock === 0 ? '#b91c1c' : 'var(--sa-text-secondary)', fontWeight: 700 }}>
                      {p.stock === null ? '—' : p.stock}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <StatusPill value={p.status} />
                      {p.status === 'rejected' && p.rejectionReason && (
                        <div style={{ fontSize: 10, color: 'var(--sa-text-muted)', marginTop: 3, maxWidth: 180 }}>{p.rejectionReason}</div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {/* Each action appears only where it changes something. */}
                        {p.status !== 'approved' && (
                          <button className="admin-btn-sm approve" onClick={() => approveShgProduct(p.id)}>Approve</button>
                        )}
                        {p.status !== 'rejected' && (
                          <button className="admin-btn-sm reject" onClick={() => rejectShgProduct(p.id)}>Reject</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default SHGProductsTab;
