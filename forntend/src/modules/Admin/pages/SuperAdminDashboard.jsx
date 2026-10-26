import { dashboardMoney } from '../utils/dashboardRead';
import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';
import { FinancialOverviewChart, OrderAnalyticsCharts } from '../components/DashboardCharts';

export const SuperAdminDashboard = () => {
  const { triggerToast, setActiveTab, dashboardOverviewLoading, dashboardOverviewError, dashboardFinance, dashboardFinanceError, dashboardOverview, fetchDashboardOverview } = useAdmin();

  useEffect(() => {
    fetchDashboardOverview();
  }, [fetchDashboardOverview]);

  // One definition: approved sellers from the same operational overview.
  const totalSellersCount = dashboardOverview?.totalSellers;
  const ov = dashboardOverview;

  const recentOrders = (ov?.recentOrders || []).map((o) => ({
    id: o.id || o._id || '—',
    customer: o.buyerName || 'Customer',
    type: o.type === 'grocery' ? 'Quick Commerce' : o.type === 'ecommerce' ? 'E-Commerce' : (o.type || 'Order'),
    amount: o.amount,
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

  if (dashboardOverviewLoading || (!ov && !dashboardOverviewError)) return <section role="status">Loading verified Dashboard data…</section>;
  if (dashboardOverviewError || !ov) return <section role="alert"><p>{dashboardOverviewError || 'Dashboard unavailable.'}</p><button onClick={fetchDashboardOverview}>Retry Dashboard</button></section>;
  const metricCards = [['Total Order Value','orderValue'],['Money Collected','collections'],['Bulkimart Revenue','platformRevenue']];
  return (
    <div className="sa-canvas">

      <div className="sa-overview-toolbar">
        <div>
          <h2 className="sa-section-title">Platform at a glance</h2>
          <p className="sa-overview-meta">All-time overview · INR
            {dashboardFinance && <> · Updated {new Date(dashboardFinance.asOf).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</>}
          </p>
        </div>
        <button className="sa-refresh-button" onClick={fetchDashboardOverview}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17"/></svg>
          Refresh Dashboard
        </button>
      </div>
      {dashboardFinanceError && <div className="sa-finance-notice" role="alert">{dashboardFinanceError} <button className="sa-refresh-button" onClick={fetchDashboardOverview}>Retry financial metrics</button></div>}
      <section className="sa-overview-section" aria-labelledby="sa-financial-heading">
      <div className="sa-section-heading"><h3 id="sa-financial-heading">Financial overview</h3><p>Collections are not bank settlement.</p></div>
      <div className="sa-kpi-grid sa-financial-grid">

        {metricCards.map(([title,key]) => {
          const metric=dashboardFinance?.[key];
          const hasVerifiedAmount = metric && ['complete','incomplete'].includes(metric.status);
          return <div className="sa-kpi-card sa-financial-card" key={key}>
            <span className="sa-kpi-title">{title}</span>
            <span className={`sa-kpi-value${hasVerifiedAmount ? '' : ' sa-value-unavailable'}`}>{hasVerifiedAmount ? dashboardMoney((metric.status==='complete' ? metric.amountPaise : metric.verifiedSubtotalPaise)/100) : 'Unavailable'}</span>
            {metric?.status==='incomplete' && <span className="sa-kpi-description" role="status">Verified subtotal · reconciliation pending</span>}
            <span className="sa-kpi-description">{key==='orderValue' ? 'Completed order value' : key==='collections' ? 'Verified external order collections' : 'Posted commissions and earned fees'}</span>
            <details className="sa-metric-details">
              <summary>{metric?.incompleteRecords>0 ? `${metric.incompleteRecords} records need reconciliation` : metric?.status==='complete' ? 'About this figure' : 'Why unavailable?'}</summary>
              <div className="sa-metric-explanation">
                <p>{metric?.basis || (key==='orderValue' ? 'Gross completed orders, before subsequent refunds' : key==='collections' ? 'Net verified external order collections; wallets excluded' : 'Posted merchandise commission and earned fees')}</p>
                {metric && metric.status!=='complete' && <p>Verified records subtotal: {dashboardMoney(metric.verifiedSubtotalPaise/100)}. The final total requires reconciliation.</p>}
                {metric?.breakdown && <p>Order commission: {dashboardMoney(metric.breakdown.orderCommissionPaise/100)}; parcel income: {dashboardMoney(metric.breakdown.parcelRevenuePaise/100)}; advertising income: {dashboardMoney(metric.breakdown.advertisingRevenuePaise/100)}.</p>}
                {metric?.issues?.length>0 && <ul>{metric.issues.map(issue => <li key={issue.code}>{issue.count} × {issue.message} {issue.resolution}</li>)}</ul>}
                {metric?.incompleteRecords>0 && <button type="button" className="sa-refresh-button" onClick={() => setActiveTab('finance-center')}>Open Finance Center</button>}
                {metric?.excludedRecords>0 && <p>{metric.excludedRecords} unverified or out-of-scope records excluded.</p>}
                {metric?.blocker && <p>{metric.blocker}</p>}
              </div>
            </details>
          </div>;
        })}
      </div>
      </section>
      <section className="sa-overview-section" aria-labelledby="sa-activity-heading">
      <div className="sa-section-heading"><h3 id="sa-activity-heading">Platform activity</h3><p>Orders, customers and sellers</p></div>
      <div className="sa-kpi-grid sa-activity-grid">
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

        <button type="button" className="sa-kpi-card sa-kpi-link" onClick={() => setActiveTab('users')}>
          <span className="sa-kpi-title">Total Users</span>
          <span className="sa-kpi-value">{ov?.totalUsers || 0}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>View customers →</span>
        </button>

        <button type="button" className="sa-kpi-card sa-kpi-link" onClick={() => setActiveTab('sellers')}>
          <span className="sa-kpi-title">Total Sellers</span>
          <span className="sa-kpi-value">{totalSellersCount}</span>
          <span className="sa-kpi-trend" style={{ color: 'var(--sa-text-muted)' }}>Approved · {ov.pendingSellers} pending →</span>
        </button>

      </div>
      </section>

      {/* All-time comparisons/distributions; no invented temporal series. */}
      <div className="sa-charts-row">
        <FinancialOverviewChart finance={dashboardFinance} error={dashboardFinanceError} loading={dashboardOverviewLoading} onRetry={fetchDashboardOverview} />
        <OrderAnalyticsCharts />
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
                  <span className="sa-widget-value">Order amount: {dashboardMoney(order.amount)}</span>
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
