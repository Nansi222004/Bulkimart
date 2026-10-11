import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { ProductModal } from './ProductModal';
import { BulkUploadModal } from './BulkUploadModal';

export const ProductsTab = () => {
  const {
    products,
    activeProductTab,
    setActiveProductTab,
    setShowAddProductModal,
    activeMode,
    setActiveMode,
    selectedTypes,
    handleDeleteProduct,
    triggerToast,
    setEditingProductId,
    startEditProduct,
    fetchMyProducts,
    sellerProfile,
  } = useSeller();

  const [showBulkModal, setShowBulkModal] = useState(false);
  const wholesaleAuthorized = sellerProfile?.status === 'approved'
    && sellerProfile?.wholesaleChannel?.status === 'approved'
    && sellerProfile?.salesChannels?.includes('wholesale');
  const wholesaleOfferCount = products.reduce((count, product) => count + (product.raw?.variants || []).filter((variant) => variant.wholesalePricing?.enabled).length, 0);

  // Local filter states
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');

  // Helper to generate dynamic lower-case SKU (e.g. xyzz-01-rw8b)
  const getProductCode = (p) => {
    const cleanName = p.name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const prefix = cleanName.substring(0, 4).padEnd(4, 'x');
    const idNum = p.id.replace(/\D/g, '') || '01';
    return `${prefix}-01-rw${idNum.padStart(2, '0')}`;
  };

  // Helper to generate dynamic header, category, and subcategory based on product category
  const getProductDetails = (p) => {
    const cat = p.category;
    let header = cat.toUpperCase();
    let categoryName = cat;
    let subcategory = 'General';

    if (cat === 'Groceries') {
      header = 'GROCERIES';
      categoryName = 'Organic Foods';
      subcategory = p.name.toLowerCase().includes('pickle') ? 'Pickles' :
        p.name.toLowerCase().includes('honey') ? 'Honey & Sweeteners' :
          p.name.toLowerCase().includes('rice') ? 'Grains & Rice' : 'Spices';
    } else if (cat === 'Fashion') {
      header = 'FASHION';
      categoryName = 'Garments';
      subcategory = 'Sarees & Handlooms';
    } else if (cat === 'Crafts') {
      header = 'CRAFTS';
      categoryName = 'Handicrafts';
      subcategory = p.name.toLowerCase().includes('jar') ? 'Clay Utensils' : 'Bamboo Crafts';
    } else if (cat === 'Cosmetics') {
      header = 'COSMETICS';
      categoryName = 'Herbal Care';
      subcategory = p.name.toLowerCase().includes('soap') ? 'Soaps' : 'Gels & Creams';
    }

    return { header, categoryName, subcategory };
  };

  // KPI Calculations
  const allItemsCount = products.length;
  const activeCount = products.filter(p => p.status === 'Active').length;
  const physicalProducts = products.filter(p => p.raw?.fulfillmentType !== 'digital');
  const lowStockCount = physicalProducts.filter(p => p.stock > 0 && p.stock <= 10).length;
  const outStockCount = physicalProducts.filter(p => p.stock === 0).length;

  // Filter products by searchable columns and local tab filters
  const filteredProducts = products.filter(p => {
    const code = getProductCode(p);
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      code.includes(search.toLowerCase());

    // Category filter
    const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;

    // KPI Card filter (activeProductTab)
    let matchesTab = true;
    if (activeProductTab === 'Active') {
      matchesTab = p.status === 'Active';
    } else if (activeProductTab === 'Low Stock') {
      matchesTab = p.raw?.fulfillmentType !== 'digital' && p.stock > 0 && p.stock <= 10;
    } else if (activeProductTab === 'Out of Stock') {
      matchesTab = p.raw?.fulfillmentType !== 'digital' && p.stock === 0;
    }

    return matchesSearch && matchesCategory && matchesTab;
  });

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'PriceLowHigh') return a.price - b.price;
    if (sortBy === 'PriceHighLow') return b.price - a.price;
    if (sortBy === 'Oldest') {
      const idxA = products.indexOf(a);
      const idxB = products.indexOf(b);
      return idxB - idxA;
    }
    // Newest first (default)
    const idxA = products.indexOf(a);
    const idxB = products.indexOf(b);
    return idxA - idxB;
  });

  return (
    <div style={{ backgroundColor: '#f8fafc', minHeight: '100%', padding: '0 16px 40px 16px', boxSizing: 'border-box' }}>
      {/* Styles for animation, active borders, and cards */}
      <style dangerouslySetInnerHTML={{
        __html: `
        .prod-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          padding: 14px 0;
        }
        @media (min-width: 768px) {
          .prod-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            padding: 20px 0;
          }
        }
        .prod-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          text-align: left;
          transition: all 0.2s ease;
          min-width: 0;
        }
        .prod-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .prod-kpi-card.active {
          border-color: var(--primary);
          box-shadow: 0 0 0 1px var(--primary), 0 4px 6px -1px rgba(0,0,0,0.05);
        }
        .prod-kpi-icon-box {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .prod-kpi-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .prod-kpi-val {
          font-size: 16px;
          font-weight: 900;
          color: #0f172a;
          font-family: 'Outfit', sans-serif;
        }
        .prod-table-row {
          border-bottom: 1.5px solid #f1f5f9;
          transition: background-color 0.15s ease;
        }
        .prod-table-row:hover {
          background-color: #f8fafc;
        }
        .prod-th {
          padding: 14px 16px;
          border-bottom: 2.5px solid #f1f5f9;
          color: #475569;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          text-align: left;
        }
        .prod-td {
          padding: 16px;
          vertical-align: middle;
          border-bottom: 1px solid #f1f5f9;
        }
        .action-icon-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #64748b;
          padding: 6px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          transition: all 0.2s ease;
        }
        .action-icon-btn:hover {
          background-color: #f1f5f9;
          color: #0f172a;
        }
        .action-icon-btn.delete:hover {
          background-color: #fee2e2;
          color: #dc2626;
        }

        /* Mobile card list — visible by default (mobile-first, matches the
           rest of this codebase's convention); the existing 8-column table
           below only appears once there's room for it, at 768px+. Neither
           block changes the OTHER's markup/styles — this is a pure
           show/hide split, so the desktop table is pixel-identical to
           before this pass. */
        .prod-table-desktop {
          display: none;
        }
        .prod-cards-mobile {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (min-width: 768px) {
          .prod-table-desktop {
            display: block;
          }
          .prod-cards-mobile {
            display: none;
          }
        }
        .prod-card-mobile {
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          padding: 12px;
        }
        .prod-card-mobile-top {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .prod-card-mobile-thumb {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          background-color: #f8fafc;
          border: 1.5px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }
        .prod-card-mobile-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .prod-card-mobile-name {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }
        .prod-card-mobile-meta {
          font-size: 11.5px;
          color: #475569;
          font-weight: 600;
        }
        .prod-card-mobile-code {
          font-size: 11px;
          color: #94a3b8;
          font-family: monospace;
        }
        .prod-card-mobile-status {
          flex-shrink: 0;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
        .prod-card-mobile-actions {
          display: flex;
          justify-content: flex-end;
          gap: 4px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #f1f5f9;
        }
      `}} />

      {/* 1. TITLE & PRIMARY BUTTONS SECTION */}
      <div style={{ padding: '24px 0 0 0', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
              Product List
            </h1>
            <span style={{
              marginLeft: 12,
              backgroundColor: '#ebfdf2',
              color: '#166534',
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              Live
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#475569', fontWeight: 500 }}>
            Track your items, prices, and how many are left in stock.
          </p>
        </div>

        {/* Action Buttons */}
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

          <button
            // Clear any edit in progress, or Add would quietly overwrite the
            // last product that was opened for editing.
            onClick={() => { setEditingProductId(null); setShowAddProductModal(true); }}
            style={{
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background-color 0.2s'
            }}
          >
            <span style={{ fontSize: 14 }}>+</span> Add New Product
          </button>
        </div>
      </div>

      {wholesaleAuthorized && (
        <section aria-label="Wholesale product management" style={{ margin: '0 0 16px', padding: '14px 16px', border: '1px solid #bae6fd', borderRadius: 12, background: '#f0fbff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ display: 'block', color: '#073b78', fontSize: 14 }}>Wholesale catalog settings</strong>
            <span style={{ color: '#64748b', fontSize: 12 }}>Configure variant MOQ and quantity tiers from a product’s Edit → Item Variants panel. Shared inventory and retail pricing stay unchanged.</span>
          </div>
          <span style={{ color: '#078ccb', fontSize: 12, fontWeight: 800 }}>{wholesaleOfferCount} enabled variant offer{wholesaleOfferCount === 1 ? '' : 's'}</span>
        </section>
      )}

      {/* 2. SELECTABLE KPI CARDS AS TABS */}
      <div className="prod-kpi-grid">
        {/* Card 1: All Items */}
        <div
          className={`prod-kpi-card ${activeProductTab === 'All' ? 'active' : ''}`}
          onClick={() => setActiveProductTab('All')}
        >
          <div className="prod-kpi-icon-box" style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="prod-kpi-label">
              All Items
            </span>
            <span className="prod-kpi-val">
              {allItemsCount}
            </span>
          </div>
        </div>

        {/* Card 2: Active Items */}
        <div
          className={`prod-kpi-card ${activeProductTab === 'Active' ? 'active' : ''}`}
          onClick={() => setActiveProductTab('Active')}
        >
          <div className="prod-kpi-icon-box" style={{ backgroundColor: '#ebfdf2', color: '#166534' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="prod-kpi-label">
              Active Items
            </span>
            <span className="prod-kpi-val">
              {activeCount}
            </span>
          </div>
        </div>

        {/* Card 3: Low Stock */}
        <div
          className={`prod-kpi-card ${activeProductTab === 'Low Stock' ? 'active' : ''}`}
          onClick={() => setActiveProductTab('Low Stock')}
        >
          <div className="prod-kpi-icon-box" style={{ backgroundColor: '#ffedd5', color: '#ea580c' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="prod-kpi-label">
              Low Stock
            </span>
            <span className="prod-kpi-val">
              {lowStockCount}
            </span>
          </div>
        </div>

        {/* Card 4: Out of Stock */}
        <div
          className={`prod-kpi-card ${activeProductTab === 'Out of Stock' ? 'active' : ''}`}
          onClick={() => setActiveProductTab('Out of Stock')}
        >
          <div className="prod-kpi-icon-box" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
              <path d="M23 3H1v5h22V3z" />
              <line x1="10" y1="12" x2="14" y2="16" />
              <line x1="14" y1="12" x2="10" y2="16" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="prod-kpi-label">
              Out of Stock
            </span>
            <span className="prod-kpi-val">
              {outStockCount}
            </span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Toggle (Moved from Header for Products Tab) */}
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

      {/* 3. SECONDARY FILTERS BAR CARD */}
      <div style={{
        margin: '8px 0 20px 0',
        backgroundColor: '#fff',
        border: '1.5px solid #f1f5f9',
        borderRadius: 20,
        padding: '16px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
      }}>
        {/* Search input (Left) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backgroundColor: '#f8fafc',
          border: '1.5px solid #e2e8f0',
          borderRadius: 100,
          padding: '10px 16px',
          flex: '1',
          minWidth: '240px',
          maxWidth: '340px'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, SKU or slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: 'none',
              background: 'none',
              outline: 'none',
              fontSize: 13,
              fontWeight: '600',
              color: '#0f172a',
              width: '100%'
            }}
          />
        </div>

        {/* Filters Group (Right) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {/* Categories select dropdown */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1.5px solid #e2e8f0',
              backgroundColor: '#fff',
              fontSize: 12,
              fontWeight: '700',
              color: '#475569',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="All">All Categories</option>
            <option value="Groceries">Organic Foods</option>
            <option value="Fashion">Garments & Handlooms</option>
            <option value="Crafts">Traditional Handicrafts</option>
            <option value="Cosmetics">Herbal Personal Care</option>
          </select>

          {/* Reset Filters / Filters indicator */}
          <button
            onClick={() => {
              setSearch('');
              setCategoryFilter('All');
              setSortBy('Newest');
              setActiveProductTab('All');
              triggerToast('Filters cleared!');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 12,
              border: '1.5px solid #e2e8f0',
              backgroundColor: '#fff',
              fontSize: 12,
              fontWeight: '700',
              color: '#475569',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#fff'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>

          {/* Sort Selection dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1.5px solid #e2e8f0',
              backgroundColor: '#fff',
              fontSize: 12,
              fontWeight: '700',
              color: '#475569',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="Newest">Newest first</option>
            <option value="Oldest">Oldest first</option>
            <option value="PriceLowHigh">Price: Low to High</option>
            <option value="PriceHighLow">Price: High to Low</option>
          </select>
        </div>
      </div>

      {/* 4. PRODUCTS DATA LIST TABLE CARD */}
      <div style={{
        margin: '0 0 24px 0',
        backgroundColor: '#fff',
        border: '1.5px solid #f1f5f9',
        borderRadius: 20,
        padding: '24px 24px 16px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        {sortedProducts.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
              {products.length === 0 ? 'You have not added any products yet' : 'No products match these filters'}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              {products.length === 0
                ? 'Add your first product — it goes live for customers straight away.'
                : 'Try changing the search or status filter.'}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile — a stacked card per product; the 8-column table below is
                unusable under 768px even scrolled, so it's hidden there entirely
                rather than shrunk. Same data, same actions, vertical instead of
                an 8-column row. Hidden at 768px+ via .prod-cards-mobile (Seller.css). */}
            <div className="prod-cards-mobile">
              {sortedProducts.map((p) => {
                const { categoryName, subcategory } = getProductDetails(p);
                const isEbook = p.raw?.fulfillmentType === 'digital';
                const ebookFileStatus = p.raw?.digital?.file?.status === 'uploaded' ? 'PDF uploaded' : 'PDF missing';
                const statusStyle = p.status === 'Active'
                  ? { backgroundColor: '#ebfdf2', color: '#166534' }
                  : p.status === 'Rejected'
                    ? { backgroundColor: '#fee2e2', color: '#dc2626' }
                    : { backgroundColor: '#fff7ed', color: '#ea580c' };
                const statusLabel = p.status === 'Active' ? 'Approved' : p.status === 'Rejected' ? 'Rejected' : 'Pending';

                return (
                  <div key={p.id} className="prod-card-mobile">
                    <div className="prod-card-mobile-top">
                      <div className="prod-card-mobile-thumb">
                        {p.img ? (
                          <img src={p.img} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                            <line x1="12" y1="22.08" x2="12" y2="12" />
                          </svg>
                        )}
                      </div>
                      <div className="prod-card-mobile-info">
                        <span className="prod-card-mobile-name">{p.name}</span>
                        <span className="prod-card-mobile-meta">{isEbook ? `E-book · ${p.raw?.digital?.format?.toUpperCase() || 'PDF'} · ${ebookFileStatus}` : `${categoryName} · ${subcategory}`}</span>
                        <span className="prod-card-mobile-code">{getProductCode(p)}</span>
                      </div>
                      <span className="prod-card-mobile-status" style={statusStyle}>{statusLabel}</span>
                    </div>
                    <div className="prod-card-mobile-actions">
                      <button className="action-icon-btn" title="Edit Product" onClick={() => startEditProduct(p.raw)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        Edit
                      </button>
                      <button className="action-icon-btn delete" title="Delete Product" onClick={() => handleDeleteProduct(p.id)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop — untouched, existing 8-column table. Hidden below 768px
                via .prod-table-desktop (Seller.css) instead of the mobile cards above. */}
            <div className="prod-table-desktop" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '950px' }}>
              <thead>
                <tr>
                  <th className="prod-th">Product</th>
                  <th className="prod-th">Product Code</th>
                  <th className="prod-th">Header</th>
                  <th className="prod-th">Category</th>
                  <th className="prod-th">Subcategory</th>
                  <th className="prod-th">Variant</th>
                  <th className="prod-th">Approval</th>
                  <th className="prod-th" style={{ textAlign: 'right', paddingRight: '24px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((p) => {
                  const { header, categoryName, subcategory } = getProductDetails(p);
                  const isEvenId = parseInt(p.id.replace(/\D/g, '') || '0') % 2 === 0;
                  const isEbook = p.raw?.fulfillmentType === 'digital';
                  const ebookFileStatus = p.raw?.digital?.file?.status === 'uploaded' ? 'PDF uploaded' : 'PDF missing';

                  return (
                    <tr key={p.id} className="prod-table-row">
                      {/* Product */}
                      <td className="prod-td" style={{ minWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: 8,
                            backgroundColor: '#f8fafc',
                            border: '1.5px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            flexShrink: 0
                          }}>
                            {p.img ? (
                              <img src={p.img} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                              </svg>
                            )}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: '800', color: '#0f172a', textAlign: 'left' }}>
                            {p.name}
                          </span>
                        </div>
                      </td>

                      {/* Product Code */}
                      <td className="prod-td">
                        <span style={{ fontSize: 12, fontWeight: '600', color: '#475569', fontFamily: 'monospace' }}>
                          {getProductCode(p)}
                        </span>
                      </td>

                      {/* Header */}
                      <td className="prod-td">
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: '800',
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                          letterSpacing: '0.3px'
                        }}>
                          {header}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="prod-td">
                        <span style={{ fontSize: 13, fontWeight: '700', color: '#475569', textAlign: 'left', display: 'block' }}>
                          {categoryName}
                        </span>
                      </td>

                      {/* Subcategory */}
                      <td className="prod-td">
                        <span style={{ fontSize: 13, fontWeight: '700', color: '#475569', textAlign: 'left', display: 'block' }}>
                          {subcategory}
                        </span>
                      </td>

                      {/* Variant */}
                      <td className="prod-td">
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: '800',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          color: '#1e293b',
                          letterSpacing: '0.3px',
                          cursor: 'pointer'
                        }} onClick={() => isEbook ? triggerToast(`${p.name}: ${ebookFileStatus}`) : triggerToast(`${p.name} variant setup details: 1 Default Variant`)}>
                          {isEbook ? `E-BOOK · ${ebookFileStatus.toUpperCase()}` : isEvenId ? '2 VARIANTS' : '1 VARIANTS'}
                        </span>
                      </td>

                      {/* Approval */}
                      <td className="prod-td">
                        {p.status === 'Active' ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: '#ebfdf2',
                            color: '#166534',
                            letterSpacing: '0.3px'
                          }}>
                            Approved
                          </span>
                        ) : p.status === 'Rejected' ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: '#fee2e2',
                            color: '#dc2626',
                            letterSpacing: '0.3px'
                          }}>
                            Rejected
                          </span>
                        ) : (
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: '#fff7ed',
                            color: '#ea580c',
                            letterSpacing: '0.3px'
                          }}>
                            Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="prod-td" style={{ textAlign: 'right', paddingRight: '24px' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className="action-icon-btn"
                            title="Edit Product"
                            onClick={() => startEditProduct(p.raw)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>

                          <button
                            className="action-icon-btn delete"
                            title="Delete Product"
                            onClick={() => handleDeleteProduct(p.id)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      <ProductModal />

      {showBulkModal && (
        <BulkUploadModal
          mode={activeMode}
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            if (fetchMyProducts) fetchMyProducts();
            if (triggerToast) triggerToast('Bulk product import complete!');
          }}
        />
      )}
    </div>
  );
};

export default ProductsTab;
