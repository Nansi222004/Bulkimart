import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

export const SuperAdminDashboard = () => {
  const { triggerToast, setActiveTab, sellerCounts, dashboardOverview, fetchDashboardOverview } = useAdmin();

  useEffect(() => {
    fetchDashboardOverview();
  }, [fetchDashboardOverview]);

  // Total sellers comes from current seller status counts or the dashboard API.
  const totalSellersCount = ((sellerCounts?.approved || 0) + (sellerCounts?.pending || 0)) || (dashboardOverview?.totalSellers || 0);
  const ov = dashboardOverview;

  const recentOrders = (ov?.recentOrders || []).map((o) => ({
    id: o.id || o._id || '—',
    customer: o.buyerName || 'Customer',
    type: o.type === 'grocery' ? 'Quick Commerce' : o.type === 'ecommerce' ? 'E-Commerce' : (o.type || 'Order'),
    amount: o.amount ?? 0,
    status: o.status || 'Pending',
  }));
  const lowStockAlerts = (ov?.lowStockAlerts || []).map((p) => ({
    name: p.name || 'Product',
    category: p.sellerName || '—',
    hub: '',
    stock: p.stock ?? 0,
  }));
  const sellerRegistrations = (ov?.recentSellers || []).map((s, idx) => ({
    id: s.id || s._id || `seller-${idx}`,
    name: s.businessName || s.name || 'Unnamed Seller',
    type: 'Seller',
    status: s.status || 'Pending',
    date: s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
  }));
  const ecomCategories = ov?.ecommerceCategories || [];
  const qcomCategories = ov?.quickCommerceCategories || [];

  return (
    <div className="sa-canvas">

      {/* 8 KPI Cards Grid Row */}
      <div className="sa-kpi-grid">

        <div className="sa-kpi-card">
          <span className="sa-kpi-title">Total Revenue</span>
          <span className="sa-sa-primary sa-kpi-value">₹{(ov?.revenue || 0).toLocaleString('en-IN')}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{ov ? 'Across all completed orders' : 'Loading…'}</span>
        </div>

        <div className="sa-kpi-card">
          <span className="sa-kpi-title">Total Orders</span>
          <span className="sa-kpi-value">{ov?.totalOrders || 0}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{ov ? 'All-time' : 'Loading…'}</span>
        </div>

        <div className="sa-kpi-card ecom">
          <span className="sa-kpi-title">E-Commerce</span>
          <span className="sa-kpi-value" style={{ color: 'var(--sa-ecom)' }}>{ov?.ecommerceOrders || 0}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{ov ? 'Orders' : 'Loading…'}</span>
        </div>

        <div className="sa-kpi-card qcom">
          <span className="sa-kpi-title">Quick Commerce</span>
          <span className="sa-kpi-value" style={{ color: 'var(--sa-success)' }}>{ov?.groceryOrders || 0}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{ov ? 'Orders' : 'Loading…'}</span>
        </div>

        <div className="sa-kpi-card" onClick={() => setActiveTab('users')} style={{ cursor: 'pointer' }}>
          <span className="sa-kpi-title">Total Users</span>
          <span className="sa-kpi-value">{ov?.totalUsers || 0}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{ov ? 'Buyers' : 'Loading…'}</span>
        </div>

        <div className="sa-kpi-card" onClick={() => setActiveTab('sellers')} style={{ cursor: 'pointer' }}>
          <span className="sa-kpi-title">Total Sellers</span>
          <span className="sa-kpi-value">{totalSellersCount}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>{sellerCounts.pending || 0} pending</span>
        </div>

      </div>

      {/* Main Analytics Charts Row — no revenue/order-trend endpoint exists
          yet, so these show an honest empty state instead of invented lines. */}
      <div className="sa-charts-row">

        <div className="sa-chart-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Revenue Overview</h3>
          </div>
          <div className="sa-chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
            No revenue trend data available.
          </div>
        </div>

        <div className="sa-chart-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Orders Performance</h3>
          </div>
          <div className="sa-chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
            No order trend data available.
          </div>
        </div>

        <div className="sa-chart-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Orders by Channel</h3>
          </div>
          <div className="sa-chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
            No channel split data available.
          </div>
        </div>

      </div>

      {/* Double columns activity grids */}
      <div className="sa-double-row">

        {/* Column 1: Recent Orders List */}
        <div className="sa-widget-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Recent Orders</h3>
            <button className="sa-collapse-btn" onClick={() => triggerToast('View all orders...')}>View All</button>
          </div>
          <div className="sa-widget-list">
            {recentOrders.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No recent orders.</div>
            ) : recentOrders.map((order, idx) => (
              <div key={order.id || idx} className="sa-widget-row">
                <div className="sa-widget-left">
                  <div className="sa-widget-avatar">ORD</div>
                  <div className="sa-widget-info">
                    <span className="sa-widget-name">{order.customer}</span>
                    <span className="sa-widget-sub">{order.id} • {order.type}</span>
                  </div>
                </div>
                <div className="sa-widget-right">
                  <span className="sa-widget-value">₹{order.amount}</span>
                  <span className={`sa-status-pill ${(order.status || 'pending').toString().toLowerCase().replace(/\s+/g, '-')}`}>{order.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Low Stock Warning alerts */}
        <div className="sa-widget-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Low Stock Alert</h3>
            <span style={{ fontSize: 13, color: 'var(--sa-warning)' }}>⚠</span>
          </div>
          <div className="sa-widget-list">
            {lowStockAlerts.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No low-stock alerts.</div>
            ) : lowStockAlerts.map(item => (
              <div key={item.name} className="sa-widget-row" style={{ cursor: 'pointer' }} onClick={() => triggerToast(`Navigating to stock manager for ${item.name}`)}>
                <div className="sa-widget-left">
                  <div className="sa-widget-avatar" style={{ backgroundColor: 'rgba(249, 115, 22, 0.1)', color: 'var(--sa-warning)' }}>STOCK</div>
                  <div className="sa-widget-info">
                    <span className="sa-widget-name">{item.name}</span>
                    <span className="sa-widget-sub">{item.category}</span>
                  </div>
                </div>
                <div className="sa-widget-right">
                  <span className="sa-widget-value" style={{ color: 'var(--sa-error)' }}>{item.stock} left</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Recent Seller Registrations list */}
        <div className="sa-widget-card">
          <div className="sa-card-header">
            <h3 className="sa-card-title">Sellers Registered</h3>
            <button className="sa-collapse-btn" onClick={() => setActiveTab('sellers')}>Approve</button>
          </div>
          <div className="sa-widget-list">
            {sellerRegistrations.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No recent registrations.</div>
            ) : sellerRegistrations.map((sel, idx) => (
              <div key={sel.id || sel.name || idx} className="sa-widget-row">
                <div className="sa-widget-left">
                  <div className="sa-widget-avatar" style={{ backgroundColor: (sel.type || '').includes('SHG') ? 'rgba(139, 92, 246, 0.1)' : 'rgba(14, 165, 233, 0.1)', color: (sel.type || '').includes('SHG') ? 'var(--sa-shg)' : 'var(--sa-primary)' }}>SEL</div>
                  <div className="sa-widget-info">
                    <span className="sa-widget-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{sel.name}</span>
                    </span>
                    <span className="sa-widget-sub">{sel.type} • {sel.date}</span>
                  </div>
                </div>
                <div className="sa-widget-right">
                  <span className={`sa-status-pill ${(sel.status || 'pending').toString().toLowerCase().replace(/\s+/g, '-')}`}>{sel.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Top Categories comparison & Subscription Plans metrics — no
          category-wise sales or subscription-plan endpoint exists yet. */}
      <div className="sa-categories-row">

        <div className="sa-widget-card" style={{ maxHeight: 'none' }}>
          <div className="sa-card-header">
            <h3 className="sa-card-title">E-Commerce Categories</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ecomCategories.length === 0 ? (
              <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No category sales data.</div>
            ) : ecomCategories.map(cat => (
              <div key={cat.name} className="sa-category-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-category-icon-box" style={{ color: 'var(--sa-ecom)' }}>📦</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800 }}>{cat.name}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800 }}>{cat.qty} units</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sa-widget-card" style={{ maxHeight: 'none' }}>
          <div className="sa-card-header">
            <h3 className="sa-card-title">Q-Commerce Categories</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {qcomCategories.length === 0 ? (
              <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No category sales data.</div>
            ) : qcomCategories.map(cat => (
              <div key={cat.name} className="sa-category-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-category-icon-box" style={{ color: 'var(--sa-success)' }}>⚡</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800 }}>{cat.name}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800 }}>{cat.qty} units</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Horizontal Quick Actions deck */}
      <div className="sa-quick-actions-bar">
        <h4 className="sa-card-title" style={{ fontSize: 10.5, marginBottom: 4 }}>Platform Quick Actions</h4>
        <div className="sa-quick-actions-grid">
          {[
            { id: 'act1', label: 'Add Banner', icon: '➕ Banners' },
            { id: 'act2', label: 'Add Category', icon: '📁 Categories' },
            { id: 'act3', label: 'Add Product', icon: '📦 Products' },
            { id: 'act4', label: 'Approve Sellers', icon: '✓ Verify Sellers' },
            { id: 'act6', label: 'Create Promo', icon: '🔥 Campaigns' },
            { id: 'act7', label: 'Send Notice', icon: '✉ Notifications' },
            { id: 'act8', label: 'View Reports', icon: '📊 Analytics' }
          ].map(act => (
            <button key={act.id} className="sa-action-btn" onClick={() => triggerToast(`Opening execution form: ${act.label}`)}>
              <span style={{ fontSize: 14 }}>{act.icon.split(' ')[0]}</span>
              <span>{act.label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
};

export default SuperAdminDashboard;
