import React from 'react';
import { useSeller } from '../context/SellerContext';

export const DashboardTab = () => {
  const { bizForm, triggerToast, setActiveTab, selectedTypes, sellerKpis, channelKpis, products, orders } = useSeller();

  const selectedTypesList = selectedTypes || ['ecommerce'];
  const hasEcom = selectedTypesList.includes('ecommerce');
  const hasQuick = selectedTypesList.includes('quick');
  const isHybrid = hasEcom && hasQuick;

  // Real figures from GET /api/sellers/dashboard, derived from the orders
  // themselves. A store with no sales shows zeros — never demo numbers.
  const displayRevenue = sellerKpis?.totalRevenue || 0;
  const displayOrders = sellerKpis?.totalOrders || 0;
  const avgOrderValue = sellerKpis?.avgOrderValue || 0;

  // The per-storefront split. 'grocery' is what the server calls the Quick
  // channel; 'quick' is only ever the label shown to the seller.
  const ecomRevenue = channelKpis?.ecommerce?.revenue || 0;
  const ecomOrders = channelKpis?.ecommerce?.orders || 0;
  const quickRevenue = channelKpis?.grocery?.revenue || 0;
  const quickOrders = channelKpis?.grocery?.orders || 0;

  const hasAnyActivity = displayRevenue > 0 || displayOrders > 0 || (products?.length || 0) > 0;

  return (
    <div className="dashboard-tab-wrapper" style={{ padding: '0 0 24px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Welcome Header */}
      <div style={{ textAlign: 'left', marginBottom: 4 }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 24, fontWeight: '800', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>Dashboard</h2>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: '500' }}>Welcome back! Here's what's happening with your store today.</span>
      </div>

      {/* KPI Metrics */}
      <div className="seller-kpi-grid">
        {/* Total Revenue */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Total Revenue</span>
          <p style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', margin: '12px 0 8px 0', fontFamily: "'Outfit', sans-serif" }}>
            ₹{displayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <span style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>Across all your orders</span>
          <div style={{ position: 'absolute', right: 20, top: 20, color: '#0f172a', fontSize: 18, fontWeight: '500' }}>₹</div>

          {/* Breakdown for Hybrid sellers */}
          {isHybrid && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e2e8f0', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: 11, fontWeight: '700' }}>
                <span style={{ color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>🌐 E-Commerce</span>
                <span style={{ color: '#0f172a' }}>₹{ecomRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: 11, fontWeight: '700' }}>
                <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>⚡ Quick Commerce</span>
                <span style={{ color: '#0f172a' }}>₹{quickRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          )}
        </div>

        {/* Total Orders */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Total Orders</span>
          <p style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', margin: '12px 0 8px 0', fontFamily: "'Outfit', sans-serif" }}>
            {displayOrders}
          </p>
          <span style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>Cancelled and returned excluded</span>
          <div style={{ position: 'absolute', right: 20, top: 20, color: '#0f172a' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </div>

          {/* Breakdown for Hybrid sellers */}
          {isHybrid && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e2e8f0', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: 11, fontWeight: '700' }}>
                <span style={{ color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>🌐 E-Commerce</span>
                <span style={{ color: '#0f172a' }}>{ecomOrders} orders</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: 11, fontWeight: '700' }}>
                <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>⚡ Quick Commerce</span>
                <span style={{ color: '#0f172a' }}>{quickOrders} orders</span>
              </div>
            </div>
          )}
        </div>

        {/* Avg Order Value */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Avg Order Value</span>
          <p style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', margin: '12px 0 8px 0', fontFamily: "'Outfit', sans-serif" }}>₹{avgOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <span style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>Revenue ÷ orders</span>
          <div style={{ position: 'absolute', right: 20, top: 16, backgroundColor: '#f5f3ff', color: '#7c3aed', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
        </div>

        {/* Pending Orders */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Pending Orders</span>
          <p style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', margin: '12px 0 8px 0', fontFamily: "'Outfit', sans-serif" }}>{sellerKpis?.pendingOrders || 0}</p>
          <span style={{ fontSize: 11, fontWeight: '700', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 3 }}>⤳ -3 <span style={{ color: '#64748b', fontWeight: '500' }}>need attention</span></span>
          <div style={{ position: 'absolute', right: 20, top: 16, backgroundColor: '#fff7ed', color: '#f97316', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Quick Action Cards: 3 Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16, width: '100%', marginTop: 4 }}>
        {/* Card 1: Add New Product (Purple Card) */}
        <div 
          onClick={() => setActiveTab('products')}
          style={{ backgroundColor: '#4f46e5', color: '#fff', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79,70,229,0.15)', transition: 'transform 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 'bold' }}>
              +
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: '800' }}>Add New Product</span>
              <span style={{ fontSize: 10.5, opacity: 0.85, marginTop: 2 }}>List a new item in your store</span>
            </div>
          </div>
          <span style={{ fontSize: 18, fontWeight: '700' }}>↗</span>
        </div>

        {/* Card 2: Process Orders (White Card) */}
        <div 
          onClick={() => setActiveTab('orders')}
          style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.01)', transition: 'transform 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ backgroundColor: '#eff6ff', color: '#3b82f6', borderRadius: 10, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>Process Orders</span>
              <span style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>View and manage pending orders</span>
            </div>
          </div>
          <span style={{ fontSize: 18, fontWeight: '700', color: '#64748b' }}>↗</span>
        </div>

        {/* Card 3: View Earnings (White Card) */}
        <div 
          onClick={() => setActiveTab('earnings')}
          style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.01)', transition: 'transform 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ backgroundColor: '#f0fdf4', color: '#16a34a', borderRadius: 10, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 'bold' }}>
              ₹
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>View Earnings</span>
              <span style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>Check your revenue and payouts</span>
            </div>
          </div>
          <span style={{ fontSize: 18, fontWeight: '700', color: '#64748b' }}>↗</span>
        </div>
      </div>

      {/* Analytics & Top Products side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, width: '100%', marginTop: 8 }}>
        {/* SVG Revenue analytics graph */}
        <div className="chart-section-card" style={{ margin: 0 }}>
          <div className="chart-header">
            <h3 className="chart-title">SALES PERFORMANCE</h3>
            <div className="chart-time-filter">
              <button className="chart-time-btn active">30 Days</button>
              <button className="chart-time-btn" onClick={() => triggerToast('Custom ranges disabled')}>7 Days</button>
            </div>
          </div>
          <div className="chart-svg-container">
            <svg viewBox="0 0 350 120" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1b7a37" stopOpacity="0.3"></stop>
                  <stop offset="100%" stopColor="#1b7a37" stopOpacity="0.0"></stop>
                </linearGradient>
              </defs>
              <path d="M0,100 Q40,60 80,85 T160,40 T240,55 T320,25 T350,15 L350,120 L0,120 Z" fill="url(#salesGrad)"></path>
              <path d="M0,100 Q40,60 80,85 T160,40 T240,55 T320,25 T350,15" fill="none" stroke="#1b7a37" strokeWidth="3"></path>
              <circle cx="160" cy="40" r="4" fill="#ffffff" stroke="#1b7a37" strokeWidth="2.5"></circle>
              <circle cx="320" cy="25" r="4" fill="#ffffff" stroke="#1b7a37" strokeWidth="2.5"></circle>
              <text x="160" y="30" fill="var(--text-primary)" fontSize="9" fontWeight="800" textAnchor="middle">—</text>
              <line x1="0" y1="110" x2="350" y2="110" stroke="#f1f5f9" strokeWidth="1"></line>
            </svg>
          </div>
        </div>

        {/* Top Selling Products — driven by real listings, not demo rows */}
        <div className="table-section-card" style={{ margin: 0 }}>
          <h3 className="section-card-title">TOP SELLING PRODUCTS</h3>
          <div className="top-products-list">
            {(!products || products.length === 0) ? (
              <div style={{ padding: '28px 12px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>No products yet</div>
                <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                  Add your first product to start selling. It will appear here once it is approved.
                </div>
                <button
                  className="seller-add-btn"
                  style={{ marginTop: 14 }}
                  onClick={() => setActiveTab('products')}
                >
                  Add Product
                </button>
              </div>
            ) : (
              products.slice(0, 5).map((p) => (
                <div className="top-product-row" key={p.id}>
                  <div className="top-product-left">
                    {p.img
                      ? <img src={p.img} alt={p.name} className="top-product-img" />
                      : <div className="top-product-img" style={{ background: '#f1f5f9' }} />}
                    <div>
                      <div className="top-product-name">{p.name}</div>
                      <div className="top-product-units">{p.stock} in stock &middot; {p.status}</div>
                    </div>
                  </div>
                  <span className="top-product-right">&#8377;{Number(p.price).toLocaleString('en-IN')}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardTab;
