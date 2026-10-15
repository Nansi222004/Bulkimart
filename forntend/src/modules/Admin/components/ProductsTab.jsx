import React, { useEffect, useState, useCallback } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet } from '../../../utils/adminApi';
import { productView } from '../utils/productView';

/**
 * Catalogue moderation — live from GET /api/admin/products.
 *
 * Not an approval queue. Products go live the moment a seller publishes them,
 * by deliberate decision, so nothing here is waiting on an admin. What an admin
 * does have is the power to take a listing down, and to promote one.
 *
 * The previous version presented every product as two listings side by side, a
 * "Quick Commerce" one and an "E-Commerce" one, each with its own price, stock
 * and Approve button. A product belongs to exactly one storefront — that layout
 * described a data model the backend never had.
 */
const STATUS_TABS = [
  { label: 'Pending review', value: 'pending' },
  { label: 'Live', value: 'approved' },
  { label: 'Taken down', value: 'rejected' },
  { label: 'All', value: 'all' },
];

const CHANNEL_TABS = [
  { label: 'All storefronts', value: '' },
  { label: 'E-Commerce', value: 'ecommerce' },
  { label: 'Quick Commerce', value: 'grocery' },
];

const CHANNEL_LABEL = { ecommerce: 'E-Commerce', grocery: 'Quick Commerce', shg: 'SHG' };

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (!value) return '—';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const ProductsTab = ({ detailPage = false }) => {
  const {
    products,
    productsLoading,
    productsError,
    setProductFilters,
    fetchAdminProducts,
    restoreProduct,
    takeDownProduct,
    toggleProductFeatured,
    toggleProductSponsored,
    removeProduct,
    selectedProduct,
    setSelectedProduct, productRoute, productRevision, openAdminProduct, closeAdminProduct, productFilters,
  } = useAdmin();

  const [search, setSearch] = useState(productFilters?.search || '');
  const [status, setStatus] = useState(productFilters?.status || 'approved');
  const [channel, setChannel] = useState(productFilters?.type || '');
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  useEffect(() => {
    if (!detailPage || !productRoute) return;
    const controller = new AbortController(); let active = true;
    setDetailLoading(true); setDetailError(''); setSelectedProduct(null);
    adminGet('/products/' + encodeURIComponent(productRoute), { signal: controller.signal }).then(body => {
      if (active) setSelectedProduct(productView(body.data));
    }).catch(error => { if (active) setDetailError(error.message || 'Product unavailable. Retry.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [detailPage, productRoute, productRevision, detailRetry]);
  const confirmDeleteProduct = async (product) => {
    if (!product || deletingProductId) return;
    const confirmed = window.confirm(
      `Delete product "${product.name}"? It will be removed from every storefront and cannot be restored from the admin panel. Existing order and financial history will be preserved.`
    );
    if (!confirmed) return;
    setDeletingProductId(product.id);
    const removed = await removeProduct(product.id);
    if (removed && detailPage) closeAdminProduct();
    setDeletingProductId(null);
  };

  const load = useCallback(() => {
    const filters = { status, type: channel, search };
    setProductFilters(filters);
    fetchAdminProducts(filters);
  }, [status, channel, search, fetchAdminProducts, setProductFilters]);

  // Debounced, because the search runs on the server rather than over a local
  // array — one request per keystroke otherwise.
  useEffect(() => {
    if (detailPage) return;
    const id = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  return (
    <>
      {!detailPage && <>
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search products by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="admin-filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_TABS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select className="admin-filter-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNEL_TABS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <button className="admin-btn-sm details inline" onClick={load} disabled={productsLoading}>
          {productsLoading ? 'Loading…' : '⟳ Refresh'}
        </button>
      </div>

      <div className="admin-list-container">
        {productsLoading && products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            Loading catalogue…
          </div>
        ) : productsError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#b91c1c', fontWeight: 700 }}>
            {productsError}
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            No products match this filter.
          </div>
        ) : (
          products.map((p) => (
            <div key={p.id} className="admin-item-card">
              <div className="admin-item-header">
                <h3 className="admin-item-title">{p.name}</h3>
                <span className={`admin-status-pill ${p.status === 'approved' && p.isActive ? 'approved' : p.status === 'rejected' ? 'rejected' : 'under-review'}`}>
                  {p.status === 'approved' ? (p.isActive ? 'Live' : 'Hidden') : p.status === 'rejected' ? 'Taken down' : p.status}
                </span>
              </div>

              <div className="admin-item-body">
                <div className="admin-item-row">
                  <span className="admin-item-label">Seller</span>
                  <span className="admin-item-value" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{p.sellerName}</span>
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Storefront</span>
                  <span className="admin-item-value">{p.fulfillmentType === 'digital' ? 'E-book · ' : ''}{CHANNEL_LABEL[p.channel] || p.channel}</span>
                </div>
                {p.fulfillmentType === 'digital' && <>
                  <div className="admin-item-row"><span className="admin-item-label">Author</span><span className="admin-item-value">{p.digital?.author || '—'}</span></div>
                  <div className="admin-item-row"><span className="admin-item-label">Language / file</span><span className="admin-item-value">{p.digital?.language || '—'} · {p.digital?.format?.toUpperCase() || 'PDF'} ({p.digital?.fileStatus || 'missing'})</span></div>
                </>}
                <div className="admin-item-row">
                  <span className="admin-item-label">Category</span>
                  <span className="admin-item-value">{p.category}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Price</span>
                  <span className="admin-item-value">
                    {money(p.price)}
                    {/* Only worth showing when there is an actual saving. */}
                    {p.mrp > p.price && (
                      <span style={{ color: '#94a3b8', textDecoration: 'line-through', marginLeft: 6 }}>
                        {money(p.mrp)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">{p.fulfillmentType === 'digital' ? 'Physical stock' : 'Stock'}</span>
                  <span
                    className="admin-item-value"
                    style={p.fulfillmentType !== 'digital' && p.stock === 0 ? { color: '#b91c1c', fontWeight: 800 } : undefined}
                  >
                    {p.fulfillmentType === 'digital' ? 'Not applicable' : p.stock === 0 ? 'Out of stock' : `${p.stock} ${p.unit || 'units'}`}
                  </span>
                </div>
                {(p.isFeatured || p.isSponsored) && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Promotion</span>
                    <span className="admin-item-value" style={{ fontWeight: 800, color: '#7c3aed' }}>
                      {[p.isFeatured && 'Featured', p.isSponsored && `Sponsored #${p.sponsoredRank || 0}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                {p.status === 'rejected' && p.rejectionReason && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Reason</span>
                    <span className="admin-item-value" style={{ color: '#b91c1c' }}>{p.rejectionReason}</span>
                  </div>
                )}
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" onClick={() => openAdminProduct(p.id)}>
                  Details
                </button>
                <button
                  className="admin-btn-sm details"
                  style={{ background: '#fff', borderColor: '#fecaca', color: '#b91c1c' }}
                  onClick={() => confirmDeleteProduct(p)}
                  disabled={deletingProductId === p.id}
                >
                  {deletingProductId === p.id ? 'Deleting…' : 'Delete'}
                </button>
                {p.fulfillmentType !== 'digital' && p.status === 'approved' && p.isActive && (
                  <button
                    className="admin-btn-sm details"
                    onClick={() => toggleProductFeatured(p.id, !p.isFeatured)}
                    title="Show or remove this live product from featured storefront sections"
                  >
                    {p.isFeatured ? 'Unfeature' : 'Feature'}
                  </button>
                )}
                {p.status === 'rejected' || p.status === 'pending' ? (
                  <button
                    className="admin-btn-sm details"
                    style={{ background: '#dcfce7', color: '#166534' }}
                    onClick={() => restoreProduct(p.id)}
                  >
                    {p.status === 'pending' ? 'Approve' : 'Restore'}
                  </button>
                ) : (
                  <button
                    className="admin-btn-sm details"
                    style={{ background: '#fee2e2', color: '#b91c1c' }}
                    onClick={() => takeDownProduct(p.id)}
                  >
                    Take down
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      </>}
      {detailPage && <div className="admin-product-detail-page">
        <button type="button" className="admin-btn-sm details" onClick={closeAdminProduct}>← Back to Products</button>
        {detailLoading && <p role="status">Loading latest product…</p>}
        {detailError && <div role="alert">{detailError}<button type="button" onClick={() => setDetailRetry(value => value + 1)}>Retry product details</button></div>}
      </div>}
      {detailPage && selectedProduct && (
        <section className="admin-product-detail-page" aria-label="Product details">
          <div>
            <div className="admin-modal-header">
              <div>
                <h1 className="admin-modal-title">{selectedProduct.name}</h1>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
                  {selectedProduct.sellerName} • {CHANNEL_LABEL[selectedProduct.channel] || selectedProduct.channel}
                </span>
              </div>

            </div>

            <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedProduct.image && (
                <img
                  src={selectedProduct.image}
                  alt={selectedProduct.name}
                  style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 10, backgroundColor: '#f8fafc' }}
                />
              )}

              <div className="admin-item-row">
                <span className="admin-item-label">Seller</span>
                <span className="admin-item-value">{selectedProduct.sellerName}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Listing type</span>
                <span className="admin-item-value">
                  {selectedProduct.fulfillmentType === 'digital' ? 'E-book' : 'Physical product'} · {CHANNEL_LABEL[selectedProduct.channel] || selectedProduct.channel}
                </span>
              </div>
              {selectedProduct.fulfillmentType === 'digital' && <>
                <div className="admin-item-row">
                  <span className="admin-item-label">Author</span>
                  <span className="admin-item-value">{selectedProduct.digital?.author || '—'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Language</span>
                  <span className="admin-item-value">{selectedProduct.digital?.language || '—'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Digital file</span>
                  <span className="admin-item-value">
                    {selectedProduct.digital?.format?.toUpperCase() || 'PDF'} · {selectedProduct.digital?.fileStatus || 'missing'} · {fileSize(selectedProduct.digital?.fileSizeBytes)}
                  </span>
                </div>
              </>}
              <div className="admin-item-row">
                <span className="admin-item-label">Price / MRP</span>
                <span className="admin-item-value">
                  {money(selectedProduct.price)} / {money(selectedProduct.mrp)}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Stock</span>
                <span className="admin-item-value">
                  {selectedProduct.fulfillmentType === 'digital' ? 'Not applicable' : `${selectedProduct.stock} ${selectedProduct.unit || 'units'}`}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Category</span>
                <span className="admin-item-value">{selectedProduct.category}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Listed</span>
                <span className="admin-item-value">
                  {selectedProduct.createdAt
                    ? new Date(selectedProduct.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : '—'}
                </span>
              </div>
              <p>Status: {selectedProduct.status} · {selectedProduct.isActive ? 'Active' : 'Inactive'}</p>
              <p>SKU: {selectedProduct.raw?.sku || 'Not recorded'} · Updated: {selectedProduct.raw?.updatedAt ? new Date(selectedProduct.raw.updatedAt).toLocaleString() : 'Not recorded'}</p>
              {(selectedProduct.raw?.variants || []).map(variant => <article key={variant._id || variant.sku}><strong>{variant.name || variant.sku}</strong><p>SKU: {variant.sku} · Stock: {variant.stock} · Price: {money(variant.price)}</p></article>)}
              {selectedProduct.desc && (
                <div>
                  <div className="admin-item-label" style={{ marginBottom: 4 }}>Description</div>
                  <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                    {selectedProduct.desc}
                  </p>
                </div>
              )}
            </div>

            <div className="admin-product-modal-actions">
              <button
                className="admin-btn-sm details"
                style={{ background: '#fff', borderColor: '#fecaca', color: '#b91c1c' }}
                onClick={() => confirmDeleteProduct(selectedProduct)}
                disabled={deletingProductId === selectedProduct.id}
              >
                {deletingProductId === selectedProduct.id ? 'Deleting…' : 'Delete product'}
              </button>
              {selectedProduct.fulfillmentType !== 'digital' && selectedProduct.status === 'approved' && selectedProduct.isActive && (
                <button
                  className="admin-btn-sm details"
                  onClick={() => toggleProductSponsored(selectedProduct.id, !selectedProduct.isSponsored, selectedProduct.isSponsored ? 0 : 1)}
                >
                  {selectedProduct.isSponsored ? 'Remove sponsorship' : 'Sponsor this listing'}
                </button>
              )}
              {selectedProduct.status === 'rejected' || selectedProduct.status === 'pending' ? (
                <button
                  className="admin-btn-sm details admin-product-primary-action"
                  style={{ background: '#dcfce7', color: '#166534', flex: 1 }}
                  onClick={() => restoreProduct(selectedProduct.id)}
                >
                  {selectedProduct.status === 'pending' ? 'Approve listing' : 'Put back on the storefront'}
                </button>
              ) : (
                <button
                  className="admin-btn-sm details admin-product-primary-action"
                  style={{ background: '#fee2e2', color: '#b91c1c', flex: 1 }}
                  onClick={() => takeDownProduct(selectedProduct.id)}
                >
                  Take down
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
};

export default ProductsTab;
