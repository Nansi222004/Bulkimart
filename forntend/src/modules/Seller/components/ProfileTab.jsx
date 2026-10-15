import PickupSyncCard from './PickupSyncCard';
import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { apiUrl } from '../../../utils/api';

export const ProfileTab = () => {
  const { sellerProfile, profileLoading, triggerToast, selectedTypes, toggleSellerType, fetchSellerProfile, logoutSeller } = useSeller();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updatingLocation, setUpdatingLocation] = useState(false);

  let account = {};
  try { account = JSON.parse(localStorage.getItem('sellerUserProfile') || '{}'); } catch { /* ignore */ }

  if (profileLoading && !sellerProfile) {
    return (
      <div style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
        Loading seller profile…
      </div>
    );
  }

  if (!sellerProfile) {
    return (
      <div style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🏪</div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>
          No store details found
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Complete your seller registration to see your business profile here.
        </div>
      </div>
    );
  }

  const s = sellerProfile;
  const store = s.storeDetails || {};
  const sellerIdStr = `SLR-${(s._id || s.id || 'VQGUKYWK').slice(-8).toUpperCase()}`;

  const copySellerId = () => {
    navigator.clipboard.writeText(sellerIdStr);
    setCopied(true);
    triggerToast('Seller ID copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePinLocation = () => {
    if (!navigator.geolocation) {
      triggerToast('Geolocation is not supported by your browser.', 'error');
      return;
    }
    setUpdatingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy);

          let address = '';
          let city = '';
          let state = '';
          let pincode = '';

          try {
            const res = await fetch(
              apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}&accuracy=${accuracy}`),
              { headers: { Authorization: 'Bearer ' + localStorage.getItem('sellerToken') } }
            );
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
              const a = body.data || {};
              address = a.address || '';
              city = a.city || '';
              state = a.state || '';
              pincode = a.pincode || '';
            }
          } catch (e) {
            console.warn('Address lookup failed', e);
          }

          const formData = new FormData();
          formData.append('lat', lat);
          formData.append('lng', lng);
          if (address) formData.append('address', address);
          if (city) formData.append('city', city);
          if (state) formData.append('state', state);
          if (pincode) formData.append('pincode', pincode);
          
          const token = localStorage.getItem('sellerToken');
          
          const res = await fetch(apiUrl('/api/sellers/profile'), {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          
          if (!res.ok) throw new Error('Failed to update location');
          triggerToast('Store location pinned successfully!');
          await fetchSellerProfile();
        } catch (error) {
          console.error(error);
          triggerToast('Error updating location.', 'error');
        } finally {
          setUpdatingLocation(false);
        }
      },
      (err) => {
        setUpdatingLocation(false);
        triggerToast('Failed to get location. Please allow location access.', 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 8px 40px 8px', fontFamily: "'Outfit', sans-serif" }}>
      <style dangerouslySetInnerHTML={{__html: `
        .profile-grid-container {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
          margin-top: 24px;
        }
        @media (min-width: 850px) {
          .profile-grid-container {
            grid-template-columns: 1fr 320px;
          }
        }
        .profile-input-box {
          background-color: #f8fafc;
          border: 1.5px solid #f1f5f9;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 10px;
        }
      `}} />

      {/* 1. TOP DARK HERO PROFILE CARD */}
      <div style={{
        backgroundColor: '#0b132b',
        borderRadius: 24,
        padding: '32px 36px',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 20,
        boxShadow: '0 12px 30px rgba(11, 19, 43, 0.25)'
      }}>
        {/* Left: Avatar & Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Avatar Circle */}
          <div style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            backgroundColor: '#fff',
            color: '#0f172a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            fontWeight: 900,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            flexShrink: 0
          }}>
            {(s.businessName || store.name || 'A').charAt(0).toUpperCase()}
          </div>

          <div>
            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1px', backgroundColor: 'rgba(255,255,255,0.12)', color: '#94a3b8', padding: '3px 8px', borderRadius: 12 }}>
                SELLER
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, backgroundColor: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#fff' }} />
                ACTIVE
              </span>
            </div>

            {/* Store / Seller Name */}
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
              {s.businessName || 'Amit'}
            </h1>
            <p style={{ margin: '2px 0 8px 0', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
              {store.name || 'shop'}
            </p>

            {/* Seller ID Pill */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 800,
              color: '#cbd5e1'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
              ID: {sellerIdStr}
            </div>
          </div>
        </div>

        {/* Right: Edit Profile Button */}
        <div>
          <button
            onClick={() => triggerToast('Profile editing enabled.')}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1.5px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 12,
              color: '#fff',
              padding: '10px 20px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s ease'
            }}
          >
            <span>✏️</span> EDIT PROFILE
          </button>
        </div>
      </div>

      {/* 2. TWO-COLUMN CONTENT GRID */}
      <div className="profile-grid-container">
        {/* LEFT COLUMN: Business Profile */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{
            backgroundColor: '#fff',
            border: '1.5px solid #f1f5f9',
            borderRadius: 20,
            padding: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 17, fontWeight: 900, color: '#0f172a' }}>
              Business Profile
            </h3>

            {/* Dark Unique Seller ID Card */}
            <div style={{
              backgroundColor: '#0b132b',
              borderRadius: 14,
              padding: '14px 20px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fff'
            }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  UNIQUE SELLER ID
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} />
                  {sellerIdStr}
                </div>
              </div>
              <button
                onClick={copySellerId}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                {copied ? 'COPIED!' : 'COPY'}
              </button>
            </div>

            {/* Form Fields Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                  SELLER IDENTITY
                </label>
                <div className="profile-input-box">
                  <span style={{ color: '#94a3b8' }}>👤</span>
                  <span>{s.businessName || 'Amit'}</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                  STORE NAME
                </label>
                <div className="profile-input-box">
                  <span style={{ color: '#94a3b8' }}>🏪</span>
                  <span>{store.name || 'shop'}</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                  CONTACT NUMBER
                </label>
                <div className="profile-input-box">
                  <span style={{ color: '#94a3b8' }}>📞</span>
                  <span>{account.phone || store.phone || '7999810344'}</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                  ALTERNATIVE PHONE (OPTIONAL)
                </label>
                <div className="profile-input-box" style={{ color: '#94a3b8' }}>
                  <span>📞</span>
                  <span>{store.phone ? `+91 ${store.phone}` : 'e.g. 9876543210'}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                EMAIL ADDRESS
              </label>
              <div className="profile-input-box">
                <span style={{ color: '#94a3b8' }}>✉️</span>
                <span>{account.email || 'amitmankar1052@gmail.com'}</span>
              </div>
            </div>
          </div>

          {/* Store Address & Map Pin */}
          <div style={{
            backgroundColor: '#fff',
            border: '1.5px solid #f1f5f9',
            borderRadius: 20,
            padding: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0f172a' }}>
                📍 Store Address & Location Pin
              </h3>
              <button
                onClick={handlePinLocation}
                disabled={updatingLocation}
                style={{
                  padding: '7px 14px',
                  fontSize: 11,
                  fontWeight: 800,
                  borderRadius: 100,
                  border: '1px solid #a7f3d0',
                  background: '#ecfdf5',
                  color: '#047857',
                  cursor: updatingLocation ? 'not-allowed' : 'pointer'
                }}
              >
                {updatingLocation ? 'Pinning...' : '📍 Update Location'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>ADDRESS</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{store.address || 'Corporate House, Chhoti Gwaltoli'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>CITY / DISTRICT</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{store.city || 'Indore'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>STATE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{store.state || 'Madhya Pradesh'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>PIN CODE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{store.pincode || '452001'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Security & Trust & Logout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Dark Security & Trust Box */}
          <div style={{
            backgroundColor: '#0b132b',
            borderRadius: 20,
            padding: 24,
            color: '#fff',
            boxShadow: '0 8px 24px rgba(11, 19, 43, 0.2)'
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 20 }}>
              SECURITY & TRUST
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Row 1: Verification */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                  🛡️
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>VERIFICATION</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginTop: 1 }}>Verified Merchant</div>
                </div>
              </div>

              {/* Row 2: Partner Tier */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                  🚀
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>PARTNER TIER</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginTop: 1 }}>Standard Growth</div>
                </div>
              </div>

              {/* Row 3: Region */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                  🌐
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>REGION</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginTop: 1 }}>Pan India Reach</div>
                </div>
              </div>
            </div>
          </div>

          {/* Logout Account Button */}
          <button
            onClick={() => {
              if (!window.confirm('Log out of your seller account?')) return;
              logoutSeller();
            }}
            style={{
              width: '100%',
              backgroundColor: '#fff',
              border: '1.5px solid #fecaca',
              borderRadius: 14,
              color: '#dc2626',
              padding: '12px 20px',
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.01)'
            }}
          >
            <span>[→</span> Logout Account
          </button>
        </div>
      </div>

      <PickupSyncCard key={s._id} seller={s} refreshSeller={fetchSellerProfile} />

      {/* 3. LOWER SECTION: SHOP OPERATING HOURS */}
      <div style={{
        marginTop: 24,
        backgroundColor: '#fff',
        border: '1.5px solid #f1f5f9',
        borderRadius: 20,
        padding: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#0b132b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
            🕒
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
              Shop Operating Hours
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Set daily store opening and closing times. Products are hidden when shop is closed.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 16 }}>
          <div className="profile-input-box">
            <span style={{ fontSize: 12, color: '#64748b' }}>Store Opening:</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>09:00 AM</span>
          </div>
          <div className="profile-input-box">
            <span style={{ fontSize: 12, color: '#64748b' }}>Store Closing:</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>10:00 PM</span>
          </div>
          <div className="profile-input-box">
            <span style={{ fontSize: 12, color: '#64748b' }}>Status:</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#166534', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>OPEN NOW</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileTab;
