import React from 'react';
import { useSHG } from '../context/SHGContext';

const MODE_TITLE = { shg: 'SHG Store', ecommerce: 'Ecommerce', quick: 'Quick Commerce' };

const SHGDashboardTab = () => {
  const { products, orders, members, payouts, dashboardKpis, activeMode, groupForm } = useSHG();

  // KPIs come from the server (GET /api/shg/dashboard?type=...) when
  // available — it counts products/orders scoped to the active storefront,
  // which this component can't reproduce client-side (the products/orders
  // lists here are ALSO already scoped the same way, so both agree; the
  // fallback below only matters for the first render before the fetch lands).
  const activeProducts = dashboardKpis?.productsCount ?? products.filter(p => p.status === 'Active').length;
  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const activeMembers = dashboardKpis?.membersCount ?? members.filter(m => m.status === 'Active').length;
  const totalOrders = dashboardKpis?.totalOrders ?? orders.length;
  const totalEarnings = payouts.reduce((sum, p) => p.status === 'Successful' ? sum + p.amount : sum, 0);

  return (
    <div className="shg-tab-content">
      {/* Welcome Banner */}
      <div className="shg-section" style={{ paddingTop: 16 }}>
        <div style={{ background: 'var(--shg-primary-light)', padding: 18, borderRadius: 'var(--shg-radius-md)', border: '1.5px solid var(--shg-primary-mid)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="shg-member-badge" style={{ margin: 0, width: 'fit-content' }}>
            ✨ Certified Self Help Group
          </div>
          <h3 style={{ margin: '4px 0 0 0', fontSize: 18, color: 'var(--shg-primary)' }}>Welcome Back, {groupForm?.groupName || 'SHG Group'}!</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--shg-text-secondary)', lineHeight: 1.4 }}>
            Viewing your <strong>{MODE_TITLE[activeMode] || 'SHG Store'}</strong> performance — listings, orders and members scoped to this storefront.
          </p>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="shg-section">
        <h4 className="shg-section-title">Today's Overview</h4>
        <div className="shg-kpi-grid">
          <div className="shg-kpi-card">
            <div className="shg-kpi-icon purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <span className="shg-kpi-value">₹{totalEarnings.toLocaleString('en-IN')}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="shg-kpi-label">Total Sales</span>
            </div>
          </div>

          <div className="shg-kpi-card">
            <div className="shg-kpi-icon gold">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <span className="shg-kpi-value">{totalOrders}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="shg-kpi-label">Total Orders</span>
              <span className="shg-kpi-trend">{pendingOrders} pending</span>
            </div>
          </div>

          <div className="shg-kpi-card">
            <div className="shg-kpi-icon green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span className="shg-kpi-value">{activeProducts}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="shg-kpi-label">Live Listings</span>
              <span className="shg-kpi-trend">Approved</span>
            </div>
          </div>

          <div className="shg-kpi-card">
            <div className="shg-kpi-icon blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
            </div>
            <span className="shg-kpi-value">{activeMembers}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="shg-kpi-label">Members</span>
              <span className="shg-kpi-trend">Active</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SHGDashboardTab;
