import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Delivery fleet — live from GET /api/admin/delivery-partners.
 *
 * This is where a rider's application actually gets decided. A rider carries
 * other people's goods and, on COD orders, other people's cash, so nothing they
 * submit grants access on its own: an admin reads the licence and the Aadhaar
 * here and approves by hand.
 */

/** The tab labels map onto the server's own status values. */
const STATUS_FROM_TAB = {
  All: 'all',
  Pending: 'pending',
  Active: 'approved',
  Suspended: 'suspended',
  Rejected: 'rejected',
};

const STATUS_PILL = {
  pending: 'under-review',
  approved: 'approved',
  rejected: 'rejected',
  suspended: 'rejected',
  incomplete: 'under-review',
};

const VEHICLE_LABEL = {
  bicycle: 'Bicycle',
  bike: 'Bike / Scooter',
  auto: 'Auto',
  car: 'Car',
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const tileStyle = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
};

const valueStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
  wordBreak: 'break-word',
};

export const DeliveryTab = ({ defaultStatusFilter }) => {
  const ui = useFeedback();
  const {
    riders,
    ridersLoading,
    ridersError,
    setRiderStatusFilter,
    fetchRiders,
    riderFilterOptions,
    fetchRiderCounts,
    riderDetail,
    riderDetailLoading,
    setDeliveryPartnerRadius,
    fetchRiderDetail,
    setRiderDetail,
    approveRider,
    rejectRider,
    suspendRider,
    removeDeliveryAccount,
  } = useAdmin();

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [tab, setTab] = useState(defaultStatusFilter || 'All');
  const [dossierTab, setDossierTab] = useState('application');
  const [riderRadiusInput, setRiderRadiusInput] = useState('');
  const [removing, setRemoving] = useState(false);

  const removeRider = async () => {
    if (!riderDetail || removing) return;
    return ui.perform('Remove this delivery-partner account? A reference-free application may be permanently deleted. A partner with completed delivery or payout history will be deactivated instead. Active deliveries, return pickups, pending earnings, or payouts will block the action.', async () => {
    setRemoving(true);
    await removeDeliveryAccount(riderDetail._id);
    setRemoving(false);

});
};
  useEffect(() => {
    setRiderRadiusInput(
      riderDetail?.deliveryRadiusKm !== undefined && riderDetail?.deliveryRadiusKm !== null
        ? String(riderDetail.deliveryRadiusKm) : ''
    );
  }, [riderDetail?._id, riderDetail?.deliveryRadiusKm]);

  const serverStatus = STATUS_FROM_TAB[tab] || 'all';

  const load = useCallback(() => {
    setRiderStatusFilter(serverStatus);
    fetchRiders(serverStatus, search, { state: stateFilter, city: cityFilter });
    fetchRiderCounts();
  }, [serverStatus, search, stateFilter, cityFilter, fetchRiders, fetchRiderCounts, setRiderStatusFilter]);

  // The sidebar mounts this with a different filter per entry, so follow it.
  useEffect(() => {
    if (defaultStatusFilter) setTab(defaultStatusFilter);
  }, [defaultStatusFilter]);

  // Debounced: the search box drives a server query, not a local array filter,
  // so firing on every keystroke would be one request per character.
  useEffect(() => {
    const id = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  const openDossier = (id) => {
    setDossierTab('application');
    fetchRiderDetail(id);
  };

  return (
    <>
      <div className="admin-action-row">
        <div className="admin-search-wrapper">
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search by vehicle number, licence number or pincode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="admin-filter-select"
          value={tab}
          onChange={(e) => setTab(e.target.value)}
        >
          <option value="All">All Applications</option>
          <option value="Pending">Pending Verification</option>
          <option value="Active">Approved Partners</option>
          <option value="Rejected">Rejected</option>
          <option value="Suspended">Suspended</option>
        </select>

        <select
          className="admin-filter-select"
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            // A city from the previously selected state matches nothing, and
            // would leave the list mysteriously empty.
            setCityFilter('');
          }}
        >
          <option value="">All States</option>
          {(riderFilterOptions.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className="admin-filter-select"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
        >
          <option value="">All Cities</option>
          {(riderFilterOptions.cities || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <button
          type="button"
          className="admin-btn-sm details inline"
          onClick={load}
          disabled={ridersLoading}
        >
          {ridersLoading ? 'Loading…' : '⟳ Refresh'}
        </button>
      </div>

      <div className="admin-list-container">
        {ridersLoading && riders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            Loading delivery partners…
          </div>
        ) : ridersError ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#b91c1c', fontWeight: 700 }}>
            {ridersError}
          </div>
        ) : riders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--admin-text-muted)' }}>
            {tab === 'Pending'
              ? 'No applications are waiting for verification.'
              : 'No delivery partners match this filter.'}
          </div>
        ) : (
          riders.map((r) => (
            <div key={r._id} className="admin-item-card">
              <div className="admin-item-header">
                <h3 className="admin-item-title">{r.name}</h3>
                <span className={`admin-status-pill ${STATUS_PILL[r.status] || 'under-review'}`}>
                  {r.status}
                </span>
              </div>

              <div className="admin-item-body">
                <div className="admin-item-row">
                  <span className="admin-item-label">Mobile (login)</span>
                  <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>{r.phone || '—'}</span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Vehicle</span>
                  <span className="admin-item-value">
                    {VEHICLE_LABEL[r.vehicleType] || r.vehicleType || '—'}
                    {r.vehicleNo ? ` · ${r.vehicleNo}` : ''}
                  </span>
                </div>
                <div className="admin-item-row">
                  <span className="admin-item-label">Delivers to</span>
                  <span className="admin-item-value">
                    {r.zones?.length ? r.zones.join(', ') : '—'}
                  </span>
                </div>
                {r.status === 'approved' ? (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Jobs & rating</span>
                    <span className="admin-item-value" style={{ fontWeight: 700 }}>
                      {r.totalDeliveries || 0} deliveries
                      {r.rating ? ` · ⭐ ${r.rating}` : ''}
                    </span>
                  </div>
                ) : (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Submitted</span>
                    <span className="admin-item-value">{fmtDate(r.submittedAt)}</span>
                  </div>
                )}
                {r.status === 'rejected' && r.rejectionReason && (
                  <div className="admin-item-row">
                    <span className="admin-item-label">Reason</span>
                    <span className="admin-item-value" style={{ color: '#b91c1c' }}>{r.rejectionReason}</span>
                  </div>
                )}
              </div>

              <div className="admin-item-actions">
                <button className="admin-btn-sm details" onClick={() => openDossier(r._id)}>
                  Review Application
                </button>
                {r.status === 'pending' && (
                  <>
                    <button
                      className="admin-btn-sm details"
                      style={{ background: '#dcfce7', color: '#166534' }}
                      onClick={() => approveRider(r._id)}
                    >
                      Approve
                    </button>
                    <button
                      className="admin-btn-sm details"
                      style={{ background: '#fee2e2', color: '#b91c1c' }}
                      onClick={() => rejectRider(r._id)}
                    >
                      Reject
                    </button>
                  </>
                )}
                {r.status === 'approved' && (
                  <button
                    className="admin-btn-sm details"
                    style={{ background: '#fee2e2', color: '#b91c1c' }}
                    onClick={() => suspendRider(r._id)}
                  >
                    Suspend
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ---------------- APPLICATION DOSSIER ---------------- */}
      {(riderDetail || riderDetailLoading) && (
        <ModalPortal
          className="admin-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setRiderDetail(null);
          }}
        >
          <div
            className="admin-modal-sheet"
            style={{
              maxWidth: 680,
              width: '100%',
              maxHeight: '90vh',
              borderRadius: 20,
              backgroundColor: '#ffffff',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0,0,0,0.06)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
              margin: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {riderDetailLoading || !riderDetail ? (
              <div style={{ padding: '60px 24px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: 26, marginBottom: 12 }}>⏳</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Loading application dossier…</div>
              </div>
            ) : (
              <>
                {/* Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '18px 24px',
                    borderBottom: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, #08b9e8, #0284c7)',
                        color: '#ffffff',
                        fontWeight: 800,
                        fontSize: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        letterSpacing: 0.5,
                        boxShadow: '0 4px 10px rgba(8, 185, 232, 0.25)',
                        flexShrink: 0,
                      }}
                    >
                      {(riderDetail.account?.name || 'R').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                          {riderDetail.account?.name || '—'}
                        </h3>
                        {riderDetail.status === 'pending' && (
                          <span
                            style={{
                              background: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706' }} />
                            Pending Verification
                          </span>
                        )}
                        {riderDetail.status === 'approved' && (
                          <span
                            style={{
                              background: '#dcfce7',
                              color: '#166534',
                              border: '1px solid #bbf7d0',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            ✓ Approved
                          </span>
                        )}
                        {['rejected', 'suspended'].includes(riderDetail.status) && (
                          <span
                            style={{
                              background: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: 'capitalize',
                            }}
                          >
                            {riderDetail.status}
                          </span>
                        )}
                        {riderDetail.status === 'incomplete' && (
                          <span
                            style={{
                              background: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #cbd5e1',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            Incomplete
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 3 }}>
                        📞 {riderDetail.account?.phone} • Registered: {fmtDate(riderDetail.registeredAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setRiderDetail(null)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#f8fafc',
                      color: '#64748b',
                      fontSize: 14,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      transition: 'all 0.15s ease',
                    }}
                    title="Close"
                  >
                    ✕
                  </button>
                </div>

                {/* Tabs */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '10px 24px',
                    borderBottom: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    overflowX: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {[
                    { id: 'application', label: 'Application' },
                    { id: 'documents', label: `Documents (${riderDetail.documents?.length || 0})` },
                    { id: 'location', label: 'Base Location' },
                    { id: 'bank', label: 'Payout' },
                    ...(riderDetail.status === 'approved'
                      ? [{ id: 'metrics', label: 'Performance' }]
                      : []),
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setDossierTab(t.id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: dossierTab === t.id ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                        backgroundColor: dossierTab === t.id ? '#0284c7' : '#ffffff',
                        color: dossierTab === t.id ? '#ffffff' : '#475569',
                        fontWeight: dossierTab === t.id ? 700 : 600,
                        fontSize: 11.5,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                        boxShadow: dossierTab === t.id ? '0 2px 4px rgba(2, 132, 199, 0.2)' : 'none',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Body Content */}
                <div
                  style={{
                    padding: '20px 24px',
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                  }}
                >
                  {dossierTab === 'application' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {riderDetail.rejectionReason && (
                        <div
                          style={{
                            padding: '10px 14px',
                            borderRadius: 10,
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fecaca',
                            color: '#991b1b',
                            fontSize: 12.5,
                            fontWeight: 600,
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span>⚠️</span>
                          <span><strong>Rejection Reason:</strong> {riderDetail.rejectionReason}</span>
                        </div>
                      )}

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                          gap: 12,
                        }}
                      >
                        <div style={tileStyle}>
                          <span style={labelStyle}>Full Name</span>
                          <span style={{ ...valueStyle, fontWeight: 700 }}>{riderDetail.account?.name || '—'}</span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Mobile (OTP Login)</span>
                          <span style={{ ...valueStyle, fontFamily: 'monospace' }}>{riderDetail.account?.phone || '—'}</span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Vehicle</span>
                          <span style={valueStyle}>
                            {VEHICLE_LABEL[riderDetail.vehicle?.type] || riderDetail.vehicle?.type || '—'}
                            {riderDetail.vehicle?.number ? ` · ${riderDetail.vehicle.number}` : ''}
                          </span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Licence Number</span>
                          <span style={{ ...valueStyle, fontFamily: 'monospace' }}>
                            {riderDetail.vehicle?.licenceNo || 'Not required (bicycle)'}
                          </span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Licence Expiry</span>
                          <span
                            style={{
                              ...valueStyle,
                              color: riderDetail.vehicle?.licenceExpired ? '#b91c1c' : '#0f172a',
                              fontWeight: riderDetail.vehicle?.licenceExpired ? 800 : 600,
                            }}
                          >
                            {riderDetail.vehicle?.licenceExpiry
                              ? new Date(riderDetail.vehicle.licenceExpiry).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                              : '—'}
                            {riderDetail.vehicle?.licenceExpired ? '  ⚠️ EXPIRED' : ''}
                          </span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Aadhaar Number</span>
                          <span style={{ ...valueStyle, fontFamily: 'monospace' }}>
                            {riderDetail.aadhaar?.number || '—'}
                          </span>
                        </div>

                        <div style={{ ...tileStyle, gridColumn: '1 / -1' }}>
                          <span style={labelStyle}>Serves Pincodes</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                            {riderDetail.serviceZones?.length ? (
                              riderDetail.serviceZones.map((pin) => (
                                <span
                                  key={pin}
                                  style={{
                                    backgroundColor: '#e0f2fe',
                                    color: '#0369a1',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    fontFamily: 'monospace',
                                  }}
                                >
                                  {pin}
                                </span>
                              ))
                            ) : (
                              <span style={valueStyle}>—</span>
                            )}
                          </div>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Registered At</span>
                          <span style={valueStyle}>{fmtDate(riderDetail.registeredAt)}</span>
                        </div>

                        <div style={tileStyle}>
                          <span style={labelStyle}>Submitted At</span>
                          <span style={valueStyle}>{fmtDate(riderDetail.submittedAt)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {dossierTab === 'documents' && (
                    riderDetail.documents?.length ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
                        {riderDetail.documents.map((d) => (
                          <a
                            key={d.label}
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: 10,
                              borderRadius: 12,
                              border: '1px solid #e2e8f0',
                              backgroundColor: '#f8fafc',
                              textDecoration: 'none',
                              transition: 'transform 0.15s, box-shadow 0.15s',
                            }}
                          >
                            <img
                              src={d.url}
                              alt={d.label}
                              style={{
                                width: '100%',
                                height: 110,
                                objectFit: 'cover',
                                borderRadius: 8,
                                backgroundColor: '#e2e8f0',
                                display: 'block',
                              }}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                              {d.label}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                              <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600, textTransform: 'capitalize' }}>
                                {d.category}
                              </span>
                              <span style={{ fontSize: 11, color: '#0284c7', fontWeight: 700 }}>
                                View ↗
                              </span>
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>This rider has not uploaded any documents yet.</div>
                      </div>
                    )
                  )}

                  {dossierTab === 'location' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {riderDetail.baseLocation ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                          <div style={{ ...tileStyle, gridColumn: '1 / -1' }}>
                            <span style={labelStyle}>Address</span>
                            <span style={{ ...valueStyle, fontWeight: 700 }}>{riderDetail.baseLocation.address || '—'}</span>
                          </div>

                          <div style={tileStyle}>
                            <span style={labelStyle}>Landmark</span>
                            <span style={valueStyle}>{riderDetail.baseLocation.landmark || '—'}</span>
                          </div>

                          <div style={tileStyle}>
                            <span style={labelStyle}>City / State</span>
                            <span style={valueStyle}>
                              {riderDetail.baseLocation.city || '—'}
                              {riderDetail.baseLocation.state ? `, ${riderDetail.baseLocation.state}` : ''}
                            </span>
                          </div>

                          <div style={tileStyle}>
                            <span style={labelStyle}>Pincode</span>
                            <span style={{ ...valueStyle, fontFamily: 'monospace' }}>
                              {riderDetail.baseLocation.pincode || '—'}
                            </span>
                          </div>

                          <div style={tileStyle}>
                            <span style={labelStyle}>Captured via</span>
                            <span
                              style={{
                                ...valueStyle,
                                fontWeight: 800,
                                color: riderDetail.baseLocation.source === 'gps' ? '#166534' : '#b45309',
                              }}
                            >
                              {riderDetail.baseLocation.source === 'gps'
                                ? `Device GPS${riderDetail.baseLocation.accuracy ? ` · ±${riderDetail.baseLocation.accuracy} m` : ''}`
                                : 'Typed by the rider (unverified)'}
                            </span>
                          </div>

                          {riderDetail.baseLocation.lat !== undefined && (
                            <div style={tileStyle}>
                              <span style={labelStyle}>Coordinates</span>
                              <span style={valueStyle}>
                                <a
                                  href={`https://www.google.com/maps?q=${riderDetail.baseLocation.lat},${riderDetail.baseLocation.lng}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#0284c7', fontWeight: 800, fontFamily: 'monospace', textDecoration: 'none' }}
                                >
                                  {riderDetail.baseLocation.lat}, {riderDetail.baseLocation.lng} ↗
                                </a>
                              </span>
                            </div>
                          )}

                          <div style={tileStyle}>
                            <span style={labelStyle}>Captured at</span>
                            <span style={valueStyle}>{fmtDate(riderDetail.baseLocation.capturedAt)}</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>📍</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>No base location saved yet.</div>
                        </div>
                      )}

                      <div
                        style={{
                          marginTop: 10,
                          padding: 14,
                          borderRadius: 12,
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.4px' }}>
                          Delivery Radius
                        </div>
                        {!riderDetail.baseLocation?.lat && (
                          <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8, fontWeight: 600 }}>
                            ⚠️ This rider has no pinned location yet — a radius cannot be enforced until they do.
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={riderRadiusInput}
                            onChange={(e) => setRiderRadiusInput(e.target.value)}
                            placeholder="Unrestricted"
                            style={{
                              width: 120,
                              padding: '7px 12px',
                              borderRadius: 8,
                              border: '1.5px solid #cbd5e1',
                              fontSize: 13,
                              outline: 'none',
                            }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>KM</span>
                          <button
                            type="button"
                            onClick={() => setDeliveryPartnerRadius(riderDetail._id, riderRadiusInput === '' ? null : Number(riderRadiusInput))}
                            style={{
                              backgroundColor: '#0284c7',
                              color: '#ffffff',
                              border: 'none',
                              padding: '7px 16px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Save Radius
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                          Leave blank for unrestricted — dispatch falls back to the platform's shared search radius.
                        </div>
                      </div>
                    </div>
                  )}

                  {dossierTab === 'bank' && (
                    riderDetail.bank ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        <div style={tileStyle}>
                          <span style={labelStyle}>Account Holder</span>
                          <span style={{ ...valueStyle, fontWeight: 700 }}>{riderDetail.bank.holderName || '—'}</span>
                        </div>
                        <div style={tileStyle}>
                          <span style={labelStyle}>Bank</span>
                          <span style={valueStyle}>{riderDetail.bank.bankName || '—'}</span>
                        </div>
                        <div style={tileStyle}>
                          <span style={labelStyle}>Account Number</span>
                          <span style={{ ...valueStyle, fontFamily: 'monospace' }}>
                            {riderDetail.bank.accountNo || '—'}
                          </span>
                        </div>
                        <div style={tileStyle}>
                          <span style={labelStyle}>IFSC</span>
                          <span style={{ ...valueStyle, fontFamily: 'monospace' }}>
                            {riderDetail.bank.ifsc || '—'}
                          </span>
                        </div>
                        <div style={tileStyle}>
                          <span style={labelStyle}>UPI ID</span>
                          <span style={valueStyle}>{riderDetail.bank.upiId || '—'}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🏦</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>No payout account saved yet.</div>
                      </div>
                    )
                  )}

                  {dossierTab === 'metrics' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                      <div style={tileStyle}>
                        <span style={labelStyle}>Total Deliveries</span>
                        <span style={{ ...valueStyle, fontSize: 18, fontWeight: 800, color: '#0284c7' }}>
                          {riderDetail.metrics?.totalDeliveries || 0}
                        </span>
                      </div>
                      <div style={tileStyle}>
                        <span style={labelStyle}>Rating</span>
                        <span style={{ ...valueStyle, fontWeight: 700 }}>
                          {riderDetail.metrics?.rating ? `⭐ ${riderDetail.metrics.rating}` : 'No ratings yet'}
                        </span>
                      </div>
                      <div style={tileStyle}>
                        <span style={labelStyle}>Currently Available</span>
                        <span style={{ ...valueStyle, fontWeight: 700, color: riderDetail.metrics?.isAvailable ? '#166534' : '#64748b' }}>
                          {riderDetail.metrics?.isAvailable ? '✓ Yes (Online)' : '✕ No (Offline)'}
                        </span>
                      </div>
                      {riderDetail.finance?.balances ? <div style={tileStyle}>
                        <span style={labelStyle}>Earnings (On hold / Available / Requested / Paid)</span>
                        <span style={{ ...valueStyle, fontWeight: 700 }}>
                          ₹{riderDetail.finance.balances.onHold} / ₹{riderDetail.finance.balances.available} / ₹{riderDetail.finance.balances.requested} / ₹{riderDetail.finance.balances.paid}
                        </span>
                        {riderDetail.finance.legacyUnverified > 0 && <span style={{ ...labelStyle, marginTop: 4 }}>₹{riderDetail.finance.legacyUnverified} from before the finance ledger needs manual review</span>}
                        {riderDetail.finance.reportedCodOutstanding > 0 && <span style={{ ...labelStyle, marginTop: 4, color: '#b45309' }}>Holding ₹{riderDetail.finance.reportedCodOutstanding} COD cash</span>}
                      </div> : <div style={tileStyle}>
                        <span style={labelStyle}>Earnings (Total / Pending / Paid)</span>
                        <span style={{ ...valueStyle, fontWeight: 700 }}>
                          ₹{riderDetail.metrics?.earnings?.total || 0} / ₹{riderDetail.metrics?.earnings?.pending || 0} / ₹{riderDetail.metrics?.earnings?.paid || 0}
                        </span>
                      </div>}
                      <div style={tileStyle}>
                        <span style={labelStyle}>Approved At</span>
                        <span style={valueStyle}>{fmtDate(riderDetail.approvedAt)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer / Action Controls */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '16px 24px',
                    borderTop: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    flexWrap: 'wrap',
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={removeRider}
                    disabled={removing}
                    title="Permanently deletes only reference-free accounts; otherwise deactivates while preserving history"
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #fecaca',
                      color: '#b91c1c',
                      padding: '8px 14px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: removing ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {removing ? 'Checking…' : 'Delete / Deactivate Partner'}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {riderDetail.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          onClick={() => rejectRider(riderDetail._id)}
                          style={{
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            border: '1px solid #fca5a5',
                            padding: '9px 18px',
                            borderRadius: 8,
                            fontSize: 12.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => approveRider(riderDetail._id)}
                          style={{
                            backgroundColor: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            padding: '9px 20px',
                            borderRadius: 8,
                            fontSize: 12.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 10px rgba(22, 163, 74, 0.25)',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          ✓ Approve & Unlock Rider App
                        </button>
                      </>
                    )}

                    {riderDetail.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => suspendRider(riderDetail._id)}
                        style={{
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          border: '1px solid #fca5a5',
                          padding: '9px 18px',
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Suspend Partner
                      </button>
                    )}

                    {['rejected', 'suspended'].includes(riderDetail.status) && (
                      <button
                        type="button"
                        onClick={() => approveRider(riderDetail._id)}
                        style={{
                          backgroundColor: '#16a34a',
                          color: '#ffffff',
                          border: 'none',
                          padding: '9px 20px',
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Reinstate & Approve
                      </button>
                    )}

                    {riderDetail.status === 'incomplete' && (
                      <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>
                        Application incomplete — pending rider completion.
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default DeliveryTab;
