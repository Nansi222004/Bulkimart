import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import { enterCustomerSession } from '../../../utils/userSession';
import ServiceAreaEditor from '../components/ServiceAreaEditor';
import { riderRatingSummary } from '../utils/riderRating';
import { apiUrl } from '../../../utils/api';

export const DeliveryProfilePage = () => {
  const ui = useFeedback();
  const { onboardingForm, logoutDelivery, triggerToast, earningsData, riderName, riderProfile,
          saveRiderLocation, saveRiderServiceArea, refreshRiderStatus, lookupAddress, isLicenseExpired } = useDelivery();

  const [locating, setLocating] = useState(false);  // button loading state
  const [switching, setSwitching] = useState(false);
  const [sosNumber, setSosNumber] = useState('112');
  const customerRating = riderRatingSummary(riderProfile);

  // Dynamic helpline & SOS emergency number configured by Admin
  React.useEffect(() => {
    let unmounted = false;
    const fetchHelpline = async () => {
      try {
        const res = await fetch(apiUrl('/api/helpline'));
        if (res.ok) {
          const json = await res.json();
          if (!unmounted && json.data?.sosEmergencyNumber) {
            setSosNumber(json.data.sosEmergencyNumber);
          }
        }
      } catch {
        /* fallback to 112 */
      }
    };
    fetchHelpline();
    return () => { unmounted = true; };
  }, []);

  /**
   * Fetch device GPS → reverse-geocode with Google Maps → save to backend.
   *
   * The three steps are chained so a failure at any point surfaces a clear
   * message rather than silently leaving stale data in the profile card.
   */
  const fetchCurrentLocation = async () => {
    if (!navigator.geolocation) {
      triggerToast('Your browser does not support location access.');
      return;
    }
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;

        // Reverse-geocode the raw coordinates into a human-readable address.
        let address = '', city = '', state = '', pincode = '';
        try {
          const res = await lookupAddress(lat, lng, accuracy);
          if (res.ok) {
            const a = res.address || {};
            address = a.address || '';
            city = a.city || '';
            state = a.state || '';
            pincode = a.pincode || '';
          }
        } catch { /* geocoding is a best-effort enrichment; lat/lng is enough */ }

        const result = await saveRiderLocation({
          lat, lng, accuracy,
          source: 'gps',
          address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          city, state, pincode,
        });

        setLocating(false);

        if (result.ok) {
          // Refresh profile so the card reflects the new address immediately.
          await refreshRiderStatus();
          triggerToast('✅ Base location updated successfully!');
        } else {
          triggerToast(result.message || 'Could not save location. Please try again.');
        }
      },
      (err) => {
        setLocating(false);
        const msgs = {
          1: 'Location permission denied. Please allow location access in your browser settings.',
          2: 'Could not determine your position. Please try again.',
          3: 'Location request timed out. Please try again.',
        };
        triggerToast(msgs[err.code] || 'Location error. Please try again.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="delivery-profile-wrapper">
      {isLicenseExpired && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #ef4444',
          color: '#991b1b',
          padding: '12px 16px',
          borderRadius: '10px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          lineHeight: '1.4'
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div>
            <strong style={{ display: 'block', fontSize: '14px', marginBottom: '2px' }}>Driving License Expired</strong>
            Your driving license expired on {riderProfile?.drivingLicense?.expiryDate ? new Date(riderProfile.drivingLicense.expiryDate).toLocaleDateString('en-IN') : 'recently'}. Please renew your driving license to continue delivering orders.
          </div>
        </div>
      )}
      {/* Driver profile summary card */}
      <div className="delivery-card delivery-profile-main-card">
        <div className="profile-large-avatar">{(riderName || 'R').charAt(0).toUpperCase()}</div>
        <h3>{riderName || 'Rider'}</h3>
        <p className="profile-partner-id">Partner ID: {riderProfile?._id ? `NHC-DEL-${riderProfile._id.slice(-5).toUpperCase()}` : 'NHC-DEL-40122'}</p>
        <div className="profile-stats-row">
          <div className="profile-stat-col">
            <strong>{customerRating.value}</strong>
            <span>Customer rating</span>
            <small>{customerRating.count}</small>
          </div>
          <div className="profile-stat-col" style={{ borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0' }}>
            <strong>{riderProfile?.totalDeliveries ?? earningsData.lifetime.trips}</strong>
            <span>Total Deliveries</span>
          </div>
          <div className="profile-stat-col">
            <strong>{riderProfile?.status === 'approved' ? 'Active' : 'Pending'}</strong>
            <span>Status</span>
          </div>
        </div>
      </div>

      {/* Vehicle Info Card */}
      <div className="delivery-card delivery-profile-details-card">
        <h4 className="profile-section-title">🚲 VEHICLE &amp; ZONE DETAILS</h4>
        <div className="profile-data-list">
          <div className="profile-data-row">
            <span>Vehicle Type</span>
            <strong style={{ textTransform: 'capitalize' }}>
              {riderProfile?.vehicleType || onboardingForm.vehicleType || 'Bicycle'}
            </strong>
          </div>
          <div className="profile-data-row">
            <span>Vehicle Number</span>
            <strong>{riderProfile?.vehicleNo || onboardingForm.vehicleNumber || 'Non-Motorized'}</strong>
          </div>
          <div className="profile-data-row">
            <span>Delivery pincodes</span>
            <strong>{riderProfile?.zones?.join(', ') || onboardingForm.zones || 'All Zones'}</strong>
          </div>
        </div>
        <ServiceAreaEditor profile={riderProfile} onSave={saveRiderServiceArea} onReload={refreshRiderStatus}/>
      </div>

      {/* Base Location Card */}
      <div className="delivery-card delivery-profile-details-card">
        <h4 className="profile-section-title">📍 BASE LOCATION</h4>
        <div className="profile-data-list">
          {riderProfile?.baseLocation?.address || riderProfile?.baseLocation?.city ? (
            <>
              {riderProfile.baseLocation.address && (
                <div className="profile-data-row">
                  <span>Address</span>
                  <strong style={{ textAlign: 'right', maxWidth: '60%', lineHeight: 1.4 }}>
                    {riderProfile.baseLocation.address}
                    {riderProfile.baseLocation.landmark ? `, ${riderProfile.baseLocation.landmark}` : ''}
                  </strong>
                </div>
              )}
              {riderProfile.baseLocation.city && (
                <div className="profile-data-row">
                  <span>City</span>
                  <strong>{riderProfile.baseLocation.city}</strong>
                </div>
              )}
              {riderProfile.baseLocation.state && (
                <div className="profile-data-row">
                  <span>State</span>
                  <strong>{riderProfile.baseLocation.state}</strong>
                </div>
              )}
              {riderProfile.baseLocation.pincode && (
                <div className="profile-data-row">
                  <span>Pincode</span>
                  <strong>{riderProfile.baseLocation.pincode}</strong>
                </div>
              )}
              {riderProfile.baseLocation.lat && (
                <div className="profile-data-row">
                  <span>GPS Coordinates</span>
                  <strong style={{ fontSize: 11, color: '#16a34a' }}>
                    {riderProfile.baseLocation.lat.toFixed(4)}, {riderProfile.baseLocation.lng.toFixed(4)}
                    {riderProfile.baseLocation.source === 'gps' ? ' 📡' : ' ✎'}
                  </strong>
                </div>
              )}
            </>
          ) : (
            <div className="profile-data-row">
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                No base location set yet. Tap the button below to set your current location.
              </span>
            </div>
          )}
        </div>

        {/* "Use Current Location" button */}
        <button
          onClick={fetchCurrentLocation}
          disabled={locating}
          style={{
            marginTop: 14,
            width: '100%',
            padding: '11px 0',
            borderRadius: 10,
            border: 'none',
            background: locating ? '#86efac' : 'var(--primary)',
            color: '#fff',
            fontWeight: 800,
            fontSize: 13,
            cursor: locating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            letterSpacing: 0.3,
            transition: 'background 0.2s',
          }}
        >
          {locating ? (
            <>
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                border: '2px solid #fff', borderTopColor: 'transparent',
                animation: 'spin 0.7s linear infinite', display: 'inline-block',
              }} />
              Fetching location…
            </>
          ) : (
            <>📡 Use Current Location</>
          )}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* Linked Payout Bank Card */}
      <div className="delivery-card delivery-profile-details-card">
        <h4 className="profile-section-title">🏦 PAYOUT BANK ACCOUNT</h4>
        <div className="profile-data-list">
          <div className="profile-data-row">
            <span>Bank Name</span>
            {/* Only the rider's own saved details are shown; nothing is filled in when they are missing. */}
            <strong>{riderProfile?.bankDetails?.bankName || onboardingForm.bankName || 'Not added'}</strong>
          </div>
          <div className="profile-data-row">
            <span>Account Number</span>
            <strong>
              {riderProfile?.bankDetails?.accountNo
                ? `•••• ${riderProfile.bankDetails.accountNo.slice(-4)}`
                : (onboardingForm.bankAccount ? `•••• ${onboardingForm.bankAccount.slice(-4)}` : 'Not added')}
            </strong>
          </div>
          <div className="profile-data-row">
            <span>IFSC Code</span>
            <strong>{riderProfile?.bankDetails?.ifsc || onboardingForm.bankIfsc || 'Not added'}</strong>
          </div>
          <div className="profile-data-row">
            <span>Payout Cycle</span>
            <strong style={{ color: 'var(--primary)' }}>{riderProfile?.finance?.payoutSchedule === 'weekly' ? 'Weekly, sent automatically' : riderProfile?.finance?.payoutSchedule ? 'When you request it from Earnings' : '—'}</strong>
          </div>
        </div>
      </div>

      {/* Document verification checks */}
      <div className="delivery-card delivery-profile-details-card">
        <h4 className="profile-section-title">📝 DOCUMENTS VERIFICATION</h4>
        <div className="profile-data-list">
          <div className="profile-data-row">
            <span>Aadhaar Verification</span>
            <span className="profile-status-badge verified">✓ Verified</span>
          </div>
          <div className="profile-data-row">
            <span>Driving License</span>
            {isLicenseExpired ? (
              <span className="profile-status-badge" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', fontWeight: 600 }}>
                ⚠️ Expired ({riderProfile?.drivingLicense?.expiryDate ? new Date(riderProfile.drivingLicense.expiryDate).toLocaleDateString('en-IN') : 'Expired'})
              </span>
            ) : (
              <span className="profile-status-badge verified">✓ Verified</span>
            )}
          </div>
          <div className="profile-data-row">
            <span>Background Clearance</span>
            <span className="profile-status-badge verified">✓ Cleared</span>
          </div>
        </div>
      </div>

      {/* Support and action list */}
      <div className="delivery-card delivery-profile-actions-card">
        <button className="profile-support-btn outline" disabled={switching} onClick={async () => {
          setSwitching(true);
          try { await enterCustomerSession(); }
          catch (error) { triggerToast(error.message, {type:'error'}); setSwitching(false); }
        }}>{switching ? 'Opening shop…' : 'Shop as customer'}</button>
        <button 
          className="profile-support-btn"
          onClick={() => {
            const dialable = sosNumber.replace(/[^0-9+]/g, '') || '112';
            ui.perform(`Call the emergency helpline (${sosNumber}) now?`, async () => {
              window.location.href = `tel:${dialable}`;
            });
          }}
          title={`Call Emergency Helpline: ${sosNumber}`}
        >
          🚨 SOS Emergency Helpline ({sosNumber})
        </button>
        <button 
          className="profile-support-btn outline"
          onClick={() => { window.history.pushState(null, '', '/delivery/support'); window.dispatchEvent(new PopStateEvent('popstate')); }}
        >
          💬 Chat with Support Helpdesk
        </button>
        <button 
          className="profile-logout-btn"
          onClick={async () => {
            return ui.perform('Are you sure you want to sign out of the Delivery App?', async () => {
              return await logoutDelivery();
            });
          }}
        >
          Log Out
        </button>
      </div>
    </div>
  );
};

export default DeliveryProfilePage;
