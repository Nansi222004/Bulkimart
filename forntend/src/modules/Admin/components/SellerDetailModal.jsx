import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const STATUS_COLORS = {
  approved: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', label: 'APPROVED' },
  pending: { bg: '#fef3c7', text: '#b45309', border: '#fde68a', label: 'PENDING' },
  under_review: { bg: '#fef3c7', text: '#b45309', border: '#fde68a', label: 'UNDER REVIEW' },
  rejected: { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca', label: 'REJECTED' },
  suspended: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'SUSPENDED' },
};

const prettyStatus = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const SellerDetailModal = ({ seller, loading, onClose, onRefresh }) => {
  const ui = useFeedback();
  const { approveSeller, rejectSeller, suspendSeller, setSellerRadius, setSellerWholesaleStatus, setSellerThirdPartyFulfillment, removeSellerAccount } = useAdmin();
  const [radiusInput, setRadiusInput] = useState(seller?.business?.store?.radiusKm ?? '');
  const [courierEnabled, setCourierEnabled] = useState(Boolean(seller?.thirdPartyFulfillment?.enabled));
  const [pickupLocation, setPickupLocation] = useState(seller?.thirdPartyFulfillment?.shiprocketPickupLocation || '');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectError, setRejectError] = useState('');
  const [removing, setRemoving] = useState(false);

  if (!seller && !loading) return null;

  const d = seller || {};
  const storeName = d.business?.store?.name || d.business?.businessName || 'Seller Store';
  const ownerName = d.account?.name || d.bank?.holderName || '—';
  const phone = d.account?.phone || d.business?.store?.phone || '—';
  const email = d.account?.email || '—';

  const rawDate = d.registeredAt || d.submittedAt || d.createdAt || d.updatedAt;
  const applicationDate = rawDate
    ? new Date(rawDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  const address = d.business?.store?.address || '';
  const city = d.business?.store?.city || '';
  const state = d.business?.store?.state || '';
  const pincode = d.business?.store?.pincode || '';
  const fullAddress = [address, city, state, pincode].filter(Boolean).join(', ') || 'Address not specified';

  const statusKey = (d.status || 'pending').toLowerCase();
  const statusStyle = STATUS_COLORS[statusKey] || STATUS_COLORS.pending;
  const initials = storeName.slice(0, 2).toUpperCase();

  const documents = d.documents || [];

  const handleSaveRadius = async () => {
    if (!d._id) return;
    await setSellerRadius(d._id, radiusInput === '' ? null : Number(radiusInput));
  };

  const handleSaveCourier = async () => {
    if (!d._id) return;
    const result = await setSellerThirdPartyFulfillment(d._id, { enabled: courierEnabled, shiprocketPickupLocation: pickupLocation.trim() });
    if (result?.ok && onRefresh) onRefresh();
  };

  const handleWholesaleDecision = async (status) => {
    if (!d._id) return;
    const action = async (reason) => {
      const result=await setSellerWholesaleStatus(d._id,status,reason);
      if(result?.ok && onRefresh) onRefresh();
      return result;
    };
    const message=`Set Wholesale access for ${storeName} to ${status}?`;
    if(status==='rejected')return ui.collect(message,{title:'Change Wholesale access?',required:false,inputLabel:'Reason',destructive:true,confirmLabel:'Update access',action});
    return ui.perform({title:'Change Wholesale access?',message,confirmLabel:'Update access'},()=>action(undefined));
  };

  const handleApprove = async () => {
    const result = await approveSeller(d._id);
    if (!result) return;
    if (onRefresh) onRefresh();
    onClose();
  };

  const handleSuspend = async () => {
    const result = await suspendSeller(d._id);
    if (!result) return;
    if (onRefresh) onRefresh();
    onClose();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setRejectError('Please enter a rejection reason.');
      return;
    }
    const result = await rejectSeller(d._id, rejectReason.trim());
    if (!result) return;
    if (onRefresh) onRefresh();
    onClose();
  };

  const handleRemove = async () => {
    return ui.perform('Remove this seller account? A reference-free onboarding profile may be permanently deleted. A seller with historical catalog, order, payout, or financial records will be deactivated instead. Active fulfillment or unresolved obligations will block the action.', async () => {
    setRemoving(true);
    const result = await removeSellerAccount(d._id);
    setRemoving(false);
    if (result?.ok) {
      if (onRefresh) onRefresh();
      onClose();
    }

});
};

  return (
    <ModalPortal style={{
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
              width: 52, height: 52, borderRadius: 14, backgroundColor: '#84cc16',
              color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: 20, letterSpacing: '1px', boxShadow: '0 4px 12px rgba(132, 204, 22, 0.25)'
            }}>
              {initials}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>{storeName}</h2>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, backgroundColor: '#f1f5f9',
                  color: '#475569', fontSize: 11, fontWeight: 800, fontFamily: 'monospace'
                }}>
                  SLR-{String(d._id || '').slice(-6).toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>Owned by: <strong>{ownerName}</strong></span>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 800,
                  backgroundColor: statusStyle.bg, color: statusStyle.text, border: `1px solid ${statusStyle.border}`,
                  textTransform: 'uppercase'
                }}>
                  {statusStyle.label}
                </span>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 800,
                  backgroundColor: '#eff6ff',
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe'
                }}>
                  SELLER
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

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading seller details…
          </div>
        ) : (
          /* Modal Main Content (2 Columns) */
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
              <div style={{ backgroundColor: '#f0fbff', border: '1px solid #bae6fd', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#075985', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Sales Channels
                </div>
                <div style={{ fontSize: 12, color: '#334155', marginBottom: 10 }}>
                  {(d.salesChannels || ['ecommerce']).map((channel) => channel === 'grocery' ? 'Quick Commerce' : channel === 'ecommerce' ? 'E-Commerce' : channel === 'wholesale' ? 'Wholesale' : channel).join(' · ')}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>
                  Wholesale request: <strong>{prettyStatus(d.wholesaleChannel?.status || 'not requested')}</strong>
                </div>
                {d.wholesaleChannel?.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => handleWholesaleDecision('approved')} style={{ border: 0, borderRadius: 7, background: '#08b9e8', color: '#fff', padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>Approve Wholesale</button>
                    <button type="button" onClick={() => handleWholesaleDecision('rejected')} style={{ border: '1px solid #fecaca', borderRadius: 7, background: '#fff', color: '#b91c1c', padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>Reject</button>
                  </div>
                )}
                {d.wholesaleChannel?.status === 'approved' && (
                  <button type="button" onClick={() => handleWholesaleDecision('suspended')} style={{ border: '1px solid #fecaca', borderRadius: 7, background: '#fff', color: '#b91c1c', padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>Suspend Wholesale Access</button>
                )}
                {d.wholesaleChannel?.status === 'suspended' && (
                  <button type="button" onClick={() => handleWholesaleDecision('approved')} style={{ border: '1px solid #bae6fd', borderRadius: 7, background: '#eaf9fe', color: '#075985', padding: '7px 10px', fontWeight: 700, cursor: 'pointer' }}>Restore Wholesale Access</button>
                )}
              </div>

              {/* STORE HEALTH & DETAILS CARD */}
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                  Store Health &amp; Info
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Verification</span>
                    <span style={{ fontWeight: 800, color: statusKey === 'approved' ? '#10b981' : '#f59e0b' }}>
                      {statusKey === 'approved' ? 'Verified' : 'Pending Audit'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Live Store Status</span>
                    <span style={{ fontWeight: 800, color: statusKey === 'approved' ? '#10b981' : '#64748b' }}>
                      {statusKey === 'approved' ? '🟢 OPEN (Online)' : '⚪ Inactive'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Joined / Registered</span>
                    <span style={{ fontWeight: 800, color: '#0f172a' }}>{applicationDate}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Business Type</span>
                    <span style={{ fontWeight: 800, color: '#0f172a' }}>{prettyStatus(d.business?.businessType)}</span>
                  </div>

                  {/* Service Radius Row */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 }}>
                    <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                      Service Radius (KM)
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={radiusInput}
                        onChange={(e) => setRadiusInput(e.target.value)}
                        placeholder="Unrestricted"
                        style={{ width: 100, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                      />
                      <button
                        onClick={handleSaveRadius}
                        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: '#3b82f6', color: '#ffffff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 }}>
                    <label style={{ color: '#64748b', fontSize: 11, fontWeight: 700, display: 'flex', gap: 7, alignItems: 'center' }}>
                      <input type="checkbox" checked={courierEnabled} onChange={(e) => setCourierEnabled(e.target.checked)} />
                      Enable Shiprocket for this vendor
                    </label>
                    <input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)}
                      placeholder="Registered Shiprocket pickup location code"
                      style={{ width: '100%', marginTop: 7, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }} />
                    <button onClick={handleSaveCourier} style={{ marginTop: 7, padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>Save courier link</button>
                  </div>

                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Metrics, Performance, Bank & Legal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* 6 KPI METRICS GRID */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                
                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Orders</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                    {d.metrics?.totalOrders ?? 0}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div title="This seller's delivered item sales, before commission and refunds" style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Revenue</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                    ₹{Number(d.metrics?.totalRevenue || 0).toLocaleString('en-IN')}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Products</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                    {d.metrics?.products?.approved ?? 0}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Delivered</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
                    {d.metrics?.deliveredOrders ?? 0}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Pending</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b', marginTop: 4 }}>
                    {d.metrics?.products?.pending ?? 0}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Commission</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
                    {d.metrics?.commissionRate ?? 10}%
                  </div>
                </div>

              </div>

              {/* PERFORMANCE CARD */}
              <div style={{ padding: 16, backgroundColor: '#f8fafc', borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>
                  Performance
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#334155', lineHeight: 1.5, fontWeight: 600 }}>
                  Active platform vendor listing with {d.metrics?.commissionRate ?? 10}% commission rate applied.
                </p>
              </div>

              {/* LEGAL & BANK DETAILS */}
              <div style={{ backgroundColor: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 12 }}>
                  Legal &amp; Bank Account Details
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>PAN Number</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.legal?.pan || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>GSTIN</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.legal?.gstin || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>FSSAI License</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.legal?.fssai || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Aadhaar (Last 4)</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.aadhaar?.number ? `•••• ${d.aadhaar.number}` : '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Bank Name</span>
                    <strong style={{ color: '#0f172a' }}>{d.bank?.bankName || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>Account Number</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.bank?.accountNo || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>IFSC Code</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.bank?.ifsc || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>UPI ID</span>
                    <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{d.bank?.upiId || '—'}</strong>
                  </div>
                </div>
              </div>

              {/* REJECTION REASON IF PRESENT */}
              {d.rejectionReason && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', textTransform: 'uppercase', marginBottom: 4 }}>
                    Rejection / Suspension Reason
                  </div>
                  <div style={{ fontSize: 12, color: '#7f1d1d' }}>{d.rejectionReason}</div>
                </div>
              )}

              {/* REJECTION INPUT IF TRIGGERED */}
              {showRejectInput && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 14 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', display: 'block', marginBottom: 6 }}>
                    Rejection Reason (will be shown to seller):
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => {setRejectReason(e.target.value);setRejectError('');}}
                    aria-label="Rejection reason"
                    aria-invalid={!!rejectError}
                    aria-describedby={rejectError ? 'seller-reject-error' : undefined}
                    placeholder="Enter specific reason for rejecting application..."
                    rows={2}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #fca5a5', fontSize: 12, boxSizing: 'border-box' }}
                  />
                  {rejectError && <p id="seller-reject-error" role="alert">{rejectError}</p>}
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
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #fecaca', backgroundColor: '#fff', color: '#b91c1c', fontWeight: 800, fontSize: 12.5, cursor: removing ? 'wait' : 'pointer' }}
                  title="Permanently deletes only reference-free accounts; otherwise deactivates while preserving history"
                >
                  {removing ? 'Checking…' : 'Delete / Deactivate Seller'}
                </button>
                
                {(statusKey === 'pending' || statusKey === 'under_review') && (
                  <>
                    <button
                      onClick={handleApprove}
                      style={{
                        padding: '10px 20px', borderRadius: 10, border: 'none',
                        backgroundColor: '#10b981', color: '#ffffff', fontWeight: 800,
                        fontSize: 12.5, cursor: 'pointer', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      ✓ Approve Vendor
                    </button>
                    {!showRejectInput && (
                      <button
                        onClick={() => setShowRejectInput(true)}
                        style={{
                          padding: '10px 18px', borderRadius: 10, border: 'none',
                          backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: 800,
                          fontSize: 12.5, cursor: 'pointer'
                        }}
                      >
                        ✕ Reject
                      </button>
                    )}
                  </>
                )}

                {statusKey === 'approved' && (
                  <button
                    onClick={handleSuspend}
                    style={{
                      padding: '10px 18px', borderRadius: 10, border: '1px solid #cbd5e1',
                      backgroundColor: '#ffffff', color: '#dc2626', fontWeight: 800,
                      fontSize: 12.5, cursor: 'pointer'
                    }}
                  >
                    Suspend Vendor
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
        )}

      </div>
    </ModalPortal>
  );
};

export default SellerDetailModal;
