import React from 'react';
import { useSHG } from '../context/SHGContext';

const SHGAccountTab = () => {
  const {
    groupForm,
    registrationForm,
    applicationId,
    applicationDate,
    pinSHGStoreLocation,
    updatingLocation,
    activeMode,
    logoutSHG,
  } = useSHG();

  return (
    <div className="shg-tab-content" style={{ padding: '16px 18px 32px', overflowY: 'auto' }}>
      
      {/* Quick Commerce Location Gate Warning */}
      {activeMode === 'quick' && !(groupForm.lat && groupForm.lng) && (
        <div className="shg-card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', background: '#fffbe6' }}>
          <div style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <div>
                <h4 style={{ margin: 0, fontSize: 13, color: '#b45309', fontWeight: 800 }}>Store Location Required for Quick Commerce</h4>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#92400e' }}>
                  Quick Commerce products require accurate GPS coordinates for distance calculation and delivery eligibility.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={pinSHGStoreLocation}
              disabled={updatingLocation}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#d97706',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                cursor: updatingLocation ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {updatingLocation ? 'Fetching...' : '📍 Fetch Current Location'}
            </button>
          </div>
        </div>
      )}

      {/* Verification Status */}
      <div className="shg-card" style={{ marginBottom: 16 }}>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
          <div className="shg-verified-icon">✓</div>
          <div>
            <h4 style={{ margin: 0, fontSize: 13, color: 'var(--shg-success)', fontWeight: 800 }}>SHG PROFILE VERIFIED</h4>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--shg-success)' }}>Approved by block administrator on {applicationDate}</p>
          </div>
        </div>
        <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
          <div>
            <span style={{ color: 'var(--shg-text-muted)' }}>Application ID:</span>
            <div style={{ fontWeight: 700, color: 'var(--shg-text-primary)' }}>{applicationId}</div>
          </div>
          <div>
            <span style={{ color: 'var(--shg-text-muted)' }}>Registered On:</span>
            <div style={{ fontWeight: 700, color: 'var(--shg-text-primary)' }}>{applicationDate}</div>
          </div>
        </div>
      </div>

      {/* SHG Group Profile Card */}
      <div className="shg-card" style={{ marginBottom: 16 }}>
        <div className="shg-card-header">
          <h4 className="shg-card-title">SHG Group Profile</h4>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Group Name</span>
            <span className="shg-review-val">{groupForm.groupName}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Leader (President)</span>
            <span className="shg-review-val">{groupForm.leaderName}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Total Members</span>
            <span className="shg-review-val">{groupForm.totalMembers}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Formation Year</span>
            <span className="shg-review-val">{groupForm.formationYear}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Primary Category</span>
            <span className="shg-review-val">{groupForm.primaryCategory}</span>
          </div>
          <div className="shg-review-row" style={{ padding: 0, borderBottom: 'none' }}>
            <span className="shg-review-key">Operating Address</span>
            <span className="shg-review-val">
              {[groupForm.houseNo, groupForm.street, groupForm.village, groupForm.block, groupForm.district, groupForm.state, groupForm.pincode].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Store / Business Location Card */}
      <div className="shg-card" style={{ marginBottom: 16 }}>
        <div className="shg-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 className="shg-card-title">📍 Store Location (Fulfillment Center)</h4>
          <button
            type="button"
            onClick={pinSHGStoreLocation}
            disabled={updatingLocation}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--shg-primary, #059669)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              cursor: updatingLocation ? 'not-allowed' : 'pointer',
              opacity: updatingLocation ? 0.7 : 1,
            }}
          >
            {updatingLocation ? 'Pinning...' : groupForm.lat ? '📍 Update Location' : '📍 Fetch Current Location'}
          </button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Location Status</span>
            <span className="shg-review-val">
              {groupForm.lat && groupForm.lng ? (
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Location Pinned ({Number(groupForm.lat).toFixed(4)}, {Number(groupForm.lng).toFixed(4)})
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--shg-text-muted, #94a3b8)' }}>Location not set</span>
              )}
            </span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Latitude</span>
            <span className="shg-review-val">{groupForm.lat !== null && groupForm.lat !== undefined ? groupForm.lat : '—'}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Longitude</span>
            <span className="shg-review-val">{groupForm.lng !== null && groupForm.lng !== undefined ? groupForm.lng : '—'}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Accuracy</span>
            <span className="shg-review-val">{groupForm.accuracy ? `${groupForm.accuracy} meters` : '—'}</span>
          </div>
          <div className="shg-review-row" style={{ padding: 0, borderBottom: 'none' }}>
            <span className="shg-review-key">Location Source</span>
            <span className="shg-review-val">{groupForm.locationSource ? String(groupForm.locationSource).toUpperCase() : 'GPS'}</span>
          </div>
        </div>
      </div>

      {/* NRLM / Registration Card */}
      <div className="shg-card" style={{ marginBottom: 16 }}>
        <div className="shg-card-header">
          <h4 className="shg-card-title">Registration Credentials</h4>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">SHG Reg ID</span>
            <span className="shg-review-val">{registrationForm.shgRegId}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">NRLM / DAY-NRLM ID</span>
            <span className="shg-review-val">{registrationForm.nrlmId}</span>
          </div>
          <div className="shg-review-row" style={{ padding: 0, borderBottom: 'none' }}>
            <span className="shg-review-key">Federation Name</span>
            <span className="shg-review-val">{registrationForm.federationName}</span>
          </div>
        </div>
      </div>

      {/* Settlement Bank Card */}
      <div className="shg-card" style={{ marginBottom: 16 }}>
        <div className="shg-card-header">
          <h4 className="shg-card-title">Group Settlement Bank</h4>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Bank Name</span>
            <span className="shg-review-val">{registrationForm.bankName}</span>
          </div>
          <div className="shg-review-row" style={{ padding: '0 0 8px 0', borderBottom: '1px solid var(--shg-border)' }}>
            <span className="shg-review-key">Account Number</span>
            <span className="shg-review-val">{registrationForm.bankAccountNo}</span>
          </div>
          <div className="shg-review-row" style={{ padding: 0, borderBottom: 'none' }}>
            <span className="shg-review-key">IFSC Code</span>
            <span className="shg-review-val">{registrationForm.ifscCode}</span>
          </div>
        </div>
      </div>

      {/* Logout Action Section */}
      <div style={{ marginTop: 24, marginBottom: 12, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => { if (window.confirm('Logout of SHG Store Panel?')) logoutSHG(); }}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 'var(--shg-radius-md, 14px)',
            border: '1.5px solid #fee2e2',
            background: '#fff5f5',
            color: 'var(--shg-error, #dc2626)',
            fontWeight: 800,
            fontSize: 14,
            fontFamily: "'Outfit', sans-serif",
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all 0.2s ease',
            boxShadow: '0 2px 8px rgba(220, 38, 38, 0.08)'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Logout of SHG Panel</span>
        </button>
      </div>
    </div>
  );
};

export default SHGAccountTab;
