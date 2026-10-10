import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

/**
 * A figure the server could not compute shows an em dash with the reason,
 * never a 0 or a 100% that would read as a real (and misleading) result.
 */
const Metric = ({ label, value, sub }) => (
  <div style={{ padding: '16px 20px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
    <div style={{ fontSize: 22, fontWeight: 900, color: value === null ? '#94a3b8' : '#0f172a', margin: '4px 0' }}>
      {value === null ? '—' : value}
    </div>
    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>{sub}</span>
  </div>
);

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export const SHGPerformanceTab = () => {
  const {
    shgPerformance, shgPerformanceLoading, shgPerformanceError, fetchShgPerformance,
  } = useAdmin();

  const [days, setDays] = useState(30);

  useEffect(() => { fetchShgPerformance(days); }, [fetchShgPerformance, days]);

  const summary = shgPerformance?.summary;
  const leaderboard = shgPerformance?.leaderboard || [];

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>SHG Performance &amp; Impact Report</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
            Monitor economic impact, order completion rates and product ratings for village women self-help groups.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                border: days === w.days ? '1.5px solid #10b981' : '1.5px solid #e2e8f0',
                backgroundColor: days === w.days ? '#10b981' : '#ffffff',
                color: days === w.days ? '#ffffff' : '#475569',
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {shgPerformanceError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {shgPerformanceError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <Metric
          label="Total SHG Sales"
          value={summary ? money(summary.totalSales) : null}
          sub={shgPerformanceLoading ? 'Loading…' : 'Delivered orders only'}
        />
        <Metric
          label="Total Orders Fulfilled"
          value={summary ? summary.ordersFulfilled : null}
          sub={summary ? `of ${summary.totalOrders} placed` : 'No orders in this window'}
        />
        <Metric
          label="Handmade Units Sold"
          value={summary ? summary.unitsSold : null}
          sub="Items delivered to customers"
        />
        <Metric
          label="Avg Customer Rating"
          value={summary?.avgRating ?? null}
          sub={summary?.avgRating === null || summary?.avgRating === undefined
            ? 'No reviews yet'
            : `from ${summary.reviewCount} review${summary.reviewCount === 1 ? '' : 's'}`}
        />
        <Metric
          label="Cancellation Rate"
          value={summary?.cancellationRate === null || summary?.cancellationRate === undefined
            ? null
            : `${summary.cancellationRate}%`}
          sub={summary?.cancellationRate === null || summary?.cancellationRate === undefined
            ? 'No resolved orders yet'
            : 'of orders that resolved'}
        />
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Top High Performing SHGs</h3>
          {summary?.activeStores > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
              {summary.activeStores} cooperative{summary.activeStores === 1 ? '' : 's'} with orders
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                {['Rank', 'SHG Name', 'District', 'Orders', 'Gross Sales', 'Units', 'Rating', 'SLA %'].map((c) => (
                  <th key={c} style={{ padding: '10px 12px' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shgPerformanceLoading ? (
                <tr><td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8' }}>Loading scorecards…</td></tr>
              ) : leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: '#64748b' }}>
                    No SHG orders in the last {days} days.
                  </td>
                </tr>
              ) : (
                leaderboard.map((row, idx) => (
                  <tr key={row.shgStoreId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 900, color: '#10b981' }}>#{idx + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0f172a' }}>{row.name}</td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{row.district || '—'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                      {row.orders}
                      {row.totalOrders > row.orders && (
                        <span style={{ marginLeft: 5, fontSize: 10.5, color: '#94a3b8' }}>/ {row.totalOrders}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 800 }}>{money(row.grossSales)}</td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{row.unitsSold}</td>
                    <td style={{ padding: '10px 12px', color: row.rating === null ? '#94a3b8' : '#0f172a' }}>
                      {row.rating === null ? '—' : `${row.rating} ★`}
                    </td>
                    <td style={{ padding: '10px 12px', color: row.slaPercent === null ? '#94a3b8' : '#0f172a', fontWeight: 700 }}>
                      {row.slaPercent === null ? '—' : `${row.slaPercent}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default SHGPerformanceTab;
