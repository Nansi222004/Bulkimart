import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';

export const SHGDashboardTab = () => {
  const {
    setActiveTab,
    shgVendors,
    shgVendorsLoading,
    fetchShgVendors,
    shgProducts,
    shgProductsLoading,
    fetchShgProducts,
    shgPerformance,
    shgPerformanceLoading,
    fetchShgPerformance
  } = useAdmin();

  useEffect(() => {
    fetchShgVendors('all');
    fetchShgProducts({ status: 'all' });
    fetchShgPerformance(30);
  }, [fetchShgVendors, fetchShgProducts, fetchShgPerformance]);

  const vendorsList = shgVendors || [];
  const productsList = shgProducts || [];
  const performanceSummary = shgPerformance?.summary || {};
  const leaderboard = shgPerformance?.leaderboard || [];

  const totalSHGs = vendorsList.length;
  const pendingSHGs = vendorsList.filter(s => (s.status || '').toLowerCase() === 'pending').length;
  const approvedSHGs = vendorsList.filter(s => (s.status || '').toLowerCase() === 'approved').length;
  const rejectedSHGs = vendorsList.filter(s => (s.status || '').toLowerCase() === 'rejected').length;
  const suspendedSHGs = vendorsList.filter(s => (s.status || '').toLowerCase() === 'suspended').length;

  const totalProducts = productsList.length;
  const pendingProducts = productsList.filter(p => (p.status || '').toLowerCase() === 'pending').length;
  const approvedProducts = productsList.filter(p => (p.status || '').toLowerCase() === 'approved').length;
  const rejectedProducts = productsList.filter(p => (p.status || '').toLowerCase() === 'rejected').length;

  const shgOrdersCount = performanceSummary.totalOrders ?? performanceSummary.ordersFulfilled ?? 0;
  const approvedSHGList = vendorsList.filter(s => (s.status || '').toLowerCase() === 'approved');

  // Compute category distribution for product activity
  const categoryCounts = productsList.reduce((acc, p) => {
    const catName = p.category && p.category !== '—' ? p.category : 'General';
    acc[catName] = (acc[catName] || 0) + 1;
    return acc;
  }, {});

  const totalAttentionCount = pendingSHGs + pendingProducts;

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* 6 KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        
        <div 
          onClick={() => setActiveTab('shg-all')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total SHGs</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
            {shgVendorsLoading ? '…' : totalSHGs}
          </div>
          <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>Active in DB</span>
        </div>

        <div 
          onClick={() => setActiveTab('shg-pending')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#fffbe6', border: '1px solid #ffe58f', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#d48806', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pending Applications</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#d48806', margin: '4px 0' }}>
            {shgVendorsLoading ? '…' : pendingSHGs}
          </div>
          <span style={{ fontSize: 11, color: '#d48806', fontWeight: 700 }}>Requires Review</span>
        </div>

        <div 
          onClick={() => setActiveTab('shg-approved')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Approved SHGs</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', margin: '4px 0' }}>
            {shgVendorsLoading ? '…' : approvedSHGs}
          </div>
          <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>Active Cooperatives</span>
        </div>

        <div 
          onClick={() => setActiveTab('shg-products')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Products</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
            {shgProductsLoading ? '…' : totalProducts}
          </div>
          <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 700 }}>Active Catalog</span>
        </div>

        <div 
          onClick={() => setActiveTab('shg-product-approval')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pending Approvals</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', margin: '4px 0' }}>
            {shgProductsLoading ? '…' : pendingProducts}
          </div>
          <span style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 700 }}>Listing Audits</span>
        </div>

        <div 
          onClick={() => setActiveTab('shg-orders')}
          style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SHG Orders</span>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
            {shgPerformanceLoading ? '…' : shgOrdersCount}
          </div>
          <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>Active Volume</span>
        </div>

      </div>

      {/* Requires Attention Alert Panel */}
      {totalAttentionCount > 0 ? (
        <div style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#fff7ed', border: '1px solid #ffedd5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#f97316', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16 }}>
              ⚠
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#c2410c' }}>Requires Admin Attention</h4>
              <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#9a3412' }}>
                <strong>
                  {pendingSHGs > 0 ? `${pendingSHGs} SHG application${pendingSHGs > 1 ? 's' : ''} pending review` : ''}
                  {pendingSHGs > 0 && pendingProducts > 0 ? ' and ' : ''}
                  {pendingProducts > 0 ? `${pendingProducts} product listing audit${pendingProducts > 1 ? 's' : ''} pending approval` : ''}
                </strong>.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {pendingSHGs > 0 && (
              <button 
                onClick={() => setActiveTab('shg-pending')}
                style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#ea580c', color: '#ffffff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
              >
                Review SHGs ({pendingSHGs}) →
              </button>
            )}
            {pendingProducts > 0 && (
              <button 
                onClick={() => setActiveTab('shg-product-approval')}
                style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#1d4ed8', color: '#ffffff', border: 'none', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
              >
                Audit Listings ({pendingProducts}) →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: '14px 20px', borderRadius: 12, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, color: '#16a34a' }}>✓</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
            All SHG applications and product listing audits are up to date.
          </span>
        </div>
      )}

      {/* Analytics Charts & Business Performance Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        
        {/* Card 1: SHG Registration Breakdown */}
        <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>SHG Status Breakdown</h3>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>Live DB Data</span>
          </div>

          {shgVendorsLoading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading registration statistics…</div>
          ) : totalSHGs === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: 12 }}>No trend data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Approved Cooperatives', count: approvedSHGs, color: '#10b981', bg: '#ecfdf5' },
                { label: 'Pending Review', count: pendingSHGs, color: '#f59e0b', bg: '#fffbeb' },
                { label: 'Rejected Applications', count: rejectedSHGs, color: '#ef4444', bg: '#fef2f2' },
                { label: 'Suspended Accounts', count: suspendedSHGs, color: '#6b7280', bg: '#f3f4f6' },
              ].map((item) => {
                const percentage = totalSHGs > 0 ? Math.round((item.count / totalSHGs) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                      <span>{item.label}</span>
                      <span>{item.count} ({percentage}%)</span>
                    </div>
                    <div style={{ height: 8, width: '100%', backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percentage}%`, backgroundColor: item.color, borderRadius: 4, transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card 2: SHG Product Activity & Category Distribution */}
        <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Product Listing Activity</h3>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>Catalog Overview</span>
          </div>

          {shgProductsLoading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading catalog statistics…</div>
          ) : totalProducts === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: 12 }}>No listing activity found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Approval status breakdown bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
                  <span>Status Distribution</span>
                  <span>{approvedProducts} Live / {pendingProducts} Pending</span>
                </div>
                <div style={{ height: 10, width: '100%', backgroundColor: '#f1f5f9', borderRadius: 5, display: 'flex', overflow: 'hidden' }}>
                  <div style={{ width: `${totalProducts > 0 ? (approvedProducts / totalProducts) * 100 : 0}%`, backgroundColor: '#10b981' }} title={`Approved: ${approvedProducts}`} />
                  <div style={{ width: `${totalProducts > 0 ? (pendingProducts / totalProducts) * 100 : 0}%`, backgroundColor: '#3b82f6' }} title={`Pending: ${pendingProducts}`} />
                  <div style={{ width: `${totalProducts > 0 ? (rejectedProducts / totalProducts) * 100 : 0}%`, backgroundColor: '#ef4444' }} title={`Rejected: ${rejectedProducts}`} />
                </div>
              </div>

              {/* Categories list */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Top Product Categories</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(categoryCounts).slice(0, 6).map(([cat, count]) => (
                    <span key={cat} style={{ padding: '4px 10px', borderRadius: 20, backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#334155' }}>
                      {cat}: <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Top Performing SHGs and Top Bestsellers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        
        {/* Top Performing / Active SHGs */}
        <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Active SHG Store List</h3>
            <button onClick={() => setActiveTab('shg-all')} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>View All →</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shgVendorsLoading ? (
              <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Loading SHG stores…</div>
            ) : approvedSHGList.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: '20px 0' }}>No active SHG stores.</div>
            ) : (
              approvedSHGList.slice(0, 5).map((shg, idx) => (
                <div key={shg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, backgroundColor: '#f8fafc', border: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>#{idx + 1} {shg.groupName}</div>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Leader: {shg.leaderName} • {shg.district || 'Location N/A'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, backgroundColor: '#dcfce7', color: '#15803d' }}>
                      {shg.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Products / Catalog */}
        <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>SHG Product Catalog</h3>
            <button onClick={() => setActiveTab('shg-products')} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Catalog →</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shgProductsLoading ? (
              <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Loading products…</div>
            ) : productsList.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: '20px 0' }}>No product data available.</div>
            ) : (
              productsList.slice(0, 5).map((p, idx) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, backgroundColor: '#f8fafc', border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {p.image ? (
                      <img src={p.image} alt={p.name} style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📦</div>
                    )}
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>{p.name}</div>
                      <span style={{ fontSize: 10.5, color: '#64748b' }}>{p.shgName} • {p.category}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>
                      {p.price !== null ? `₹${p.price}` : '—'}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: p.status === 'approved' ? '#10b981' : '#f59e0b' }}>
                      {p.status ? p.status.toUpperCase() : 'PENDING'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};

export default SHGDashboardTab;

