import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Consumer Users -> Dashboard — a real summary overview, not the dummy
 * "0 Total Records" table this used to be (SectionModuleTab's generic
 * shell, `data: []` hardcoded, no backend behind it at all).
 *
 * Read-only by design — no "+ Add New Entry" (nobody hand-authors a
 * platform metric) and no "Export CSV" (there's no row-level data here to
 * export; each number is already a summary). Every figure below is a real
 * aggregate, computed fresh on every visit.
 */

const StatCard = ({ label, value, sub, color = '#0f172a' }) => (
  <div style={{ flex: '1 1 160px', backgroundColor: '#fff', border: '1px solid var(--sa-border)', borderRadius: 14, padding: 16 }}>
    <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 900, color, marginTop: 6 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>}
  </div>
);

const SectionCard = ({ title, children }) => (
  <div style={{ flex: '1 1 320px', backgroundColor: '#fff', border: '1px solid var(--sa-border)', borderRadius: 14, padding: 18 }}>
    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--sa-text-primary)', marginBottom: 14 }}>{title}</div>
    {children}
  </div>
);

const CHANNEL_LABELS = { ecommerce: 'E-Commerce', grocery: 'Quick Commerce' };

export const ConsumerDashboardTab = () => {
  const {
    consumerStats, fetchConsumerStats,
    consumerLocations, fetchConsumerLocations,
    consumerOrdersSummary, fetchConsumerOrdersSummary,
    fetchReferralCostReport,
    activityLogs, activityLogsLoading, fetchCustomerActivityLog,
    setActiveTab,
  } = useAdmin();

  const [referralReport, setReferralReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [, , , report] = await Promise.all([
      fetchConsumerStats(),
      fetchConsumerLocations(),
      fetchConsumerOrdersSummary(),
      fetchReferralCostReport(),
      fetchCustomerActivityLog({ limit: 5 }),
    ]);
    setReferralReport(report || null);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topStates = Object.entries(consumerLocations.stateCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxStateCount = topStates[0]?.[1] || 1;

  const channelRows = Object.entries(consumerOrdersSummary.byChannel || {});

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Consumer Users Ecosystem Dashboard</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Live customer growth, geographic reach, order activity, and referral program health.
          </p>
        </div>
        <button
          className="sa-btn-primary"
          style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
          onClick={loadAll}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Top stat cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label="Total Customers" value={consumerStats.total} />
        <StatCard label="Active (30d)" value={consumerStats.active} color="#166534" />
        <StatCard label="Inactive" value={consumerStats.inactive} color="#94a3b8" />
        <StatCard label="Blocked" value={consumerStats.blocked} color="#991b1b" />
        <StatCard label="CDS Verified" value={consumerStats.cdsVerified} color="#0369a1" />
        <StatCard
          label="New Signups"
          value={consumerStats.newLast7Days}
          sub={`Last 7 days · ${consumerStats.newLast30Days} in last 30 days`}
          color="#7c3aed"
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Geographic snapshot */}
        <SectionCard title="Geographic Snapshot — Top States">
          {topStates.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8' }}>No customer addresses saved yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topStates.map(([state, count]) => (
                <div key={state}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: 'var(--sa-text-primary)' }}>{state}</span>
                    <span style={{ fontWeight: 800, color: '#64748b' }}>{count}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(count / maxStateCount) * 100}%`, backgroundColor: '#0ea5e9', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Orders this month */}
        <SectionCard title="Orders This Month">
          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--sa-text-primary)' }}>{consumerOrdersSummary.totalOrders}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700 }}>TOTAL ORDERS</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#166534' }}>₹{consumerOrdersSummary.totalRevenue.toLocaleString('en-IN')}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700 }}>TOTAL REVENUE</div>
            </div>
          </div>
          {channelRows.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8' }}>No orders placed yet this month.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {channelRows.map(([channel, stats]) => (
                <div key={channel} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{CHANNEL_LABELS[channel] || channel}</span>
                  <span style={{ color: '#64748b' }}>{stats.count} orders · ₹{stats.revenue.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Referral program snapshot */}
        <SectionCard title="Referral Program">
          {referralReport ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Successful Referrals</span>
                <span style={{ fontWeight: 800 }}>{referralReport.successfulReferrals}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Coins Issued This Month</span>
                <span style={{ fontWeight: 800 }}>{referralReport.thisMonth.coins} (≈ ₹{referralReport.thisMonth.rupees.toLocaleString('en-IN')})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Milestone Bonuses Paid</span>
                <span style={{ fontWeight: 800 }}>{referralReport.milestonesPaid}</span>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#94a3b8' }}>Referral data unavailable.</p>
          )}
        </SectionCard>

        {/* Recent activity preview */}
        <SectionCard title="Recent Customer Activity">
          {activityLogsLoading ? (
            <p style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</p>
          ) : activityLogs.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8' }}>No recent activity.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activityLogs.slice(0, 5).map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{a.userName || a.userPhone || 'Buyer'}</span>
                  <span style={{ color: '#94a3b8' }}>
                    {a.timestamp ? new Date(a.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setActiveTab('user-activity')}
            style={{ marginTop: 14, fontSize: 11.5, fontWeight: 800, color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            View All Activity →
          </button>
        </SectionCard>
      </div>
    </div>
  );
};

export default ConsumerDashboardTab;
