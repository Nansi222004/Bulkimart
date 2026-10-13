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

export const DeliveryTab = ({ defaultStatusFilter }) => {
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
    const confirmed = window.confirm(
      'Remove this delivery-partner account? A reference-free application may be permanently deleted. A partner with completed delivery or payout history will be deactivated instead. Active deliveries, return pickups, pending earnings, or payouts will block the action.'
    );
    if (!confirmed) return;
    setRemoving(true);
    await removeDeliveryAccount(riderDetail._id);
    setRemoving(false);
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
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 680 }}>
            {riderDetailLoading || !riderDetail ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                Loading application…
              </div>
            ) : (
              <>
                <div className="admin-modal-header">
                  <div>
                    <h3 className="admin-modal-title">{riderDetail.account?.name || '—'}</h3>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
                      {riderDetail.account?.phone} • {riderDetail.status}
                    </span>
                  </div>
                  <button className="admin-modal-close" onClick={() => setRiderDetail(null)}>✕</button>
                </div>

                <div style={{ display: 'flex', gap: 6, padding: '10px 0', borderBottom: '1px solid #e2e8f0', overflowX: 'auto' }}>
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
                        padding: '6px 12px',
                        borderRadius: 16,
                        border: dossierTab === t.id ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                        backgroundColor: dossierTab === t.id ? '#ebfdf2' : '#ffffff',
                        color: dossierTab === t.id ? '#047857' : '#475569',
                        fontWeight: dossierTab === t.id ? 800 : 600,
                        fontSize: 11,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {dossierTab === 'application' && (
                    <>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Full Name</span>
                        <span className="admin-item-value" style={{ fontWeight: 800 }}>{riderDetail.account?.name || '—'}</span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Mobile (OTP login)</span>
                        <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>{riderDetail.account?.phone}</span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Vehicle</span>
                        <span className="admin-item-value">
                          {VEHICLE_LABEL[riderDetail.vehicle?.type] || riderDetail.vehicle?.type || '—'}
                          {riderDetail.vehicle?.number ? ` · ${riderDetail.vehicle.number}` : ''}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Licence Number</span>
                        <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>
                          {riderDetail.vehicle?.licenceNo || 'Not required (bicycle)'}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Licence Expiry</span>
                        <span
                          className="admin-item-value"
                          style={riderDetail.vehicle?.licenceExpired ? { color: '#b91c1c', fontWeight: 800 } : undefined}
                        >
                          {riderDetail.vehicle?.licenceExpiry
                            ? new Date(riderDetail.vehicle.licenceExpiry).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                            : '—'}
                          {riderDetail.vehicle?.licenceExpired ? '  ⚠️ EXPIRED' : ''}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Aadhaar</span>
                        <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>
                          {riderDetail.aadhaar?.number || '—'}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Serves Pincodes</span>
                        <span className="admin-item-value">{riderDetail.serviceZones?.join(', ') || '—'}</span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Registered</span>
                        <span className="admin-item-value">{fmtDate(riderDetail.registeredAt)}</span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Submitted</span>
                        <span className="admin-item-value">{fmtDate(riderDetail.submittedAt)}</span>
                      </div>
                      {riderDetail.rejectionReason && (
                        <div className="admin-item-row">
                          <span className="admin-item-label">Rejection Reason</span>
                          <span className="admin-item-value" style={{ color: '#b91c1c' }}>{riderDetail.rejectionReason}</span>
                        </div>
                      )}
                    </>
                  )}

                  {dossierTab === 'documents' && (
                    riderDetail.documents?.length ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                        {riderDetail.documents.map((d) => (
                          <a
                            key={d.label}
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'block', padding: 10, borderRadius: 8,
                              border: '1px solid #e2e8f0', backgroundColor: '#f8fafc',
                              textDecoration: 'none',
                            }}
                          >
                            {/* An image preview beats a filename — the point of this
                                screen is to actually look at the document. */}
                            <img
                              src={d.url}
                              alt={d.label}
                              style={{
                                width: '100%', height: 90, objectFit: 'cover',
                                borderRadius: 6, backgroundColor: '#e2e8f0', display: 'block',
                              }}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 800, color: '#0f172a' }}>{d.label}</div>
                            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{d.category} · open ↗</div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                        This rider has not uploaded any documents yet.
                      </div>
                    )
                  )}

                  {dossierTab === 'location' && (
                    riderDetail.baseLocation ? (
                      <>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Address</span>
                          <span className="admin-item-value">{riderDetail.baseLocation.address || '—'}</span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Landmark</span>
                          <span className="admin-item-value">{riderDetail.baseLocation.landmark || '—'}</span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">City / State</span>
                          <span className="admin-item-value">
                            {riderDetail.baseLocation.city || '—'}
                            {riderDetail.baseLocation.state ? `, ${riderDetail.baseLocation.state}` : ''}
                          </span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Pincode</span>
                          <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>
                            {riderDetail.baseLocation.pincode || '—'}
                          </span>
                        </div>

                        {/* How the location was captured decides how much it is
                            worth: a GPS fix was taken on the device, a typed
                            address is only the rider's claim. */}
                        <div className="admin-item-row">
                          <span className="admin-item-label">Captured via</span>
                          <span
                            className="admin-item-value"
                            style={{ fontWeight: 800, color: riderDetail.baseLocation.source === 'gps' ? '#166534' : '#b45309' }}
                          >
                            {riderDetail.baseLocation.source === 'gps'
                              ? `Device GPS${riderDetail.baseLocation.accuracy ? ` · ±${riderDetail.baseLocation.accuracy} m` : ''}`
                              : 'Typed by the rider (unverified)'}
                          </span>
                        </div>

                        {riderDetail.baseLocation.lat !== undefined && (
                          <div className="admin-item-row">
                            <span className="admin-item-label">Coordinates</span>
                            <span className="admin-item-value">
                              <a
                                href={`https://www.google.com/maps?q=${riderDetail.baseLocation.lat},${riderDetail.baseLocation.lng}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#2563eb', fontWeight: 800, fontFamily: 'monospace' }}
                              >
                                {riderDetail.baseLocation.lat}, {riderDetail.baseLocation.lng} ↗
                              </a>
                            </span>
                          </div>
                        )}
                        <div className="admin-item-row">
                          <span className="admin-item-label">Captured at</span>
                          <span className="admin-item-value">{fmtDate(riderDetail.baseLocation.capturedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                        No base location saved yet.
                      </div>
                    )
                  )}

                  {dossierTab === 'location' && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--admin-border, #e2e8f0)' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        Delivery Radius
                      </div>
                      {!riderDetail.baseLocation?.lat && (
                        <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8 }}>
                          This rider has no pinned location yet — a radius cannot be enforced until they do.
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number" min="0.1" step="0.1" value={riderRadiusInput}
                          onChange={(e) => setRiderRadiusInput(e.target.value)}
                          placeholder="Unrestricted"
                          style={{ width: 100, padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--admin-border, #cbd5e1)', fontSize: 12.5 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>KM</span>
                        <button
                          className="admin-btn-sm approve"
                          onClick={() => setDeliveryPartnerRadius(riderDetail._id, riderRadiusInput === '' ? null : Number(riderRadiusInput))}
                        >
                          Save
                        </button>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--admin-text-muted)', marginTop: 6 }}>
                        Leave blank for unrestricted — dispatch falls back to the platform's shared search radius, exactly as before.
                      </div>
                    </div>
                  )}

                  {dossierTab === 'bank' && (
                    riderDetail.bank ? (
                      <>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Account Holder</span>
                          <span className="admin-item-value">{riderDetail.bank.holderName || '—'}</span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Bank</span>
                          <span className="admin-item-value">{riderDetail.bank.bankName || '—'}</span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">Account Number</span>
                          <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>
                            {riderDetail.bank.accountNo || '—'}
                          </span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">IFSC</span>
                          <span className="admin-item-value" style={{ fontFamily: 'monospace' }}>
                            {riderDetail.bank.ifsc || '—'}
                          </span>
                        </div>
                        <div className="admin-item-row">
                          <span className="admin-item-label">UPI ID</span>
                          <span className="admin-item-value">{riderDetail.bank.upiId || '—'}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                        No payout account saved yet.
                      </div>
                    )
                  )}

                  {dossierTab === 'metrics' && (
                    <>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Total Deliveries</span>
                        <span className="admin-item-value" style={{ fontWeight: 800 }}>
                          {riderDetail.metrics?.totalDeliveries || 0}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Rating</span>
                        <span className="admin-item-value">
                          {riderDetail.metrics?.rating ? `⭐ ${riderDetail.metrics.rating}` : 'No ratings yet'}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Currently Available</span>
                        <span className="admin-item-value">{riderDetail.metrics?.isAvailable ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Earnings (total / pending / paid)</span>
                        <span className="admin-item-value" style={{ fontWeight: 700 }}>
                          ₹{riderDetail.metrics?.earnings?.total || 0} / ₹{riderDetail.metrics?.earnings?.pending || 0} / ₹{riderDetail.metrics?.earnings?.paid || 0}
                        </span>
                      </div>
                      <div className="admin-item-row">
                        <span className="admin-item-label">Approved At</span>
                        <span className="admin-item-value">{fmtDate(riderDetail.approvedAt)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Decisions live at the bottom of the dossier, so they are taken
                    after reading it rather than from the list at a glance. */}
                <div className="admin-modal-actions" style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                  <button
                    className="admin-btn-sm details"
                    style={{ background: '#fff', borderColor: '#fecaca', color: '#b91c1c' }}
                    onClick={removeRider}
                    disabled={removing}
                    title="Permanently deletes only reference-free accounts; otherwise deactivates while preserving history"
                  >
                    {removing ? 'Checking…' : 'Delete / Deactivate Partner'}
                  </button>
                  {riderDetail.status === 'pending' && (
                    <>
                      <button
                        className="admin-btn-sm details"
                        style={{ background: '#dcfce7', color: '#166534', flex: 1 }}
                        onClick={() => approveRider(riderDetail._id)}
                      >
                        Approve & Unlock Rider App
                      </button>
                      <button
                        className="admin-btn-sm details"
                        style={{ background: '#fee2e2', color: '#b91c1c', flex: 1 }}
                        onClick={() => rejectRider(riderDetail._id)}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {riderDetail.status === 'approved' && (
                    <button
                      className="admin-btn-sm details"
                      style={{ background: '#fee2e2', color: '#b91c1c', flex: 1 }}
                      onClick={() => suspendRider(riderDetail._id)}
                    >
                      Suspend Partner
                    </button>
                  )}
                  {['rejected', 'suspended'].includes(riderDetail.status) && (
                    <button
                      className="admin-btn-sm details"
                      style={{ background: '#dcfce7', color: '#166534', flex: 1 }}
                      onClick={() => approveRider(riderDetail._id)}
                    >
                      Reinstate & Approve
                    </button>
                  )}
                  {riderDetail.status === 'incomplete' && (
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, padding: '8px 0' }}>
                      This rider has not finished registering, so there is nothing to decide yet.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default DeliveryTab;
