import React, { useState } from 'react';
import { useSHG } from '../context/SHGContext';
import { ProductModal } from '../../Seller/components/ProductModal';
import { BulkUploadModal } from '../../Seller/components/BulkUploadModal';

const SHGProductsTab = () => {
  const {
    products,
    searchQuery,
    setSearchQuery,
    activeProductTab,
    setActiveProductTab,
    setShowAddProductModal,
    activeActionsMenuId,
    setActiveActionsMenuId,
    startEditProduct,
    setEditingProductId,
    handleUpdateStock,
    handleToggleProductStatus,
    handleDeleteProduct,
    fetchSHGData,
    triggerToast,
  } = useSHG();

  const [showBulkModal, setShowBulkModal] = useState(false);

  const categoryName = (product) =>
    typeof product.category === 'object' ? (product.category?.name || '') : (product.category || '');

  // Filter products by tab & search query
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          categoryName(product).toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (activeProductTab === 'All') return true;
    if (activeProductTab === 'Active') return product.status === 'Active';
    if (activeProductTab === 'Pending') return product.status === 'Pending Approval';
    if (activeProductTab === 'Rejected') return product.status === 'Rejected';
    return true;
  });

  return (
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Action / Search Row */}
      <div className="shg-action-row">
        <div className="shg-search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            className="shg-search-input"
            placeholder="Search SHG products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowBulkModal(true)}
            style={{
              border: '1.5px solid #cbd5e1',
              backgroundColor: '#fff',
              color: '#0f172a',
              padding: '10px 18px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s'
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 12 15 15" />
            </svg>
            Bulk Upload
          </button>

          <button className="shg-add-btn" onClick={() => { setEditingProductId(null); setShowAddProductModal(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Product
          </button>
        </div>
      </div>

      {/* Tabs Filter Row */}
      <div className="shg-tab-row">
        {['All', 'Active', 'Pending', 'Rejected'].map(tab => (
          <button
            key={tab}
            className={`shg-filter-tab ${activeProductTab === tab ? 'active' : ''}`}
            onClick={() => setActiveProductTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Products list container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 32px' }}>
        <div className="shg-card">
          {filteredProducts.length === 0 ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">📦</div>
              <p className="shg-empty-text">No products found matching your selection.</p>
            </div>
          ) : (
            filteredProducts.map(product => {
              return (
              <div key={product._id || product.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                <div className="shg-product-row">
                  <img src={product.img || product.images?.[0]} alt={product.name} className="shg-product-img" />

                  <div className="shg-product-info">
                    <div className="shg-product-name">{product.name}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="shg-product-cat">{categoryName(product)}</span>
                      {product.isHandmade && <span className="shg-status-badge handmade" style={{ padding: '1px 6px', fontSize: 9 }}>Handmade</span>}
                      {product.type === 'grocery' && <span className="shg-status-badge active" style={{ padding: '1px 6px', fontSize: 9 }}>Quick Commerce</span>}
                      {product.type === 'ecommerce' && <span className="shg-status-badge active" style={{ padding: '1px 6px', fontSize: 9 }}>Ecommerce</span>}
                      {product.type === 'shg' && <span className="shg-status-badge active" style={{ padding: '1px 6px', fontSize: 9 }}>SHG Store</span>}
                      {(product.channels || []).some((c) => c.type === 'ecommerce') && product.type !== 'ecommerce' && (
                        <span className="shg-status-badge active" style={{ padding: '1px 6px', fontSize: 9 }}>+ Ecommerce</span>
                      )}
                      {(product.channels || []).some((c) => c.type === 'grocery') && product.type !== 'grocery' && (
                        <span className="shg-status-badge active" style={{ padding: '1px 6px', fontSize: 9 }}>+ Quick Commerce</span>
                      )}
                    </div>
                  </div>

                  <div className="shg-product-price">₹{product.price}</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => handleUpdateStock(product._id, -1)}
                      className="shg-header-btn"
                      style={{ padding: 4, background: '#f1f5f9' }}
                      aria-label="Decrease stock"
                    >
                      -
                    </button>
                    <span className={`shg-product-stock ${product.stock <= 5 ? 'low' : ''}`}>
                      {product.stock}
                    </span>
                    <button
                      onClick={() => handleUpdateStock(product._id, 1)}
                      className="shg-header-btn"
                      style={{ padding: 4, background: '#f1f5f9' }}
                      aria-label="Increase stock"
                    >
                      +
                    </button>
                  </div>

                  <span className={`shg-status-badge ${
                    product.status === 'Active' ? 'active' :
                    product.status === 'Pending Approval' ? 'pending' : 'rejected'
                  }`}>
                    {product.status === 'Pending Approval' ? 'In Review' : product.status}
                  </span>



                  {/* Actions Menu */}
                  <div className="shg-actions-menu-wrap">
                    <button
                      className="shg-action-dots-btn"
                      onClick={() => setActiveActionsMenuId(activeActionsMenuId === product._id ? null : product._id)}
                      aria-label="Open Actions menu"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                    </button>

                    {activeActionsMenuId === product._id && (
                      <div className="shg-actions-dropdown">
                        <button
                          className="shg-dropdown-item"
                          onClick={() => {
                            setActiveActionsMenuId(null);
                            startEditProduct(product.raw);
                          }}
                        >
                          Manage Listing
                        </button>
                        <button
                          className="shg-dropdown-item"
                          onClick={() => handleToggleProductStatus(product._id, product.status === 'Active' ? 'Inactive' : 'Active')}
                        >
                          {product.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="shg-dropdown-item danger"
                          onClick={() => handleDeleteProduct(product._id)}
                        >
                          Remove Listing
                        </button>
                      </div>
                    )}
                  </div>
                </div>

              </div>
              );
            })
          )}
        </div>
      </div>

      {/*
        Same tabbed panel the Seller module mounts, in SHG mode: same
        category tree fetch, image handling and submit wiring — no second
        copy to drift out of sync — but with the Storefront Target selector,
        the automatic "handmade" flag, and the SHG-only category tree that
        `isShgUser` switches on.
      */}
      <ProductModal isShgUser />

      {showBulkModal && (
        <BulkUploadModal
          mode="shg"
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            if (fetchSHGData) fetchSHGData();
            if (triggerToast) triggerToast('Bulk product import complete!');
          }}
        />
      )}
    </div>
  );
};

export default SHGProductsTab;
