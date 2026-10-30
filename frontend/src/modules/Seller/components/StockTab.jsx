import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { ProductModal } from './ProductModal';

export const StockTab = () => {
  const {
    products,
    handleUpdateStock,
    selectedTypes,
    activeMode,
    setActiveMode
  } = useSeller();

  // Local filtering and search states
  const [search, setSearch] = useState('');
  const [selectedTab, setSelectedTab] = useState('All'); // All, In Stock, Out of Stock
  
  // Inline adjustment state
  const [adjustingId, setAdjustingId] = useState(null);
  const [newStockVal, setNewStockVal] = useState(0);

  // Dynamic Product SKU/Code generation matching mock style (e.g., XYZZ-01-RW8B)
  const getProductCode = (p) => {
    const cleanName = p.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const prefix = cleanName.substring(0, 4).padEnd(4, 'X');
    const idNum = p.id.replace(/\D/g, '') || '01';
    return `${prefix}-01-RW${idNum.padStart(2, '0')}`;
  };

  // Digital listings are not physical inventory and have no adjustable stock.
  const inventoryProducts = products.filter((product) => product.raw?.fulfillmentType !== 'digital');

  // KPI Calculations
  const totalInventory = inventoryProducts.reduce((acc, p) => acc + p.stock, 0);
  const lowStockCount = inventoryProducts.filter(p => p.stock > 0 && p.stock <= 10).length;
  const outOfStockCount = inventoryProducts.filter(p => p.stock === 0).length;
  const totalValuation = inventoryProducts.reduce((acc, p) => acc + (p.price * p.stock), 0);

  // Filtered Products
  const filteredProducts = inventoryProducts.filter(p => {
    const code = getProductCode(p).toLowerCase();
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                          code.includes(search.toLowerCase());
    
    let matchesTab = true;
    if (selectedTab === 'In Stock') {
      matchesTab = p.stock > 0;
    } else if (selectedTab === 'Out of Stock') {
      matchesTab = p.stock === 0;
    }
    
    return matchesSearch && matchesTab;
  });

  return (
    <div style={{ backgroundColor: '#f8fafc', minHeight: '100%', padding: '0 16px 40px 16px', boxSizing: 'border-box' }}>
      {/* Dynamic inline styles for hover animations */}
      <style dangerouslySetInnerHTML={{__html: `
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
        .stock-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          text-align: left;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          min-width: 0;
        }
        .stock-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .stock-table-row {
          border-bottom: 1.5px solid #f1f5f9;
          transition: background-color 0.15s ease;
        }
        .stock-table-row:hover {
          background-color: #f8fafc;
        }
        .stock-th {
          padding: 14px 16px;
          border-bottom: 2.5px solid #f1f5f9;
          color: #475569;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          text-align: left;
        }
        .stock-td {
          padding: 16px;
          vertical-align: middle;
          border-bottom: 1px solid #f1f5f9;
        }
        .stepper-btn {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: 1.5px solid #cbd5e1;
          background-color: #fff;
          color: #334155;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.1s ease;
        }
        .stepper-btn:hover:not(:disabled) {
          background-color: #f1f5f9;
          border-color: #94a3b8;
        }
        .stepper-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .action-adjust-btn {
          background-color: #f1f5f9;
          color: #334155;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .action-adjust-btn:hover {
          background-color: #e2e8f0;
          color: #0f172a;
        }

        /* Same split as ProductsTab.jsx: the existing table (minWidth 700px)
           only fits once there's room for it, at 768px+. The mobile card
           list below carries the same data + the same adjust-stock stepper
           interaction, stacked instead of columned. */
        .stock-table-desktop {
          display: none;
        }
        .stock-cards-mobile {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (min-width: 768px) {
          .stock-table-desktop {
            display: block;
          }
          .stock-cards-mobile {
            display: none;
          }
        }
        .stock-card-mobile {
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          padding: 12px;
        }
        .stock-card-mobile-top {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .stock-card-mobile-thumb {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background-color: #f8fafc;
          border: 1.5px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }
        .stock-card-mobile-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stock-card-mobile-name {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }
        .stock-card-mobile-code {
          font-size: 9px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.3px;
        }
        .stock-card-mobile-price {
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }
        .stock-card-mobile-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #f1f5f9;
        }
        .stock-card-mobile-health {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
      `}} />

      {/* 1. HEADER TITLE SECTION */}
      <div style={{ padding: '24px 0 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
            Stock Management
          </h1>
          <span style={{ 
            marginLeft: 12, 
            backgroundColor: '#FEF3C7', 
            color: '#D97706', 
            padding: '3px 8px', 
            borderRadius: 6, 
            fontSize: 10, 
            fontWeight: 800, 
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}>
            Inventory Control
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#475569', fontWeight: 500 }}>
          Monitor stock levels, manage restocks, and track movements.
        </p>
      </div>

      {/* 2. KPI METRICS CARDS ROW */}
      <div className="prod-kpi-grid">
        {/* Card 1: Total Inventory */}
        <div className="stock-kpi-card">
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#f1f5f9',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              Total Inventory
            </span>
            <span style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {totalInventory}
            </span>
          </div>
        </div>

        {/* Card 2: Low Stock Items */}
        <div className="stock-kpi-card">
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#ffedd5',
            color: '#ea580c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              Low Stock Items
            </span>
            <span style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {lowStockCount}
            </span>
          </div>
        </div>

        {/* Card 3: Out of Stock */}
        <div className="stock-kpi-card">
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
              <path d="M23 3H1v5h22V3z" />
              <line x1="10" y1="12" x2="14" y2="16" />
              <line x1="14" y1="12" x2="10" y2="16" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              Out of Stock
            </span>
            <span style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {outOfStockCount}
            </span>
          </div>
        </div>

        {/* Card 4: Stock Valuation */}
        <div className="stock-kpi-card">
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#ebfdf2',
            color: '#166534',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" />
              <polyline points="7 13 12 18 17 13" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              Stock Valuation
            </span>
            <span style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              ₹{totalValuation.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Toggle (Moved from Header for Stock Tab) */}
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

      {/* 3. STOCK CONTROL TABLE CARD */}
      <div style={{
        margin: '8px 0 24px 0',
        backgroundColor: '#fff',
        border: '1.5px solid #f1f5f9',
        borderRadius: 20,
        padding: '24px 24px 16px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        {/* Filter & Action Row */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          gap: 16
        }}>
          {/* Search box (Left) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            backgroundColor: '#f8fafc',
            border: '1.5px solid #e2e8f0',
            borderRadius: 100,
            padding: '10px 16px',
            flex: '1',
            minWidth: 0,
            width: '100%',
            maxWidth: '360px',
            transition: 'border-color 0.2s'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input 
              type="text" 
              placeholder="Search by product name or SKU..." 
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

          {/* Segmented control for active statuses (Center) */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            backgroundColor: '#f1f5f9',
            padding: 4,
            borderRadius: 100,
            gap: 2
          }}>
            {['All', 'In Stock', 'Out of Stock'].map((tab) => {
              const isActive = selectedTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSelectedTab(tab)}
                  style={{
                    border: 'none',
                    background: isActive ? '#fff' : 'none',
                    color: isActive ? '#0f172a' : '#64748b',
                    fontSize: 12,
                    fontWeight: isActive ? '800' : '700',
                    padding: '8px 18px',
                    borderRadius: 100,
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quantities Table */}
        {filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 13, fontWeight: 600 }}>
            No products found matching filters.
          </div>
        ) : (
          <>
            {/* Mobile — stacked card per product, same data + the same
                adjust-stock stepper as the desktop table, hidden below via
                .stock-cards-mobile / .stock-table-desktop (see <style> above). */}
            <div className="stock-cards-mobile">
              {filteredProducts.map((p) => {
                const isOut = p.stock === 0;
                const isLow = p.stock > 0 && p.stock <= 10;
                const healthStyle = isOut
                  ? { backgroundColor: '#fee2e2', color: '#dc2626' }
                  : isLow
                    ? { backgroundColor: '#fff7ed', color: '#ea580c' }
                    : { backgroundColor: 'var(--primary-light)', color: 'var(--primary)' };
                const healthLabel = isOut ? 'OUT OF STOCK' : isLow ? 'LOW STOCK' : 'IN STOCK';

                return (
                  <div key={p.id} className="stock-card-mobile">
                    <div className="stock-card-mobile-top">
                      <div className="stock-card-mobile-thumb">
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
                      <div className="stock-card-mobile-info">
                        <span className="stock-card-mobile-name">{p.name}</span>
                        <span className="stock-card-mobile-code">PRODUCT CODE: {getProductCode(p)}</span>
                      </div>
                      <span className="stock-card-mobile-price">₹{p.price}</span>
                    </div>

                    <div className="stock-card-mobile-bottom">
                      <span className="stock-card-mobile-health" style={healthStyle}>{healthLabel}</span>

                      {adjustingId === p.id ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button className="stepper-btn" disabled={newStockVal <= 0} onClick={() => setNewStockVal(prev => Math.max(0, prev - 1))}>-</button>
                          <input
                            type="number"
                            value={newStockVal}
                            onChange={(e) => setNewStockVal(Math.max(0, Number(e.target.value)))}
                            style={{ width: 44, height: 30, textAlign: 'center', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 12, fontWeight: '800', outline: 'none', color: '#0f172a' }}
                          />
                          <button className="stepper-btn" onClick={() => setNewStockVal(prev => prev + 1)}>+</button>
                          <button
                            onClick={() => { handleUpdateStock(p.id, newStockVal - p.stock); setAdjustingId(null); }}
                            style={{ border: 'none', backgroundColor: 'var(--primary)', color: '#fff', padding: '0 10px', height: 30, borderRadius: 8, fontSize: 11, fontWeight: '800', cursor: 'pointer' }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setAdjustingId(null)}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #cbd5e1', backgroundColor: '#fff', color: '#64748b', fontSize: 12, fontWeight: '800', cursor: 'pointer' }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button className="action-adjust-btn" onClick={() => { setAdjustingId(p.id); setNewStockVal(p.stock); }}>
                          Adjust Stock
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop — untouched, existing table. */}
            <div className="stock-table-desktop" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th className="stock-table-header stock-th">Product Information</th>
                  <th className="stock-table-header stock-th">Inventory Capacity</th>
                  <th className="stock-table-header stock-th">Stock Health</th>
                  <th className="stock-table-header stock-th">Price</th>
                  <th className="stock-table-header stock-th" style={{ textAlign: 'right', paddingRight: '24px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const isOut = p.stock === 0;
                  const isLow = p.stock > 0 && p.stock <= 10;
                  
                  return (
                    <tr key={p.id} className="stock-table-row">
                      {/* Product Information */}
                      <td className="stock-td" style={{ minWidth: 280 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 40,
                            height: 40,
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                            <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>
                              {p.name}
                            </h4>
                            <span style={{ fontSize: 9, fontWeight: '800', color: '#94a3b8', letterSpacing: '0.3px' }}>
                              PRODUCT CODE: {getProductCode(p)}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Inventory Capacity */}
                      <td className="stock-td">
                        <span style={{ fontSize: 13, fontWeight: '800', color: '#0f172a' }}>
                          {p.stock} units
                        </span>
                      </td>

                      {/* Stock Health */}
                      <td className="stock-td">
                        {isOut ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: '#fee2e2',
                            color: '#dc2626',
                            letterSpacing: '0.3px'
                          }}>
                            OUT OF STOCK
                          </span>
                        ) : isLow ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: '#fff7ed',
                            color: '#ea580c',
                            letterSpacing: '0.3px'
                          }}>
                            LOW STOCK
                          </span>
                        ) : (
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: '800',
                            backgroundColor: 'var(--primary-light)',
                            color: 'var(--primary)',
                            letterSpacing: '0.3px'
                          }}>
                            IN STOCK
                          </span>
                        )}
                      </td>

                      {/* Price */}
                      <td className="stock-td">
                        <span style={{ fontSize: 13, fontWeight: '800', color: '#0f172a' }}>
                          ₹{p.price}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="stock-td" style={{ textAlign: 'right', paddingRight: '24px' }}>
                        {adjustingId === p.id ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <button
                              className="stepper-btn"
                              disabled={newStockVal <= 0}
                              onClick={() => setNewStockVal(prev => Math.max(0, prev - 1))}
                            >
                              -
                            </button>
                            <input 
                              type="number" 
                              value={newStockVal}
                              onChange={(e) => setNewStockVal(Math.max(0, Number(e.target.value)))}
                              style={{
                                width: 52,
                                height: 30,
                                textAlign: 'center',
                                border: '1.5px solid #cbd5e1',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: '800',
                                outline: 'none',
                                color: '#0f172a'
                              }}
                            />
                            <button
                              className="stepper-btn"
                              onClick={() => setNewStockVal(prev => prev + 1)}
                            >
                              +
                            </button>
                            
                            <button
                              onClick={() => {
                                handleUpdateStock(p.id, newStockVal - p.stock);
                                setAdjustingId(null);
                              }}
                              style={{
                                border: 'none',
                                backgroundColor: 'var(--primary)',
                                color: '#fff',
                                padding: '0 12px',
                                height: 30,
                                borderRadius: 8,
                                fontSize: 11,
                                fontWeight: '800',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setAdjustingId(null)}
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                border: '1.5px solid #cbd5e1',
                                backgroundColor: '#fff',
                                color: '#64748b',
                                fontSize: 12,
                                fontWeight: '800',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            className="action-adjust-btn"
                            onClick={() => {
                              setAdjustingId(p.id);
                              setNewStockVal(p.stock);
                            }}
                          >
                            Adjust Stock
                          </button>
                        )}
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

      {/* 4. ADD PRODUCT — same tabbed panel ProductsTab.jsx mounts, so both
          entry points share one real category tree, one real image upload
          and one real submit path instead of drifting apart. */}
      <ProductModal />
    </div>
  );
};

export default StockTab;
