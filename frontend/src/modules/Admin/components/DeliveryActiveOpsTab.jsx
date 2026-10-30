import ModalPortal from '../../../components/ModalPortal';
import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { useLiveDispatch, STAGE_LABELS, STAGE_TONES, KIND_LABELS, formatMinutes, formatClock } from '../utils/liveDispatch';

/**
 * Active Deliveries — every rider trip still in progress, from
 * GET /api/admin/delivery-live.
 *
 * Read-only on purpose: a trip's stage is moved by the rider app, because
 * pickup, OTP and payout all hang off those transitions. The one admin action
 * is reassignment, which the Order Assignment board performs with its own
 * eligibility checks, and only before pickup.
 */
const StagePill = ({ stage }) => {
  const tone = STAGE_TONES[stage] || { color: '#475569', background: '#f1f5f9' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', ...tone }}>
      {STAGE_LABELS[stage] || stage}
    </span>
  );
};

const Row = ({ label, children }) => (
  <div className="admin-item-row"><span className="admin-item-label">{label}</span><span className="admin-item-value" style={{ fontWeight: 700, textAlign: 'right' }}>{children}</span></div>
);

const cell = { padding: '12px 16px', verticalAlign: 'top' };

export const DeliveryActiveOpsTab = () => {
  const { setActiveTab } = useAdmin();
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const { data, loading, error, reload } = useLiveDispatch({ stage, search });

  const trips = data?.trips || [];
  const summary = data?.summary;
  const filtered = stage !== 'all' || search.trim();

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Active Deliveries</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
            Rider trips in progress: assigned → at store → picked up → on the way → OTP at the door.
            {data && ` Updated ${formatClock(data.asOf)}; refreshes every 30s.`}
          </p>
        </div>
        <button type="button" className="sa-btn-primary" onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[['all', `All (${summary.activeTrips})`], ...Object.entries(summary.byStage).map(([key, count]) => [key, `${STAGE_LABELS[key]} (${count})`])].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={stage === key}
              onClick={() => setStage(key)}
              style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${stage === key ? '#0ea5e9' : '#e2e8f0'}`, background: stage === key ? '#e0f2fe' : '#ffffff', color: stage === key ? '#0369a1' : '#475569' }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="sa-search-wrapper" style={{ maxWidth: 420, width: '100%' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input type="search" className="sa-search-input" aria-label="Search active deliveries" placeholder="Search by order, customer, rider or rider phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {error} <button type="button" onClick={reload} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      <div tabIndex={0} role="region" aria-label="Active deliveries table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5, minWidth: 900 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
              {['Order Ref', 'Customer', 'Rider', 'Pickup', 'Drop', 'Elapsed', 'Stage', ''].map((h) => <th key={h} style={{ padding: '12px 16px' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!data && loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>Loading active deliveries…</td></tr>
            ) : !data && error ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#b91c1c' }}>Active deliveries could not be loaded.</td></tr>
            ) : trips.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>{filtered ? 'No active deliveries match these filters.' : 'No rider trips in progress right now.'}</td></tr>
            ) : trips.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ ...cell, fontFamily: 'monospace', fontWeight: 800 }}>
                  {t.ref}
                  {t.kind !== 'order' && <div style={{ fontFamily: 'inherit', fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{KIND_LABELS[t.kind]}</div>}
                </td>
                <td style={{ ...cell, fontWeight: 800, color: '#0f172a' }}>{t.customer}</td>
                <td style={{ ...cell, color: '#047857', fontWeight: 700 }}>{t.rider.name}</td>
                <td style={{ ...cell, color: '#64748b', maxWidth: 200 }}>{t.pickupAddress || '—'}</td>
                <td style={{ ...cell, color: '#64748b', maxWidth: 200 }}>{t.dropAddress || '—'}</td>
                <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {t.pickedUp ? `${formatMinutes(t.minutesSincePickup)} since pickup` : `${formatMinutes(t.minutesSinceAssigned)} since assigned`}
                  {t.overEta && <div style={{ fontSize: 10.5, color: '#dc2626', fontWeight: 800 }}>Past {t.etaMinutes} min ETA</div>}
                </td>
                <td style={cell}><StagePill stage={t.stage} /></td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <button type="button" className="admin-btn-sm details" onClick={() => setSelected(t)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.meta?.truncated && (
        <p style={{ margin: 0, fontSize: 11.5, color: '#b45309', fontWeight: 700 }}>
          Showing the oldest {data.meta.shown} of {data.meta.total} matching trips. Narrow the search or stage to see the rest.
        </p>
      )}

      {selected && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="active-delivery-title">
            <div className="admin-modal-header">
              <h3 id="active-delivery-title" className="admin-modal-title">Delivery {selected.ref}</h3>
              <button type="button" className="admin-modal-close" aria-label="Close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row label="Stage"><StagePill stage={selected.stage} /></Row>
              <Row label="Trip type">{KIND_LABELS[selected.kind]}{selected.channel ? ` · ${selected.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}` : ''}</Row>
              <Row label="Customer">{selected.customer}</Row>
              <Row label="Rider">{selected.rider.name}{selected.rider.vehicle ? ` · ${selected.rider.vehicle}` : ''}</Row>
              <Row label="Rider phone">{selected.rider.phone ? <a href={`tel:${selected.rider.phone}`}>{selected.rider.phone}</a> : '—'}</Row>
              <Row label="Pickup">{selected.pickupAddress || '—'}</Row>
              <Row label="Drop">{selected.dropAddress || '—'}</Row>
              <Row label="Assigned at">{formatClock(selected.assignedAt)} ({formatMinutes(selected.minutesSinceAssigned)} ago)</Row>
              <Row label="Picked up at">{selected.pickedUpAt ? `${formatClock(selected.pickedUpAt)} (${formatMinutes(selected.minutesSincePickup)} ago)` : 'Not yet'}</Row>
              <Row label="Trip estimate">{selected.etaMinutes ? `${selected.etaMinutes} min for ${selected.routeKm} km` : 'Not recorded'}</Row>
              <Row label="Distance left">{selected.remainingKm !== null ? `${selected.remainingKm} km (straight line)` : '—'}</Row>
              <Row label="Last location ping">{selected.lastPingAt ? `${formatMinutes(selected.lastPingMinutes)} ago` : 'None received'}</Row>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {selected.reassignable ? (
                <button type="button" className="sa-btn-primary" onClick={() => { setSelected(null); setActiveTab('delivery-assignment'); }}>Reassign in Order Assignment</button>
              ) : (
                <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, alignSelf: 'center' }}>
                  {selected.pickedUp ? 'Already picked up — the rider completes or fails this trip in the rider app.' : 'This trip type is not reassigned from the assignment board.'}
                </span>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default DeliveryActiveOpsTab;
