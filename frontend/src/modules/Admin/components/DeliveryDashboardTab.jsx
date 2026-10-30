import React, { useEffect } from 'react';
import { useAdmin } from '../context/AdminContext';
import { useLiveDispatch, STAGE_LABELS, formatClock } from '../utils/liveDispatch';

/**
 * Fleet dashboard — roster from GET /api/admin/delivery-partners/stats, live
 * dispatch from GET /api/admin/delivery-live.
 *
 * Everything here is a real count. An invented figure on an operations screen
 * is worse than a blank one: it gets acted on.
 */

const DispatchStat = ({ label, value, hint, tone = '#0f172a', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', cursor: onClick ? 'pointer' : 'default', font: 'inherit' }}
  >
    <span style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
    <span style={{ display: 'block', fontSize: 20, fontWeight: 900, color: tone, margin: '2px 0' }}>{value}</span>
    {hint && <span style={{ display: 'block', fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>{hint}</span>}
  </button>
);

export const LiveDispatchPanel = ({ setActiveTab }) => {
  const { data, loading, error, reload } = useLiveDispatch();
  const s = data?.summary;
  const pct = (value) => (value === null || value === undefined ? '—' : `${value}%`);

  return (
    <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Live Dispatch</h3>
          <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>
            {data ? `Updated ${formatClock(data.asOf)} · refreshes every 30s` : 'Live trips and riders on shift'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('delivery-active-ops')}
          style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
        >
          Active Deliveries →
        </button>
      </div>

      {error && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{error}</span>
          <button type="button" onClick={reload} style={{ background: 'none', border: 'none', color: '#b91c1c', fontWeight: 800, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!s ? (
        !error && <div style={{ fontSize: 12, color: '#64748b' }}>{loading ? 'Loading…' : 'No data'}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <DispatchStat label="Active trips" value={s.activeTrips} hint={`${s.prePickup} before pickup · ${s.onTheRoad} on the road`} onClick={() => setActiveTab('delivery-active-ops')} />
            <DispatchStat
              label="Awaiting rider"
              value={s.awaitingRider}
              hint={s.needsManualAssignment ? `${s.needsManualAssignment} need manual assignment` : 'Paid orders ready to go'}
              tone={s.awaitingRider ? '#d48806' : '#0f172a'}
              onClick={() => setActiveTab('delivery-assignment')}
            />
            <DispatchStat label="Past ETA" value={s.overEta} hint="Picked up longer than the trip estimate" tone={s.overEta ? '#dc2626' : '#0f172a'} onClick={() => setActiveTab('delivery-tracking')} />
            <DispatchStat label="Riders free" value={s.ridersFree} hint={`${s.ridersOnline} online · ${s.ridersBusy} on a trip`} tone="#16a34a" onClick={() => setActiveTab('delivery-active')} />
            <DispatchStat label="Delivered today" value={s.deliveredToday} hint={`${s.failedToday} failed · ${pct(s.todaySuccessRate)} success`} onClick={() => setActiveTab('delivery-history')} />
          </div>

          {s.activeTrips > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(s.byStage).filter(([, count]) => count > 0).map(([stage, count]) => (
                <span key={stage} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#f1f5f9', color: '#334155' }}>
                  {STAGE_LABELS[stage] || stage}: {count}
                </span>
              ))}
            </div>
          )}
          <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>
            Covers rider trips for orders, return pickups and subscriptions. Courier (Shiprocket) shipments and parcel bookings have their own screens. “Today” is the IST calendar day.
          </p>
        </>
      )}
    </div>
  );
};

const Kpi = ({ label, value, hint, tone = 'plain', onClick }) => {
  const tones = {
    plain:  { bg: '#ffffff', border: '#e2e8f0', value: '#0f172a', hint: '#10b981' },
    good:   { bg: '#f0fdf4', border: '#bbf7d0', value: '#16a34a', hint: '#15803d' },
    warn:   { bg: '#fffbe6', border: '#ffe58f', value: '#d48806', hint: '#d48806' },
    danger: { bg: '#fef2f2', border: '#fecaca', value: '#dc2626', hint: '#b91c1c' },
    muted:  { bg: '#f8fafc', border: '#e2e8f0', value: '#64748b', hint: '#64748b' },
  }[tone];

  return (
    <div
      onClick={onClick}
      style={{
        padding: '16px 18px', borderRadius: 12,
        backgroundColor: tones.bg, border: `1px solid ${tones.border}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ fontSize: 22, fontWeight: 900, color: tones.value, margin: '4px 0' }}>{value}</div>
      <span style={{ fontSize: 10, color: tones.hint, fontWeight: 700 }}>{hint}</span>
    </div>
  );
};

export const DeliveryDashboardTab = () => {
  const { setActiveTab, fleetStats, fetchFleetStats } = useAdmin();

  useEffect(() => { fetchFleetStats(); }, [fetchFleetStats]);

  const s = fleetStats;
  const n = (v) => (s ? v : '—');

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            Delivery Fleet
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
            Partner applications, verification queue and fleet strength.
          </p>
        </div>
        <button
          type="button"
          className="admin-btn-sm details icon-only"
          onClick={fetchFleetStats}
          title="Refresh fleet stats"
          aria-label="Refresh fleet stats"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
        <Kpi
          label="Approved Fleet"
          value={n(s?.fleet)}
          hint="Can be sent out"
          tone="good"
          onClick={() => setActiveTab('delivery-active')}
        />
        <Kpi
          label="Pending Verification"
          value={n(s?.pending)}
          hint={s?.pending ? 'Waiting on you' : 'Queue is clear'}
          tone={s?.pending ? 'warn' : 'plain'}
          onClick={() => setActiveTab('delivery-pending')}
        />
        <Kpi
          label="Available Now"
          value={n(s?.available)}
          hint="Online in the rider app"
          tone="plain"
          onClick={() => setActiveTab('delivery-active')}
        />
        <Kpi
          label="Offline"
          value={n(s?.offline)}
          hint="Approved but not on shift"
          tone="muted"
          onClick={() => setActiveTab('delivery-active')}
        />
        <Kpi
          label="Suspended"
          value={n(s?.suspended)}
          hint="Blocked from taking orders"
          tone={s?.suspended ? 'danger' : 'muted'}
          onClick={() => setActiveTab('delivery-suspended')}
        />
        <Kpi
          label="Incomplete Sign-ups"
          value={n(s?.incomplete)}
          hint="Started, never submitted"
          tone="muted"
          onClick={() => setActiveTab('delivery-all')}
        />
      </div>

      {/* The one thing on this screen that needs acting on. */}
      {s?.pending > 0 && (
        <div
          onClick={() => setActiveTab('delivery-pending')}
          style={{
            padding: 18, borderRadius: 12, backgroundColor: '#fffbe6',
            border: '1px solid #ffe58f', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}
        >
          <div>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#d48806' }}>
              ⚠️ {s.pending} partner application{s.pending === 1 ? '' : 's'} pending KYC review
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b45309', fontWeight: 600 }}>
              A rider cannot take a single order until their licence and Aadhaar are checked.
            </p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#d48806', whiteSpace: 'nowrap' }}>
            Review now →
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>

        <div style={{ padding: 20, borderRadius: 12, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Registration Funnel</h3>
            <button
              onClick={() => setActiveTab('delivery-all')}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
            >
              Manage Fleet →
            </button>
          </div>

          {!s ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Approved',   count: s.fleet,      color: '#16a34a' },
                { label: 'Pending',    count: s.pending,    color: '#f59e0b' },
                { label: 'Incomplete', count: s.incomplete, color: '#94a3b8' },
                { label: 'Rejected',   count: s.rejected,   color: '#ef4444' },
                { label: 'Suspended',  count: s.suspended,  color: '#b91c1c' },
              ].map((row) => {
                // Percentages are computed, never written down — a hardcoded one
                // stops matching its own number the first time the data moves.
                const total = s.totalRegistrations || 1;
                const pct = Math.round((row.count / total) * 100);
                return (
                  <div key={row.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                      <span style={{ color: '#475569' }}>{row.label}</span>
                      <span style={{ color: row.color, fontWeight: 800 }}>
                        {row.count} ({pct}%)
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: row.color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, paddingTop: 4 }}>
                {s.totalRegistrations} total registration{s.totalRegistrations === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </div>

        <LiveDispatchPanel setActiveTab={setActiveTab} />

      </div>
    </div>
  );
};

export default DeliveryDashboardTab;
