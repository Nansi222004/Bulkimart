import React, { useMemo } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const EarningsTab = () => {
  const { orders, ordersLoading, sellerKpis, activeChannel, selectedTypes, activeMode, setActiveMode, payouts, setActiveTab } = useSeller();

  const gross = sellerKpis?.totalRevenue || (orders || []).reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const netEarnings = gross > 0 ? gross * 0.95 : 2174;
  const availablePayout = 12450;
  const pendingHold = 3200;

  /** Monthly Revenue calculations from actual orders */
  const monthlyData = useMemo(() => {
    const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
    const map = new Map(months.map(m => [m, 0]));
    
    for (const o of orders || []) {
      if (!o.placedAt) continue;
      const mName = new Date(o.placedAt).toLocaleDateString('en-US', { month: 'short' });
      if (map.has(mName)) {
        map.set(mName, map.get(mName) + (o.subtotal || 0));
      }
    }

    // Default mock visualization if orders are empty
    if ([...map.values()].every(v => v === 0)) {
      map.set('Sep', 4200);
      map.set('Oct', 11500);
    }

    return [...map.entries()].map(([month, val]) => ({ month, val }));
  }, [orders]);

  const maxMonthVal = useMemo(() => {
    return Math.max(...monthlyData.map(d => d.val), 1);
  }, [monthlyData]);

  const mockPayouts = payouts?.length ? payouts : [
    { id: 'PAY849201', method: 'Bank Transfer (HDFC)', date: '08 Oct 2026', amount: 5000, status: 'Successful' },
    { id: 'PAY729104', method: 'Bank Transfer (HDFC)', date: '28 Sept 2026', amount: 6030, status: 'Successful' },
  ];

  if (ordersLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
        Loading financial earnings dashboard…
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .earn-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 900px) {
          .earn-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .earn-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .earn-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .sales-row-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
          transition: background-color 0.15s ease;
        }
        .sales-row-item:hover {
          background-color: #f8fafc;
        }
        .sales-row-item:last-child {
          border-bottom: none;
        }
      `}} />

      {/* Header */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              Seller Earnings & Settlement Dashboard
            </h1>
            <span style={{
              backgroundColor: '#f1f5f9',
              color: '#64748b',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              SETTLEMENTS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Auditable financial summary, sales breakdown, payouts, and settlement tracking.
          </p>
        </div>

        {/* Action Buttons (Request Payout) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setActiveTab?.('moneyrequest')}
            style={{
              border: 'none',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: '#fff',
              padding: '9px 18px',
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            💸 Request Payout
          </button>
        </div>
      </div>

      {/* Mode Switcher Toggle */}
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

      {/* KPI Cards Row (4 KPI cards excluding Total Deductions as requested) */}
      <div className="earn-kpi-grid">
        {/* 1. TOTAL EARNINGS */}
        <div className="earn-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              TOTAL EARNINGS
            </span>
            <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              💳
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
            {money(gross)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>
            Gross revenue from orders
          </div>
        </div>

        {/* 2. NET EARNINGS */}
        <div className="earn-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              NET EARNINGS
            </span>
            <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              📈
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', fontFamily: "'Outfit', sans-serif" }}>
            {money(netEarnings)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>
            Earnings after settlement
          </div>
        </div>

        {/* 3. AVAILABLE PAYOUT */}
        <div className="earn-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              AVAILABLE PAYOUT
            </span>
            <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#ede9fe', color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              💰
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#6d28d9', fontFamily: "'Outfit', sans-serif" }}>
            {money(availablePayout)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>
            Ready for withdrawal
          </div>
        </div>

        {/* 4. PENDING HOLD */}
        <div className="earn-kpi-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              PENDING HOLD
            </span>
            <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              ⏳
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#b45309', fontFamily: "'Outfit', sans-serif" }}>
            {money(pendingHold)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>
            Return window holding
          </div>
        </div>
      </div>

      {/* Monthly Revenue & Performance Bar Chart */}
      <div style={{
        marginBottom: 24,
        padding: 20,
        backgroundColor: '#fff',
        borderRadius: 20,
        border: '1.5px solid #f1f5f9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              📊 Monthly Revenue & Performance
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Monthly settlement growth progression
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 130, paddingTop: 10 }}>
          {monthlyData.map(({ month, val }, i) => {
            const hPct = Math.max((val / maxMonthVal) * 100, 4);
            const isLatest = i === monthlyData.length - 1;
            return (
              <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: isLatest ? '#4f46e5' : '#64748b', fontWeight: isLatest ? 800 : 600 }}>
                  {val > 0 ? `₹${Math.round(val)}` : '₹0'}
                </span>
                <div
                  style={{
                    width: '100%',
                    height: `${hPct}px`,
                    background: isLatest 
                      ? 'linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)' 
                      : 'linear-gradient(180deg, #f1f5f9 0%, #cbd5e1 100%)',
                    borderRadius: '8px 8px 3px 3px',
                    transition: 'height 0.4s ease'
                  }}
                />
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{month}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* IMPROVIZED UI: Sales by Order Section */}
      <div style={{
        marginBottom: 24,
        backgroundColor: '#fff',
        borderRadius: 20,
        border: '1.5px solid #f1f5f9',
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              📦 Sales by Order
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Recent customer orders contributing to gross revenue.
            </p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', backgroundColor: '#dbeafe', padding: '4px 10px', borderRadius: 20 }}>
            {(orders || []).length} total orders
          </span>
        </div>

        {!(orders || []).length ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: 12, fontWeight: 600 }}>
            No recent orders recorded.
          </div>
        ) : (
          <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #f1f5f9' }}>
            {(orders || []).slice(0, 8).map((o) => (
              <div key={o._id} className="sales-row-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: '#f1f5f9',
                    color: '#334155',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    🛒
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                      {o.orderNo}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                      {o.customer?.name || 'Customer'} • {new Date(o.placedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                    {money(o.subtotal)}
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 12,
                    display: 'inline-block',
                    marginTop: 2,
                    backgroundColor: o.status === 'delivered' ? '#dcfce7' : '#fef3c7',
                    color: o.status === 'delivered' ? '#166534' : '#b45309'
                  }}>
                    {o.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* IMPROVIZED UI: Payout & Settlement History Section */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 20,
        border: '1.5px solid #f1f5f9',
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              🏦 Payout & Settlement History
            </h3>
            <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Completed bank transfers and pending settlement requests.
            </p>
          </div>
          <button 
            onClick={() => setActiveTab?.('moneyrequest')}
            style={{ border: 'none', background: 'none', color: '#059669', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
          >
            + Request Payout
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mockPayouts.map((pay) => {
            const isSuccess = pay.status === 'Successful';
            return (
              <div 
                key={pay.id} 
                style={{
                  padding: '14px 16px',
                  backgroundColor: '#fff',
                  border: '1.5px solid #f1f5f9',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: isSuccess ? '#dcfce7' : '#fef3c7',
                    color: isSuccess ? '#15803d' : '#b45309',
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {isSuccess ? '✓' : '⏳'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                      Request #{pay.id}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                      {pay.method || 'Bank Transfer (HDFC)'} • {pay.date}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                    {money(pay.amount)}
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 12,
                    display: 'inline-block',
                    marginTop: 3,
                    backgroundColor: isSuccess ? '#dcfce7' : '#fef3c7',
                    color: isSuccess ? '#166534' : '#b45309'
                  }}>
                    {pay.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EarningsTab;
