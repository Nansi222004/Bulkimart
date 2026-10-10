import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const money = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

/**
 * The SHG product approval queue.
 *
 * Approving sets `status: approved` AND `isActive: true` server-side — both
 * are required, because every public query filters on the pair. That is why
 * this screen calls the endpoint rather than flipping a flag locally: the
 * previous version updated React state only, so a listing an admin "approved"
 * never actually became visible to a shopper.
 */
export const SHGProductApprovalTab = () => {
  const {
    shgProducts, shgProductsLoading, shgProductsError,
    fetchShgProducts, approveShgProduct, rejectShgProduct,
  } = useAdmin();

  const [filterStatus, setFilterStatus] = useState('pending');
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => { fetchShgProducts({ status: filterStatus }); }, [fetchShgProducts, filterStatus]);

  const act = async (fn, id) => {
    await fn(id);
    setSelectedProduct(null);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>SHG Product Listing Approval Queue</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
            Audit product quality, craft authenticity and pricing before marketplace publication.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilterStatus(t.key)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                border: filterStatus === t.key ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                backgroundColor: filterStatus === t.key ? '#ebfdf2' : '#ffffff',
                color: filterStatus === t.key ? '#047857' : '#475569',
                fontWeight: filterStatus === t.key ? 800 : 600,
              }}
            >
              {/*
                The count is of the list actually loaded, so it is only shown
                on the tab that produced it — labelling the other two with this
                one's number would be a plain lie about their contents.
              */}
              {t.label}{filterStatus === t.key && !shgProductsLoading ? ` (${shgProducts.length})` : ''}
            </button>
          ))}
        </div>
      </div>

      {shgProductsError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {shgProductsError}
        </div>
      )}

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                {['Item Title', 'SHG Maker', 'Craft Category', 'Price', 'Stock', 'Listed', 'Actions'].map((c) => (
                  <th key={c} style={{ padding: '12px 16px', textAlign: c === 'Actions' ? 'right' : 'left' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shgProductsLoading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>Loading listings…</td></tr>
              ) : shgProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
                    No products in the {filterStatus} queue.
                  </td>
                </tr>
              ) : (
                shgProducts.map((prd) => (
                  <tr key={prd.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {prd.image && (
                          <img src={prd.image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                        )}
                        <span style={{ fontWeight: 800, color: '#0f172a' }}>{prd.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 700 }}>{prd.shgName}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>{prd.category}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 800 }}>{money(prd.price)}</td>
                    <td style={{ padding: '12px 16px' }}>{prd.stock === null ? '—' : `${prd.stock} ${prd.unit || 'pcs'}`}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>
                      {prd.createdAt ? new Date(prd.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedProduct(prd)}
                        style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: '#0f172a', color: '#ffffff', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Audit &amp; Review
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PRODUCT AUDIT MODAL */}
      {selectedProduct && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet">
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Product Listing Review</h3>
              <button className="admin-modal-close" onClick={() => setSelectedProduct(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedProduct.image && (
                <img
                  src={selectedProduct.image}
                  alt={selectedProduct.name}
                  style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }}
                />
              )}
              <div className="admin-item-row">
                <span className="admin-item-label">Product Name</span>
                <span className="admin-item-value" style={{ fontWeight: 800, color: '#10b981' }}>{selectedProduct.name}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">SHG Maker Group</span>
                <span className="admin-item-value">{selectedProduct.shgName}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Craft Category</span>
                <span className="admin-item-value">{selectedProduct.category}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Listing Price / MRP</span>
                <span className="admin-item-value" style={{ fontWeight: 800 }}>
                  {money(selectedProduct.price)}{selectedProduct.mrp ? ` / ${money(selectedProduct.mrp)}` : ''}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Inventory Stock</span>
                <span className="admin-item-value">
                  {selectedProduct.stock === null ? '—' : `${selectedProduct.stock} ${selectedProduct.unit || 'units'}`}
                </span>
              </div>
              {selectedProduct.description && (
                <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{selectedProduct.description}</div>
              )}
              {selectedProduct.status === 'rejected' && selectedProduct.rejectionReason && (
                <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', fontSize: 11.5, color: '#b91c1c' }}>
                  <strong>Rejected:</strong> {selectedProduct.rejectionReason}
                </div>
              )}

              <div className="admin-item-actions" style={{ marginTop: 16 }}>
                {selectedProduct.status !== 'approved' && (
                  <button className="admin-btn-sm approve" onClick={() => act(approveShgProduct, selectedProduct.id)}>
                    ✓ Approve Listing
                  </button>
                )}
                {selectedProduct.status !== 'rejected' && (
                  <button className="admin-btn-sm reject" onClick={() => act(rejectShgProduct, selectedProduct.id)}>
                    ✕ Reject Product
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SHGProductApprovalTab;
