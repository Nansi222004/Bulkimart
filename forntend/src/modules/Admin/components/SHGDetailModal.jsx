import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { apiUrl } from '../../../utils/api';

const STATUS_COLORS = {
  Approved: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
  Pending: { bg: '#fef3c7', text: '#b45309', border: '#fde68a' },
  Rejected: { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' },
  Suspended: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
};

export const SHGDetailModal = ({ shg, onClose, onRefresh }) => {
  const { approveShgVendor, rejectShgVendor, suspendShgVendor } = useAdmin();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const shgId = shg?.id || shg?._id;

  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      if (!shgId) return;
      setLoading(true);
      try {
        const token = localStorage.getItem('adminToken') || '';
        const res = await fetch(apiUrl(`/api/admin/shg/${shgId}`), {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        });
        const body = await res.json();
        if (isMounted && body.success) {
          setDetail(body.data);
        }
      } catch (err) {
        console.error('Error fetching SHG detail:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchDetail();
    return () => { isMounted = false; };
  }, [shgId]);

  if (!shg) return null;

  // Fallback calculations while full detail loads
  const groupName = detail?.group?.groupName || shg.groupName || 'SHG Cooperative';
  const leaderName = detail?.group?.leaderName || detail?.account?.name || shg.leaderName || '—';
  const phone = detail?.account?.phone || shg.phone || shg.raw?.userId?.phone || '—';
  const email = detail?.account?.email || shg.email || shg.raw?.userId?.email || 'shg@nhcone.com';
  
  // Format Date of Application
  const rawDate = detail?.registeredAt || detail?.submittedAt || shg.raw?.createdAt || shg.raw?.updatedAt;
  const applicationDate = rawDate
    ? new Date(rawDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : (shg.date || '—');

  // Full Address
  const village = detail?.group?.village || shg.village || '';
  const block = detail?.group?.block || shg.block || '';
  const district = detail?.group?.district || shg.district || '';
  const state = detail?.group?.state || shg.state || '';
  const pincode = detail?.group?.pincode || shg.pincode || '';
  const fullAddress = [village, block, district, state, pincode].filter(Boolean).join(', ') || 'Address not specified';

  const nrlmId = detail?.group?.nrlmId || shg.nrlmId || '—';
  const status = detail?.status
    ? (detail.status.charAt(0).toUpperCase() + detail.status.slice(1))
    : (shg.status || 'Pending');

  const membersList = detail?.members || shg.raw?.members || [];
  const membersCount = membersList.length || shg.membersCount || detail?.group?.totalMembers || 0;

  const documents = detail?.documents || [
    { label: 'Leader Aadhaar Front', url: shg.raw?.leaderAadhaar?.frontUrl },
    { label: 'Leader Aadhaar Back', url: shg.raw?.leaderAadhaar?.backUrl },
    { label: 'SHG Certificate', url: shg.raw?.shgCertUrl || shg.raw?.nrlmCertUrl },
    { label: 'Group Bank Passbook', url: shg.raw?.groupBankAccount?.passbookUrl },
  ].filter(d => d.url);

  const bank = detail?.bank || shg.raw?.groupBankAccount || {
    holderName: shg.bankName,
    accountNo: shg.accountNumber,
  };

  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.Pending;
  const initials = groupName.slice(0, 2).toUpperCase();

  const handleApprove = async () => {
    await approveShgVendor(shgId);
    if (onRefresh) onRefresh();
    onClose();
  };

  const handleSuspend = async () => {
    await suspendShgVendor(shgId);
    if (onRefresh) onRefresh();
    onClose();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      alert('Please enter a rejection reason.');
      return;
    }
    await rejectShgVendor(shgId, rejectReason.trim());
    if (onRefresh) onRefresh();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center',
      alignItems: 'center', zIndex: 1100, padding: 20
    }}>
      <div style={{
        backgroundColor: '#ffffff', borderRadius: 20, width: '100%',
        maxWidth: 940, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0'
      }}>
        
        {/* Header Bar */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, backgroundColor: '#10b981',
              color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: 20, letterSpacing: '1px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
            }}>
              {initials}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>{groupName}</h2>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, backgroundColor: '#f1f5f9',
                  color: '#475569', fontSize: 11, fontWeight: 800, fontFamily: 'monospace'
                }}>
                  {nrlmId !== '—' ? nrlmId : `SHG-${String(shgId).slice(-6).toUpperCase()}`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>Leader: <strong>{leaderName}</strong></span>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 800,
                  backgroundColor: statusStyle.bg, color: statusStyle.text, border: `1px solid ${statusStyle.border}`,
                  textTransform: 'uppercase'
                }}>
                  {status}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 800, backgroundColor: '#f3e8ff', color: '#7e22ce' }}>
                  SHG COOPERATIVE
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc', color: '#64748b', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Main Content (2 Columns) */}
        <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: 20 }}>
          
          {/* LEFT COLUMN: Contact, Documents & Store Health */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            
            {/* CONTACT CARD */}
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                Contact
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#334155' }}>
                  <span style={{ fontSize: 14, width: 18 }}>✉</span>
                  <span style={{ wordBreak: 'break-all', fontWeight: 600 }}>{email}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#0f172a', fontWeight: 800 }}>
                  <span style={{ fontSize: 14, width: 18 }}>📞</span>
                  <span>{phone}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>
                  <span style={{ fontSize: 14, width: 18, marginTop: 1 }}>📍</span>
                  <span>{fullAddress}</span>
                </div>
              </div>
            </div>

            {/* UPLOADED DOCUMENTS CARD */}
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                Uploaded Documents ({documents.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {documents.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic' }}>No documents uploaded yet.</div>
                ) : (
                  documents.map((doc, idx) => (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px', backgroundColor: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14 }}>📄</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#334155' }}>{doc.label}</span>
                      </div>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 10.5, fontWeight: 800, color: '#10b981', textDecoration: 'none',
                          backgroundColor: '#ecfdf5', padding: '3px 8px', borderRadius: 6, border: '1px solid #a7f3d0'
                        }}
                      >
                        VIEW
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* STORE HEALTH & DETAILS CARD */}
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                Store Health &amp; Info
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Verification</span>
                  <span style={{ fontWeight: 800, color: status === 'Approved' ? '#10b981' : '#f59e0b' }}>
                    {status === 'Approved' ? 'Verified' : 'Pending Audit'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Live Store Status</span>
                  <span style={{ fontWeight: 800, color: status === 'Approved' ? '#10b981' : '#64748b' }}>
                    {status === 'Approved' ? '🟢 OPEN (Online)' : '⚪ Inactive'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Application Date</span>
                  <span style={{ fontWeight: 800, color: '#0f172a' }}>{applicationDate}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>DAY-NRLM Code</span>
                  <span style={{ fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>{nrlmId}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Total Members</span>
                  <span style={{ fontWeight: 800, color: '#0f172a' }}>{membersCount} Members</span>
                </div>

              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Metrics, Performance & Roster */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            
            {/* 6 KPI METRICS GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              
              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Orders</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                  {detail?.metrics?.totalOrders ?? shg.totalOrders ?? 0}
                </div>
              </div>

              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Revenue</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                  ₹{Number(detail?.metrics?.revenue || 0).toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Products</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                  {detail?.metrics?.products?.approved ?? 0}
                </div>
              </div>

              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Rating</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
                  {detail?.metrics?.rating ? `⭐ ${detail.metrics.rating}` : '—'}
                </div>
              </div>

              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Commission</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
                  0%
                </div>
              </div>

              <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fulfillment</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                  100%
                </div>
              </div>

            </div>

            {/* PERFORMANCE & SOCIAL MISSION CARD */}
            <div style={{ padding: 16, backgroundColor: '#f0fdf4', borderRadius: 14, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', marginBottom: 4 }}>
                Performance &amp; Social Mission
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#166534', lineHeight: 1.5, fontWeight: 600 }}>
                100% of product revenue goes directly to the village women self-help group with 0% platform commission fee.
              </p>
            </div>

            {/* BANK ACCOUNT & MEMBER ROSTER */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 12 }}>
                Group Bank Account
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Bank Name</span>
                  <strong style={{ color: '#0f172a' }}>{bank.bankName || bank.holderName || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Account Number</span>
                  <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{bank.accountNo || bank.accountNumber || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>IFSC Code</span>
                  <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{bank.ifsc || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Holder Name</span>
                  <strong style={{ color: '#0f172a' }}>{bank.holderName || groupName}</strong>
                </div>
              </div>
            </div>

            {/* MEMBER ROSTER LIST */}
            {membersList.length > 0 && (
              <div style={{ backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>
                  Registered Members Roster ({membersList.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                  {membersList.map((m, idx) => (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: 8, fontSize: 11.5
                    }}>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.name || `Member #${idx + 1}`}</span>
                      <span style={{ color: '#64748b', fontSize: 11 }}>{m.role || 'Member'} • {m.phone || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* REJECTION INPUT IF TRIGGERED */}
            {showRejectInput && (
              <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', display: 'block', marginBottom: 6 }}>
                  Rejection Reason (will be shown to SHG group):
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Enter specific reason for rejecting application..."
                  rows={2}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #fca5a5', fontSize: 12, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowRejectInput(false)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#ffffff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    style={{ padding: '6px 14px', borderRadius: 6, border: 'none', backgroundColor: '#dc2626', color: '#ffffff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            )}

            {/* BOTTOM ACTION BUTTONS */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 'auto', paddingTop: 10 }}>
              
              {status !== 'Approved' && (
                <button
                  onClick={handleApprove}
                  style={{
                    padding: '10px 20px', borderRadius: 10, border: 'none',
                    backgroundColor: '#10b981', color: '#ffffff', fontWeight: 800,
                    fontSize: 12.5, cursor: 'pointer', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  ✓ Approve Cooperative
                </button>
              )}

              {status === 'Approved' && (
                <button
                  onClick={handleSuspend}
                  style={{
                    padding: '10px 18px', borderRadius: 10, border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff', color: '#dc2626', fontWeight: 800,
                    fontSize: 12.5, cursor: 'pointer'
                  }}
                >
                  Suspend Store
                </button>
              )}

              {status !== 'Approved' && status !== 'Rejected' && !showRejectInput && (
                <button
                  onClick={() => setShowRejectInput(true)}
                  style={{
                    padding: '10px 18px', borderRadius: 10, border: 'none',
                    backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: 800,
                    fontSize: 12.5, cursor: 'pointer'
                  }}
                >
                  Reject Application
                </button>
              )}

              <button
                onClick={onClose}
                style={{
                  padding: '10px 20px', borderRadius: 10, border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff', color: '#475569', fontWeight: 800,
                  fontSize: 12.5, cursor: 'pointer'
                }}
              >
                Close
              </button>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
};

export default SHGDetailModal;
