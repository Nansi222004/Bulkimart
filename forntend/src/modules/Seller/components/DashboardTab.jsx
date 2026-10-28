import React from 'react';
import SellerSalesChart from './SellerSalesChart';
const money = value => value === null ? 'Pending calculation' : `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KpiCard = ({ title, value, hint, icon, onClick, children }) => <button type="button" className="seller-home-kpi" onClick={onClick}><span className="seller-home-kpi-heading"><span>{title}</span><span aria-hidden="true">{icon}</span></span><span className="seller-home-kpi-value">{value}</span><span className="seller-home-kpi-hint">{hint}</span>{children}</button>;
import { useSeller } from '../context/SellerContext';

export const DashboardTab = () => {
  const { setActiveTab, setOrderListState, selectedTypes, sellerKpis, channelKpis, products, salesPerformance, sellerKpisLoading, sellerKpisError, fetchSellerKpis } = useSeller();

  const selectedTypesList = selectedTypes || ['ecommerce'];
  const hasEcom = selectedTypesList.includes('ecommerce');
  const hasQuick = selectedTypesList.includes('quick');
  const isHybrid = hasEcom && hasQuick;

  // Real figures from GET /api/sellers/dashboard, derived from the orders
  // themselves. A store with no sales shows zeros — never demo numbers.
  const displayRevenue = sellerKpis?.totalRevenue === null ? null : sellerKpis?.totalRevenue || 0;
  const displayOrders = sellerKpis?.totalOrders || 0;
  const avgOrderValue = sellerKpis?.avgOrderValue === null ? null : sellerKpis?.avgOrderValue || 0;

  // The per-storefront split. 'grocery' is what the server calls the Quick
  // channel; 'quick' is only ever the label shown to the seller.
  const ecomRevenue = channelKpis?.ecommerce?.revenue === null ? null : channelKpis?.ecommerce?.revenue || 0;
  const ecomOrders = channelKpis?.ecommerce?.orders || 0;
  const quickRevenue = channelKpis?.grocery?.revenue === null ? null : channelKpis?.grocery?.revenue || 0;
  const quickOrders = channelKpis?.grocery?.orders || 0;

  const hasAnyActivity = displayRevenue > 0 || displayOrders > 0 || (products?.length || 0) > 0;

  return (
    <div className="dashboard-tab-wrapper" style={{ padding: '0 0 24px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Welcome Header */}
      <div style={{ textAlign: 'left', marginBottom: 4 }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 24, fontWeight: '800', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>Dashboard</h2>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: '500' }}>Welcome back! Here's what's happening with your store today.</span>
        <p className="seller-home-kpi-hint">Figures across all your storefronts</p>
      </div>

      {sellerKpisLoading && <p role="status">Updating dashboard…</p>}
      {sellerKpisError && <p role="alert">{sellerKpisError} <button type="button" onClick={fetchSellerKpis}>Retry dashboard</button></p>}
      <div className="seller-kpi-grid" aria-busy={!!sellerKpisLoading}>
        <KpiCard title="Total Revenue" value={money(displayRevenue)} hint="Completed sales after discounts" icon="₹" onClick={() => setActiveTab('earnings')}>
          {sellerKpis?.revenuePendingOrders > 0 && <span className="seller-home-kpi-hint">{money(sellerKpis.knownRevenue)} confirmed · {sellerKpis.revenuePendingOrders} orders pending calculation</span>}
          <span className="seller-home-net">Net earnings: {sellerKpis?.netEarningsPendingOrders > 0 ? <>{sellerKpis.netEarningsCalculatedOrders > 0 ? <>{money(sellerKpis.knownNetEarnings)} calculated subtotal · </> : 'Not calculated yet · '}{sellerKpis.netEarningsPendingOrders} {sellerKpis.netEarningsPendingOrders === 1 ? 'order' : 'orders'} awaiting finance review</> : money(sellerKpis?.netEarnings)}</span>
          {isHybrid && <span className="seller-home-breakdown"><span>Shop All: {money(ecomRevenue)}</span><span>Quick Commerce: {money(quickRevenue)}</span></span>}
        </KpiCard>
        <KpiCard title="Total Orders" value={displayOrders} hint="Cancelled and returned excluded" icon="▣" onClick={() => { setOrderListState({ tab: 'all', search: '', scope: 'all' }); setActiveTab('orders'); }}>
          {isHybrid && <span className="seller-home-breakdown"><span>Shop All: {ecomOrders}</span><span>Quick Commerce: {quickOrders}</span></span>}
        </KpiCard>
        <KpiCard title="Average Order Value" value={money(avgOrderValue)} hint={`Sales revenue ÷ ${sellerKpis?.completedOrders ?? 0} completed orders`} icon="◇" onClick={() => { setOrderListState({ tab: 'all', search: '', scope: 'all' }); setActiveTab('salesreport'); }} />
        <KpiCard title="Pending Orders" value={sellerKpis?.pendingOrders || 0} hint="Awaiting acceptance or preparation" icon="◷" onClick={() => { setOrderListState({ tab: 'pending', search: '', scope: 'all' }); setActiveTab('orders'); }} />
      </div>

      {/* Quick Action Cards: 3 Columns */}
      <div className="seller-dashboard-actions">
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

        {/* Card 4: Advertising & Promotions */}
        <div 
          onClick={() => setActiveTab('advertising')}
          style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.01)', transition: 'transform 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ backgroundColor: '#fef3c7', color: '#d97706', borderRadius: 10, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 11 18-5v12L3 13v-2z" />
                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>Advertising & Ads</span>
              <span style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>Promote in category spotlight</span>
            </div>
          </div>
          <span style={{ fontSize: 18, fontWeight: '700', color: '#64748b' }}>↗</span>
        </div>
      </div>

      {/* Analytics & Top Products side-by-side */}
      <div className="seller-dashboard-panels">
        <SellerSalesChart data={salesPerformance} />

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
