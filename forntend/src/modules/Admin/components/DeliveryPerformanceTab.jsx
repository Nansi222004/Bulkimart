import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

const VEHICLE_LABEL = { bicycle: 'Bicycle', bike: 'Bike', auto: 'Auto', car: 'Car' };

/**
 * A figure the server could not compute reads as an em dash with a reason,
 * never as 0 or 100%. A rate over zero resolved offers is not "0% accepted",
 * and showing it that way would have an admin acting on a rider's supposed
 * refusal to work when nothing was ever offered to them.
 */
const Metric = ({ label, value, sub }) => (
  <div style={{ padding: '16px 18px', borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
    <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
    <div style={{ fontSize: 22, fontWeight: 900, color: value === null ? '#94a3b8' : '#0f172a', margin: '4px 0' }}>
      {value === null ? '—' : value}
    </div>
    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{sub}</span>
  </div>
);

export const DeliveryPerformanceTab = () => {
  const {
    deliveryPerformance, deliveryPerformanceLoading, deliveryPerformanceError,
    fetchDeliveryPerformance,
  } = useAdmin();

  const [days, setDays] = useState(30);

  useEffect(() => { fetchDeliveryPerformance(days); }, [fetchDeliveryPerformance, days]);

  const summary = deliveryPerformance?.summary;
  const leaderboard = deliveryPerformance?.leaderboard || [];

  const rate = (v) => (v === null || v === undefined ? null : `${v}%`);
  const mins = (v) => (v === null || v === undefined ? null : `${v} min`);

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Delivery Fleet Performance &amp; SLA Scorecard</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Evaluate overall logistics speed, acceptance rates, cancellation ratios, and individual rider scorecards.</p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                border: days === w.days ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                backgroundColor: days === w.days ? '#2563eb' : '#ffffff',
                color: days === w.days ? '#ffffff' : '#475569',
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {deliveryPerformanceError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {deliveryPerformanceError}
        </div>
      )}

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
        <Metric
          label="Total Deliveries"
          value={summary ? summary.totalDeliveries : null}
          sub={deliveryPerformanceLoading ? 'Loading…' : `Trips assigned in ${days} days`}
        />
        <Metric
          label="Successful Jobs"
          value={summary ? summary.successfulJobs : null}
          sub={summary?.successRate !== null && summary?.successRate !== undefined
            ? `${summary.successRate}% of all trips`
            : 'No trips in this window'}
        />
        <Metric
          label="Avg Delivery Time"
          value={summary ? mins(summary.avgDeliveryMinutes) : null}
          sub={summary?.avgDeliveryMinutes === null ? 'No timed trips yet' : 'Accept → delivered'}
        />
        <Metric
          label="Acceptance Rate"
          value={summary ? rate(summary.acceptanceRate) : null}
          sub={summary?.acceptanceRate === null ? 'No offers answered yet' : 'Accepted vs. answered offers'}
        />
        <Metric
          label="Cancellation Rate"
          value={summary ? rate(summary.cancellationRate) : null}
          sub={summary?.cancellationRate === null ? 'No trips in this window' : 'Rider cancelled before pickup'}
        />
        {/*
          Riders are never rated today — nothing writes DeliveryPartner.rating.
          Saying so is more useful than a 0 that reads like every rider scored
          badly.
        */}
        <Metric label="Customer Rating" value={null} sub="Rider ratings not collected yet" />
      </div>

      {/* Rider Performance Scorecard Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Top Delivery Partners Leaderboard</h3>
          {summary?.activeRiders > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
              {summary.activeRiders} rider{summary.activeRiders === 1 ? '' : 's'} active in this window
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                <th style={{ padding: '10px 12px' }}>Rank</th>
                <th style={{ padding: '10px 12px' }}>Partner Name</th>
                <th style={{ padding: '10px 12px' }}>Vehicle</th>
                <th style={{ padding: '10px 12px' }}>Completed Jobs</th>
                <th style={{ padding: '10px 12px' }}>Avg Time</th>
                <th style={{ padding: '10px 12px' }}>Acceptance Rate</th>
                <th style={{ padding: '10px 12px' }}>Earnings</th>
                <th style={{ padding: '10px 12px' }}>Tips</th>
              </tr>
            </thead>
            <tbody>
              {deliveryPerformanceLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8' }}>Loading rider scorecards…</td>
                </tr>
              ) : leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8' }}>
                    No deliveries in the last {days} days.
                  </td>
                </tr>
              ) : (
                leaderboard.map((r, i) => (
                  <tr key={r.partnerId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#475569' }}>#{i + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>{r.name}</td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>
                      {r.vehicleType ? (VEHICLE_LABEL[r.vehicleType] || r.vehicleType) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                      {r.completedJobs}
                      {r.cancelledJobs > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10.5, color: '#b45309', fontWeight: 700 }}>
                          ({r.cancelledJobs} cancelled)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: r.avgMinutes === null ? '#94a3b8' : '#0f172a' }}>
                      {r.avgMinutes === null ? '—' : `${r.avgMinutes} min`}
                    </td>
                    <td style={{ padding: '10px 12px', color: r.acceptanceRate === null ? '#94a3b8' : '#0f172a' }}>
                      {r.acceptanceRate === null ? '—' : `${r.acceptanceRate}%`}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>₹{r.earnings}</td>
                    <td style={{ padding: '10px 12px', color: r.tips > 0 ? '#15803d' : '#94a3b8', fontWeight: 700 }}>
                      {r.tips > 0 ? `₹${r.tips}` : '—'}
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

export default DeliveryPerformanceTab;
