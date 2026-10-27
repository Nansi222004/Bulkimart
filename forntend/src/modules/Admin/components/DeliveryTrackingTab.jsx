import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { useLiveDispatch, STAGE_LABELS, KIND_LABELS, formatMinutes, formatClock } from '../utils/liveDispatch';

/**
 * Delivery Tracking — where each live trip stands against its own estimate.
 *
 * "Past ETA" compares time since pickup with the estimate written when the
 * trip was accepted (straight-line distance at city pace). The platform has no
 * separate SLA setting, so trips without an estimate are shown, never flagged.
 */
const byUrgency = (a, b) => (b.overEta === true) - (a.overEta === true)
  || (b.minutesSincePickup ?? -1) - (a.minutesSincePickup ?? -1)
  || (b.minutesSinceAssigned ?? 0) - (a.minutesSinceAssigned ?? 0);

export const DeliveryTrackingTab = () => {
  const { setActiveTab } = useAdmin();
  const [search, setSearch] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const { data, loading, error, reload } = useLiveDispatch({ search, overEta: lateOnly });

  const trips = [...(data?.trips || [])].sort(byUrgency);
  const s = data?.summary;

  return (
    <>
      <div className="admin-action-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="admin-search-wrapper" style={{ flex: '0 1 400px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            className="admin-search-input"
            aria-label="Search tracked deliveries"
            placeholder="Search by order, customer or rider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} />
          Past ETA only
        </label>
        <button type="button" className="admin-btn-sm details" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
          {[
            ['Live trips', s?.activeTrips, '#0ea5e9'],
            ['Past ETA', s?.overEta, s?.overEta ? '#dc2626' : '#0f172a'],
            ['Riders online', s?.ridersOnline, '#16a34a'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color }}>{value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {error} <button type="button" onClick={reload} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      {data && <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748b' }}>Updated {formatClock(data.asOf)} · refreshes every 30s · most urgent first.</p>}

      <div className="admin-list-container">
        {!data && loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>Loading live trips…</div>
        ) : !data && error ? null : trips.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)', width: '100%' }}>
            {lateOnly ? 'No trip is past its estimate.' : search.trim() ? 'No live trips match this search.' : 'No active deliveries to track.'}
          </div>
        ) : trips.map((d) => (
          <div key={d.id} className="admin-item-card" style={{ borderLeft: d.overEta ? '4px solid #ef4444' : '4px solid #10b981' }}>
            <div className="admin-item-header">
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)' }}>{d.ref}{d.kind !== 'order' ? ` · ${KIND_LABELS[d.kind]}` : ''}</span>
              <span className={`admin-status-pill ${d.overEta ? 'rejected' : 'approved'}`}>
                {d.overEta ? 'Past ETA' : STAGE_LABELS[d.stage] || d.stage}
              </span>
            </div>

            <div className="admin-item-body">
              <h4 className="admin-item-title" style={{ color: 'var(--admin-text-primary)' }}>Rider: {d.rider.name}</h4>
              <p style={{ margin: '2px 0 10px 0', fontSize: 11, color: 'var(--admin-text-muted)' }}>Customer: {d.customer} · {STAGE_LABELS[d.stage] || d.stage}</p>

              <div className="admin-item-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <span className="admin-item-label">Delivery address</span>
                <span className="admin-item-value" style={{ fontSize: 11, fontWeight: 600 }}>{d.dropAddress || '—'}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">{d.pickedUp ? 'Since pickup' : 'Since assigned'}</span>
                <span className="admin-item-value" style={{ color: d.overEta ? '#ef4444' : 'inherit', fontWeight: 800 }}>
                  {formatMinutes(d.pickedUp ? d.minutesSincePickup : d.minutesSinceAssigned)}
                </span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Trip estimate</span>
                <span className="admin-item-value">{d.etaMinutes ? `${d.etaMinutes} min` : 'Not recorded'}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Distance left</span>
                <span className="admin-item-value">{d.remainingKm !== null ? `${d.remainingKm} km` : '—'}</span>
              </div>
              <div className="admin-item-row">
                <span className="admin-item-label">Last location ping</span>
                <span className="admin-item-value">{d.lastPingAt ? `${formatMinutes(d.lastPingMinutes)} ago` : 'None received'}</span>
              </div>
            </div>

            <div className="admin-item-actions" style={{ gap: 8 }}>
              {d.rider.phone && (
                <a className="admin-btn-sm details" href={`tel:${d.rider.phone}`} style={{ padding: '8px 12px', textDecoration: 'none' }}>Call rider</a>
              )}
              {d.reassignable && (
                <button type="button" className="admin-btn-sm reject" style={{ padding: '8px 12px', border: '1px solid #cbd5e1', color: '#475569', background: 'none' }} onClick={() => setActiveTab('delivery-assignment')}>
                  Reassign before pickup
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {data?.meta?.truncated && (
        <p style={{ fontSize: 11.5, color: '#b45309', fontWeight: 700 }}>Showing {data.meta.shown} of {data.meta.total} trips. Narrow the search to see the rest.</p>
      )}
    </>
  );
};

export default DeliveryTrackingTab;
