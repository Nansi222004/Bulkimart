import React, { useState } from 'react';
import { useUser } from '../context/UserContext';

const LocationPromptModal = () => {
  const {
    showLocationModal,
    setShowLocationModal,
    saveDeliveryLocation,
    lookupTypedLocation,
    savedAddresses = [],
    setDefaultAddress,
    location,
    setLocation,
    setActiveNav,
  } = useUser();

  const [mode, setMode] = useState('options'); // 'options' (Screen 1) | 'select' (Screen 2)
  const [manualLocation, setManualLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!showLocationModal) return null;

  /**
   * Fetch live GPS coordinates from the browser & update backend/local state.
   */
  const handleAllowAccess = () => {
    if (!navigator.geolocation) {
      setError('This browser cannot read your location. Please enter it manually.');
      setMode('select');
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const res = await saveDeliveryLocation(
          {
            lat: Number(position.coords.latitude.toFixed(6)),
            lng: Number(position.coords.longitude.toFixed(6)),
            accuracy: Math.round(position.coords.accuracy),
          },
          'gps'
        );

        setLoading(false);

        if (!res.ok) {
          setError(res.message || 'Could not save your location.');
          return;
        }

        localStorage.setItem('locationAsked', 'true');
        setShowLocationModal(false);
      },
      (err) => {
        setLoading(false);
        const messages = {
          1: 'You blocked location access. Allow it, or enter your location manually.',
          2: 'Your location could not be determined right now.',
          3: 'Finding your location took too long. Please try again.',
        };
        setError(messages[err.code] || 'Could not read your location.');
        setMode('select');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  /**
   * Save a typed manual location from the search bar.
   */
  const handleSaveManual = async (e) => {
    if (e) e.preventDefault();
    const typed = manualLocation.trim();
    if (!typed) {
      setError('Please enter an area or street name.');
      return;
    }
    if (typed.length < 3) {
      setError('Type at least 3 characters to search.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await lookupTypedLocation(typed);
    setLoading(false);

    if (!res.ok) {
      setError(res.message || 'We could not find that place. Try a nearby landmark or pincode.');
      return;
    }

    localStorage.setItem('locationAsked', 'true');
    setShowLocationModal(false);
  };

  /**
   * Handle selecting a saved address item.
   */
  const handleSelectSavedAddress = async (addr) => {
    try {
      setLoading(true);
      setError(null);
      if (setDefaultAddress && addr._id) {
        await setDefaultAddress(addr._id);
      }
      const label = [addr.placeName || addr.line1, addr.city, addr.pincode].filter(Boolean).join(', ');
      setLocation(label);
      localStorage.setItem('userLocation', label);
      localStorage.setItem('locationAsked', 'true');
      setLoading(false);
      setShowLocationModal(false);
    } catch {
      setLoading(false);
      setShowLocationModal(false);
    }
  };

  /**
   * Navigate to Add Address inside Account profile tab.
   */
  const handleAddNewAddress = () => {
    setShowLocationModal(false);
    if (setActiveNav) {
      setActiveNav('account');
    }
  };

  return (
    <div style={styles.overlay} onClick={() => setShowLocationModal(false)}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        {mode === 'options' ? (
          /* ==========================================
             SCREEN 1: Location Access Required (Image 2)
             ========================================== */
          <>
            <div style={styles.iconContainer}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>

            <h2 style={styles.title}>Location Access Required</h2>

            <p style={styles.description}>
              We need your location to show you products available near you and enable delivery services. Location access is required to continue.
            </p>

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.btnCol}>
              <button
                onClick={handleAllowAccess}
                disabled={loading}
                style={styles.btnAllow}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                  </svg>
                  <span>{loading ? 'Detecting location…' : 'Allow Location Access'}</span>
                </div>
              </button>

              <button
                onClick={() => {
                  setMode('select');
                  setError(null);
                }}
                style={styles.btnManual}
              >
                Enter Location Manually
              </button>
            </div>
          </>
        ) : (
          /* ==========================================
             SCREEN 2: Select Delivery Location (Image 1)
             ========================================== */
          <div style={styles.selectContainer}>
            {/* Top Header Row with Title & Close (X) */}
            <div style={styles.selectHeader}>
              <h3 style={styles.selectTitle}>Select delivery location</h3>
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                style={styles.closeBtn}
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSaveManual} style={styles.searchForm}>
              <div style={styles.searchInputWrapper}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={styles.searchIcon}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search for area, street name.."
                  value={manualLocation}
                  onChange={(e) => {
                    setManualLocation(e.target.value);
                    if (error) setError(null);
                  }}
                  autoFocus
                  style={styles.searchInput}
                />
                {manualLocation.trim().length > 0 && (
                  <button type="submit" disabled={loading} style={styles.searchSubmitBtn}>
                    {loading ? '...' : 'Search'}
                  </button>
                )}
              </div>
              <span style={styles.subtextHint}>Type at least 4 characters</span>
            </form>

            {error && <p style={styles.error}>{error}</p>}

            {/* Option Cards */}
            <div style={styles.actionCardsGroup}>
              {/* Option 1: Use Current Location */}
              <div style={styles.actionCard} onClick={handleAllowAccess}>
                <div style={styles.purpleIconCircle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#078CCB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div style={styles.actionTextCol}>
                  <span style={styles.actionTitlePurple}>Use current location</span>
                  {location && location !== 'Set your location' && (
                    <span style={styles.actionSubtext}>
                      ({location.length > 28 ? location.slice(0, 28) + '...' : location})
                    </span>
                  )}
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>

              {/* Option 2: Add New Address */}
              <div style={styles.actionCard} onClick={handleAddNewAddress}>
                <div style={styles.purpleIconCircle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#078CCB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div style={styles.actionTextCol}>
                  <span style={styles.actionTitlePurple}>Add new address</span>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>

            {/* Saved Addresses Section */}
            <div style={styles.savedSection}>
              <h4 style={styles.savedHeading}>YOUR SAVED ADDRESSES</h4>
              {savedAddresses.length === 0 ? (
                <div style={styles.emptyAddresses}>
                  <span>No saved addresses found. Enter a location above or use current location.</span>
                </div>
              ) : (
                <div style={styles.addressList}>
                  {savedAddresses.map((addr) => {
                    const isSelected = location && location.includes(addr.city || addr.line1 || '');
                    return (
                      <div
                        key={addr._id || addr.id}
                        style={{
                          ...styles.savedAddrCard,
                          borderColor: isSelected ? '#08B9E8' : '#f1f5f9',
                          background: isSelected ? '#EAF9FE' : '#ffffff',
                        }}
                        onClick={() => handleSelectSavedAddress(addr)}
                      >
                        <div style={styles.addrIconCircle}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                          </svg>
                        </div>
                        <div style={styles.addrInfoCol}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={styles.addrName}>{addr.name || 'Home'}</span>
                            {addr.isDefault && <span style={styles.defaultBadge}>DEFAULT</span>}
                          </div>
                          <span style={styles.addrText}>
                            {[addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    backdropFilter: 'blur(5px)',
    fontFamily: "'Outfit', sans-serif",
    padding: '16px',
    boxSizing: 'border-box',
  },
  card: {
    background: '#f8fafc',
    borderRadius: '24px',
    width: '100%',
    maxWidth: '430px',
    padding: '28px 24px',
    textAlign: 'center',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.22)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    boxSizing: 'border-box',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  iconContainer: {
    width: '76px',
    height: '76px',
    borderRadius: '50%',
    background: '#eaf9fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#078ccb',
    marginBottom: 4,
    marginTop: 8,
  },
  title: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#1e293b',
    margin: 0,
    lineHeight: 1.2,
  },
  description: {
    fontSize: '13.5px',
    color: '#64748b',
    lineHeight: 1.55,
    margin: 0,
  },
  error: {
    fontSize: '12.5px',
    color: '#ef4444',
    margin: 0,
    fontWeight: 600,
  },
  btnCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    marginTop: 8,
  },
  btnAllow: {
    background: 'linear-gradient(135deg, #078ccb 0%, #08b9e8 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '16px',
    padding: '16px 20px',
    fontSize: '15px',
    fontWeight: 700,
    width: '100%',
    cursor: 'pointer',
    transition: 'background 0.2s',
    outline: 'none',
    boxShadow: '0 4px 12px rgba(8, 185, 232, 0.25)',
  },
  btnManual: {
    background: '#ffffff',
    color: '#475569',
    border: '1.5px solid #e2e8f0',
    borderRadius: '16px',
    padding: '15px 20px',
    fontSize: '14.5px',
    fontWeight: 700,
    width: '100%',
    cursor: 'pointer',
    transition: 'background 0.2s',
    outline: 'none',
  },
  /* Screen 2 Styles */
  selectContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    textAlign: 'left',
  },
  selectHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
  },
  selectTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#1e293b',
    margin: 0,
  },
  closeBtn: {
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    background: '#e2e8f0',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#475569',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  searchForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
  },
  searchInputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
  },
  searchIcon: {
    position: 'absolute',
    left: '14px',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '14px 14px 14px 44px',
    borderRadius: '14px',
    border: '1.5px solid #cbd5e1',
    background: '#ffffff',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: "'Outfit', sans-serif",
    color: '#1e293b',
  },
  searchSubmitBtn: {
    position: 'absolute',
    right: '8px',
    background: '#078ccb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  subtextHint: {
    fontSize: '11.5px',
    color: '#64748b',
    marginLeft: '4px',
  },
  actionCardsGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: '100%',
  },
  actionCard: {
    background: '#ffffff',
    borderRadius: '16px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
    border: '1px solid #f1f5f9',
    transition: 'transform 0.15s, border-color 0.15s',
  },
  purpleIconCircle: {
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    background: '#eaf9fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionTextCol: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  actionTitlePurple: {
    fontSize: '14.5px',
    fontWeight: 700,
    color: '#073b78',
  },
  actionSubtext: {
    fontSize: '11.5px',
    color: '#64748b',
    marginTop: '2px',
  },
  savedSection: {
    marginTop: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: '100%',
  },
  savedHeading: {
    fontSize: '11.5px',
    fontWeight: 800,
    color: '#64748b',
    letterSpacing: '0.6px',
    margin: 0,
  },
  emptyAddresses: {
    fontSize: '12.5px',
    color: '#94a3b8',
    padding: '12px',
    background: '#ffffff',
    borderRadius: '12px',
    textAlign: 'center',
  },
  addressList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
  },
  savedAddrCard: {
    borderRadius: '14px',
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    border: '1.5px solid #f1f5f9',
    transition: 'all 0.15s',
  },
  addrIconCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addrInfoCol: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  addrName: {
    fontSize: '13.5px',
    fontWeight: 700,
    color: '#1e293b',
  },
  defaultBadge: {
    fontSize: '9px',
    fontWeight: 800,
    color: '#fff',
    background: '#ff8500',
    borderRadius: '4px',
    padding: '2px 5px',
  },
  addrText: {
    fontSize: '11.5px',
    color: '#64748b',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginTop: '2px',
  },
};

export default LocationPromptModal;
