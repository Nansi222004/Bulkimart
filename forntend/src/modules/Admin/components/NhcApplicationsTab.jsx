import React, { useState, useEffect, useCallback } from 'react';
import { adminGet, adminPatch } from '../../../utils/adminApi';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const prettyStatus = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const NhcApplicationsTab = () => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal / Detail state
  const [selectedApp, setSelectedApp] = useState(null);
  const [appDetail, setAppDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Rejection modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (statusFilter !== 'all') q.append('status', statusFilter);
      if (planFilter !== 'all') q.append('planType', planFilter);
      if (searchQuery.trim()) q.append('search', searchQuery.trim());

      const { data } = await adminGet(`/nhc/seller-applications?${q.toString()}`);
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch NHC applications');
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, planFilter, searchQuery]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleOpenDetail = async (appId) => {
    setSelectedApp(appId);
    setDetailLoading(true);
    try {
      const { data } = await adminGet(`/nhc/seller-applications/${appId}`);
      setAppDetail(data);
    } catch (err) {
      triggerToast(err.message || 'Error loading application details');
      setAppDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!appDetail?._id) return;
    setActionSubmitting(true);
    try {
      await adminPatch(`/nhc/seller-applications/${appDetail._id}/approve`);
      triggerToast('NHC Seller application approved successfully.');
      handleOpenDetail(appDetail._id);
      fetchApplications();
    } catch (err) {
      triggerToast(err.message || 'Approval failed');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      triggerToast('Please provide a rejection reason');
      return;
    }
    if (!appDetail?._id) return;

    setActionSubmitting(true);
    try {
      await adminPatch(`/nhc/seller-applications/${appDetail._id}/reject`, {
        rejectionReason: rejectionReason.trim(),
      });
      triggerToast('NHC Seller application rejected.');
      setShowRejectModal(false);
      setRejectionReason('');
      handleOpenDetail(appDetail._id);
      fetchApplications();
    } catch (err) {
      triggerToast(err.message || 'Rejection failed');
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div className="admin-content-container" style={{ padding: 24, backgroundColor: '#f8fafc', minHeight: '100%' }}>
      {toastMessage && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          backgroundColor: '#0f172a', color: '#ffffff', padding: '12px 20px',
          borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.25)', fontSize: 13, fontWeight: 700
        }}>
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
          NHC Seller Applications
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          Review and process onboarding applications submitted by NHC Organization Sellers.
        </p>
      </div>

      {/* Quick Status Pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: '📋 All Applications' },
          { key: 'under_review', label: '📥 Pending Approval' },
          { key: 'approved', label: '✅ Approved NHC Sellers' },
          { key: 'rejected', label: '❌ Rejected' },
        ].map((tab) => {
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: isActive ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                backgroundColor: isActive ? '#ecfdf5' : '#ffffff',
                color: isActive ? '#047857' : '#475569',
                fontWeight: isActive ? 800 : 600,
                fontSize: 12,
                cursor: 'pointer',
                boxShadow: isActive ? '0 2px 6px rgba(16, 185, 129, 0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 0.2s ease',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by store name, seller, city..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1, minWidth: 240, padding: '10px 14px', borderRadius: 10,
            backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
          }}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '10px 14px', borderRadius: 10,
            backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
          }}
        >
          <option value="all">All Statuses</option>
          <option value="under_review">Under Review</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          style={{
            padding: '10px 14px', borderRadius: 10,
            backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
          }}
        >
          <option value="all">All NHC Plans</option>
          <option value="UNIT_SELLER">Unit Seller</option>
          <option value="BLOCK_SELLER">Block Seller</option>
          <option value="CUSTOM">Custom Plan</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading NHC applications...</div>
      ) : error ? (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: 16, borderRadius: 12 }}>
          {error}
        </div>
      ) : applications.length === 0 ? (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', padding: 40, borderRadius: 16, textAlign: 'center', color: '#64748b' }}>
          No NHC seller applications found matching filters.
        </div>
      ) : (
        <div style={{ backgroundColor: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left', color: '#0f172a' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={{ padding: '14px 16px' }}>Seller / Store</th>
                <th style={{ padding: '14px 16px' }}>Phone / Contact</th>
                <th style={{ padding: '14px 16px' }}>NHC Plan</th>
                <th style={{ padding: '14px 16px' }}>Snapshot Amount</th>
                <th style={{ padding: '14px 16px' }}>Submitted</th>
                <th style={{ padding: '14px 16px' }}>Status</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => {
                const planName = app.nhcPlan?.planName || 'Unit Seller';
                const planAmt = app.nhcPlan?.planAmount !== undefined
                  ? `₹${Number(app.nhcPlan.planAmount).toLocaleString('en-IN')}`
                  : '₹10,00,000';
                
                const isApproved = app.status === 'approved';
                const isRejected = app.status === 'rejected';
                const isSuspended = app.status === 'suspended';

                const statusBg = isApproved ? '#dcfce7' : isRejected ? '#fee2e2' : isSuspended ? '#f1f5f9' : '#fef3c7';
                const statusColor = isApproved ? '#15803d' : isRejected ? '#b91c1c' : isSuspended ? '#475569' : '#b45309';
                const statusBorder = isApproved ? '#bbf7d0' : isRejected ? '#fecaca' : isSuspended ? '#cbd5e1' : '#fde68a';

                return (
                  <tr key={app._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{app.storeName}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{app.businessName || app.holderName}</div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#334155', fontFamily: 'monospace' }}>
                      +91 {app.phone || '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: '#0284c7', padding: '3px 8px', borderRadius: 6,
                        backgroundColor: '#f0f9ff', border: '1px solid #bae6fd'
                      }}>
                        {planName}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 900, color: '#15803d', fontSize: 13.5 }}>
                      {planAmt}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                      {fmtDate(app.submittedAt)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
                        backgroundColor: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
                        textTransform: 'uppercase'
                      }}>
                        {prettyStatus(app.status)}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleOpenDetail(app._id)}
                        style={{
                          padding: '6px 14px', borderRadius: 8, border: '1px solid #bfdbfe',
                          backgroundColor: '#eff6ff', color: '#1d4ed8', fontWeight: 800, fontSize: 11.5, cursor: 'pointer',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedApp && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
        }}>
          <div style={{
            backgroundColor: '#ffffff', borderRadius: 20, padding: 28, maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', color: '#0f172a'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>NHC Seller Application Detail</h3>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>ID: {appDetail?._id || selectedApp}</span>
              </div>
              <button
                onClick={() => { setSelectedApp(null); setAppDetail(null); }}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {detailLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading application profile...</div>
            ) : appDetail ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* MANDATORY SNAPSHOT CARD */}
                <div style={{
                  padding: 18, borderRadius: 14, backgroundColor: '#fffdf5',
                  border: '1.5px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  boxShadow: '0 2px 8px rgba(245, 158, 11, 0.08)'
                }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', color: '#b45309', letterSpacing: 0.8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>👑</span> SELECTED NHC PLAN SNAPSHOT
                    </span>
                    <h4 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 900, color: '#78350f' }}>
                      {appDetail.nhcPlan?.planName || 'Unit Seller'}
                    </h4>
                    {appDetail.nhcPlan?.planType && (
                      <span style={{ fontSize: 11, color: '#a16207', fontWeight: 600 }}>Type: {appDetail.nhcPlan.planType}</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>Plan Amount (Snapshot)</span>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#15803d' }}>
                      {appDetail.nhcPlan?.planAmount !== undefined ? `₹${Number(appDetail.nhcPlan.planAmount).toLocaleString('en-IN')}` : '₹10,00,000'}
                    </div>
                  </div>
                </div>

                {/* Status & Rejection Reason if any */}
                <div style={{ padding: 14, borderRadius: 12, backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>Application Status:</span>
                    <strong style={{
                      fontSize: 12, textTransform: 'uppercase', fontWeight: 900,
                      color: appDetail.status === 'approved' ? '#15803d' : appDetail.status === 'rejected' ? '#b91c1c' : '#b45309'
                    }}>
                      {prettyStatus(appDetail.status)}
                    </strong>
                  </div>
                  {appDetail.rejectionReason && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0', fontSize: 11.5, color: '#b91c1c' }}>
                      <strong>Rejection Reason:</strong> {appDetail.rejectionReason}
                    </div>
                  )}
                </div>

                {/* Business Information */}
                <div style={{ backgroundColor: '#ffffff', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                    Business Profile
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    <div><span style={{ color: '#64748b' }}>Store Name:</span> <strong style={{ color: '#0f172a' }}>{appDetail.business?.store?.name || appDetail.business?.businessName}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Phone:</span> <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>+91 {appDetail.account?.phone}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Email:</span> <strong style={{ color: '#0f172a' }}>{appDetail.account?.email || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Category:</span> <strong style={{ color: '#0f172a' }}>NHC Organization Seller</strong></div>
                  </div>
                </div>

                {/* Location */}
                <div style={{ backgroundColor: '#ffffff', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                    Store Location
                  </h4>
                  <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                    <div>{appDetail.location?.address || 'Address not specified'}</div>
                    <div>{appDetail.location?.city}, {appDetail.location?.state} - {appDetail.location?.pincode}</div>
                    {appDetail.location?.lat !== undefined && (
                      <div style={{ fontSize: 11, color: '#0284c7', marginTop: 4, fontWeight: 600 }}>
                        GPS Fixed: Lat {appDetail.location.lat}, Lng {appDetail.location.lng}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bank Credentials */}
                <div style={{ backgroundColor: '#ffffff', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                    Bank Credentials
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    <div><span style={{ color: '#64748b' }}>Holder Name:</span> <strong style={{ color: '#0f172a' }}>{appDetail.bank?.holderName || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Bank Name:</span> <strong style={{ color: '#0f172a' }}>{appDetail.bank?.bankName || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Account No:</span> <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{appDetail.bank?.accountNo || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>IFSC Code:</span> <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{appDetail.bank?.ifsc || '—'}</strong></div>
                  </div>
                </div>

                {/* KYC Scans */}
                {appDetail.documents && appDetail.documents.length > 0 && (
                  <div style={{ backgroundColor: '#ffffff', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#64748b' }}>
                      KYC Documents
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                      {appDetail.documents.map((doc, idx) => (
                        <a
                          key={idx}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: 10, borderRadius: 8, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0',
                            textDecoration: 'none', color: '#059669', fontSize: 11, fontWeight: 800, textAlign: 'center'
                          }}
                        >
                          📄 {doc.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  {appDetail.status !== 'approved' && (
                    <button
                      onClick={handleApprove}
                      disabled={actionSubmitting}
                      style={{
                        flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                        backgroundColor: '#10b981', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      {actionSubmitting ? 'Processing...' : '✓ Approve Application'}
                    </button>
                  )}
                  {appDetail.status !== 'rejected' && (
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={actionSubmitting}
                      style={{
                        flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                        backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: 800, fontSize: 13, cursor: 'pointer'
                      }}
                    >
                      ✕ Reject Application
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* REJECTION REASON MODAL */}
      {showRejectModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20
        }}>
          <div style={{
            backgroundColor: '#ffffff', borderRadius: 20, padding: 24, maxWidth: 440, width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', color: '#0f172a'
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 800, color: '#dc2626' }}>
              Reject NHC Seller Application
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
              Please state the reason for rejection. This will be visible to the seller.
            </p>

            <form onSubmit={handleRejectSubmit}>
              <textarea
                required
                rows={4}
                placeholder="e.g. Invalid Aadhaar KYC scan document attached."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 13, marginBottom: 20,
                  boxSizing: 'border-box'
                }}
              />

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff', color: '#475569', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionSubmitting}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none',
                    backgroundColor: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  {actionSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NhcApplicationsTab;
