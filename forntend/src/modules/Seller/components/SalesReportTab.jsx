import React, { useMemo } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SalesReportTab = () => {
  const { orders, ordersLoading, sellerKpis, activeChannel, selectedTypes, activeMode, setActiveMode, orderListState } = useSeller();
  const allStorefronts = orderListState?.scope === 'all';

  /** Top products, summed across this seller's line items. */
  const topProducts = useMemo(() => {
    const tally = new Map();
    for (const o of orders || []) {
      for (const i of o.items || []) {
        const key = String(i.productId || i.name);
        const prev = tally.get(key) || { name: i.name, image: i.image, sales: 0, units: 0 };
        tally.set(key, {
          name: i.name,
          image: i.image || prev.image,
          sales: prev.sales + (i.lineTotal || 0),
          units: prev.units + (i.qty || 0),
        });
      }
    }
    return [...tally.values()].sort((a, b) => b.sales - a.sales).slice(0, 10);
  }, [orders]);

  const maxSales = useMemo(() => {
    return topProducts.length > 0 ? Math.max(...topProducts.map(p => p.sales), 1) : 1;
  }, [topProducts]);

  const totalTopSales = useMemo(() => {
    return topProducts.reduce((sum, p) => sum + p.sales, 0);
  }, [topProducts]);

  const totalTopUnits = useMemo(() => {
    return topProducts.reduce((sum, p) => sum + p.units, 0);
  }, [topProducts]);

  /** Revenue per day, from the orders themselves. */
  const daily = useMemo(() => {
    const byDay = new Map();
    for (const o of orders || []) {
      const day = new Date(o.placedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      byDay.set(day, (byDay.get(day) || 0) + (o.subtotal || 0));
    }
    return [...byDay.entries()].reverse().slice(-10);
  }, [orders]);

  const maxDay = daily.length > 0 ? Math.max(...daily.map(([, v]) => v), 1) : 1;

  if (ordersLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
        Loading live sales analytics…
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .sales-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .sales-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .sales-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .sales-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .top-prod-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 10px;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .top-prod-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
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
              Sales Report
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
              ANALYTICS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Overview of store revenue, daily sales trend, and top performing products.
          </p>
        </div>
      </div>

      {/* Mode Switcher Toggle */}
      {!allStorefronts && selectedTypes && selectedTypes.includes('ecommerce') && selectedTypes.includes('quick') && (
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

      {!orders?.length ? (
        <EmptyState
          icon="📊"
          title="No sales to report"
          message={`Once you have orders on ${activeChannel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}, your revenue, best sellers and daily trend appear here.`}
        />
      ) : (
        <>
          {/* KPI Summary Cards */}
          <p style={{ fontSize: 12, color: '#64748b' }}>Summary across all storefronts. Product and daily lists cover {allStorefronts ? 'all storefronts' : activeMode === 'quick' ? 'Quick Commerce' : 'Shop All'}.</p>
          <div className="sales-kpi-grid">
            {[
              { label: 'Gross Revenue', value: money(sellerKpis?.totalRevenue), color: '#10b981', bg: '#dcfce7', icon: '💰' },
              { label: 'Orders', value: String(sellerKpis?.totalOrders || 0), color: '#3b82f6', bg: '#dbeafe', icon: '📦' },
              { label: 'Avg Order Value', value: money(sellerKpis?.avgOrderValue), color: '#8b5cf6', bg: '#ede9fe', icon: '📈' },
              { label: 'Awaiting Handover', value: String(sellerKpis?.pendingOrders || 0), color: '#f59e0b', bg: '#fef3c7', icon: '⏳' },
            ].map((m) => (
              <div key={m.label} className="sales-kpi-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {m.label}
                  </span>
                  <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                    {m.icon}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Revenue By Day Bar Chart */}
          {daily.length > 1 && (
            <div style={{ marginBottom: 24, padding: 20, backgroundColor: '#fff', borderRadius: 18, border: '1.5px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Revenue Trend by Day</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: 11, color: '#64748b', fontWeight: 500 }}>Recent daily sales progression</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110, paddingTop: 10 }}>
                {daily.map(([day, val], i) => {
                  const barHeight = Math.max((val / maxDay) * 80, 4);
                  const isLatest = i === daily.length - 1;
                  return (
                    <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, color: isLatest ? '#0f172a' : '#64748b', fontWeight: isLatest ? 800 : 600 }}>
                        ₹{Math.round(val)}
                      </span>
                      <div
                        style={{
                          width: '100%',
                          height: `${barHeight}px`,
                          background: isLatest 
                            ? 'linear-gradient(180deg, #10b981 0%, #059669 100%)' 
                            : 'linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%)',
                          borderRadius: '6px 6px 2px 2px',
                          transition: 'height 0.3s ease'
                        }}
                      />
                      <span style={{ fontSize: 9, color: '#64748b', fontWeight: 700 }}>{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TOP PERFORMING PRODUCTS SECTION */}
          <div style={{
            marginBottom: 24,
            backgroundColor: '#fff',
            borderRadius: 20,
            border: '1.5px solid #f1f5f9',
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
          }}>
            {/* Section Header */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              gap: 12
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                    🔥 Top Performing Products
                  </h3>
                  <span style={{
                    backgroundColor: '#fef3c7',
                    color: '#b45309',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 12
                  }}>
                    BESTSELLERS
                  </span>
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                  Highest revenue generating items across your orders.
                </p>
              </div>

              {/* Sub-summary Pills */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Top Revenue</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#10b981' }}>{money(totalTopSales)}</div>
                </div>
                <div style={{ backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Units Sold</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#3b82f6' }}>{totalTopUnits} units</div>
                </div>
              </div>
            </div>

            {/* Product Cards List */}
            {topProducts.length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: 12, fontWeight: 600 }}>
                No product sales recorded yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topProducts.map((p, idx) => {
                  const pct = Math.round((p.sales / maxSales) * 100);
                  const isGold = idx === 0;
                  const isSilver = idx === 1;
                  const isBronze = idx === 2;

                  const badgeBg = isGold ? '#fef3c7' : isSilver ? '#f1f5f9' : isBronze ? '#ffedd5' : '#f8fafc';
                  const badgeFg = isGold ? '#b45309' : isSilver ? '#475569' : isBronze ? '#c2410c' : '#64748b';
                  const rankIcon = isGold ? '🥇' : isSilver ? '🥈' : isBronze ? '🥉' : `#${idx + 1}`;

                  return (
                    <div key={p.name} className="top-prod-card">
                      {/* Left: Rank & Image/Avatar & Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                        {/* Rank Badge */}
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          backgroundColor: badgeBg,
                          color: badgeFg,
                          fontSize: 12,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {rankIcon}
                        </div>

                        {/* Product Image / Icon Avatar */}
                        {p.image ? (
                          <img 
                            src={p.image} 
                            alt={p.name} 
                            style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', border: '1px solid #e2e8f0', flexShrink: 0 }} 
                          />
                        ) : (
                          <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            backgroundColor: '#f1f5f9',
                            color: '#475569',
                            fontSize: 14,
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            📦
                          </div>
                        )}

                        {/* Name & Progress Bar */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p.name}
                          </div>
                          {/* Relative Sales Progress Bar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <div style={{ flex: 1, maxWidth: 160, height: 6, backgroundColor: '#f1f5f9', borderRadius: 10, overflow: 'hidden' }}>
                              <div style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: isGold 
                                  ? 'linear-gradient(90deg, #f59e0b, #d97706)' 
                                  : 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                                borderRadius: 10,
                                transition: 'width 0.4s ease'
                              }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>
                              {pct}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Revenue & Units Sold */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                          {money(p.sales)}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 2 }}>
                          {p.units} {p.units === 1 ? 'unit' : 'units'} sold
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SalesReportTab;
