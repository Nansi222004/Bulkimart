import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

export const OverviewTab = () => {
  const { sellerCounts, fetchSellerCounts, products, payouts, tickets, logs, setActiveTab } = useAdmin();

  // Vendor numbers come from the API (GET /api/admin/dashboard/pending-counts),
  // not from whatever happens to be loaded in the vendors list.
  useEffect(() => { fetchSellerCounts(); }, [fetchSellerCounts]);

  // Compute Platform stats
  // No GMV endpoint exists yet — showing an invented figure here would be
  // reporting revenue nobody actually earned. 0 until a real one is wired up.
  const totalSales = 0;
  const activeSellersCount = sellerCounts.approved || 0;
  const totalSellersCount = (sellerCounts.approved || 0) + (sellerCounts.pending || 0);

  const pendingSellersCount = sellerCounts.pending || 0;
  // Products are published live by their seller — nothing sits waiting for an
  // admin — so what is worth surfacing is listings that were taken down.
  const takenDownCount = products.filter((p) => p.status === 'rejected').length;
  const pendingPayoutsCount = payouts.filter(p => p.status === 'Pending').length;
  const pendingActionsCount = pendingSellersCount + takenDownCount + pendingPayoutsCount;
  
  const openTicketsCount = tickets.filter(t => t.status === 'Open').length;

  return (
    <div className="admin-dashboard-tab-grid">
      
      {/* 4 Stats Cards */}
      <div className="admin-kpi-grid">
        
        <div className="admin-kpi-card">
          <h4 className="admin-kpi-title">Gross Platform GMV</h4>
          <p className="admin-kpi-value" style={{ fontSize: 18 }}>₹{totalSales.toLocaleString('en-IN')}</p>
          <span className="admin-kpi-subtext" style={{ fontSize: 9, display: 'block', color: 'var(--admin-text-secondary)', marginTop: 4 }}>
            No GMV data source yet
          </span>
        </div>

        <div className="admin-kpi-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('sellers')}>
          <h4 className="admin-kpi-title">Active Sellers</h4>
          <p className="admin-kpi-value">{activeSellersCount}</p>
          <span className="admin-kpi-subtext" style={{ color: 'var(--admin-info)' }}>{totalSellersCount} total registered</span>
        </div>

        <div className="admin-kpi-card">
          <h4 className="admin-kpi-title">Pending Approvals</h4>
          <p className="admin-kpi-value">{pendingActionsCount}</p>
          <span className="admin-kpi-subtext warning">
            {pendingSellersCount} sellers • {takenDownCount} prd
          </span>
        </div>

        <div className="admin-kpi-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('tickets')}>
          <h4 className="admin-kpi-title">Open Tickets</h4>
          <p className="admin-kpi-value">{openTicketsCount}</p>
          <span className="admin-kpi-subtext warning" style={{ color: openTicketsCount > 0 ? 'var(--admin-error)' : 'var(--admin-success)' }}>
            {openTicketsCount > 0 ? 'Requires attention' : 'All clear'}
          </span>
        </div>

      </div>

      {/* Sales performance chart card — no GMV-over-time endpoint exists yet,
          so this shows an honest empty state instead of an invented trend line. */}
      <div className="admin-chart-card">
        <div className="admin-chart-header">
          <h3 className="admin-chart-title">Commerce Performance Channels</h3>
        </div>
        <div className="admin-chart-svg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-secondary)', fontSize: 12 }}>
          No sales trend data available yet.
        </div>
      </div>

      {/* System Activity Logs list */}
      <div className="admin-recent-logs-card">
        <h3 className="admin-chart-title" style={{ marginBottom: 12 }}>System Audit Trail</h3>
        <div className="admin-log-list">
          {logs.map(log => (
            <div key={log.id} className="admin-log-item">
              <span className="admin-log-text">{log.text}</span>
              <span className="admin-log-time">{log.time}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default OverviewTab;
