import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { openRazorpayCheckout } from '../../../utils/razorpayCheckout';
import { boundedFetch } from '../../../utils/portalRequests';
import { useTickets } from '../../../utils/useTickets';
import TicketDetailModal from '../../../components/support/TicketDetailModal';
import LandmarkImagePicker from '../components/LandmarkImagePicker';
import useCustomerWallet from '../hooks/useCustomerWallet';
import { useRefreshHandler } from '../../../utils/refreshRegistry';
import { AttachmentPreview, AttachmentUploader } from '../../../components/common/AttachmentPreview';

const DEFAULT_NEUTRAL_AVATAR = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%231e293b"/><circle cx="50" cy="38" r="20" fill="%2394a3b8"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%2394a3b8"/></svg>`;

const PRESET_AVATARS = [
  { id: 'neutral', name: 'Default Slate', url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%231e293b"/><circle cx="50" cy="38" r="20" fill="%2394a3b8"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%2394a3b8"/></svg>` },
  { id: 'aqua', name: 'Bulkimart Aqua', url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2308B9E8"/><circle cx="50" cy="38" r="20" fill="%23ffffff"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%23ffffff"/></svg>` },
  { id: 'blue', name: 'Sky Blue', url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%230284c7"/><circle cx="50" cy="38" r="20" fill="%23e0f2fe"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%23e0f2fe"/></svg>` },
  { id: 'orange', name: 'Sunset Gold', url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23ea580c"/><circle cx="50" cy="38" r="20" fill="%23ffedd5"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%23ffedd5"/></svg>` },
  { id: 'purple', name: 'Royal Purple', url: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%237c3aed"/><circle cx="50" cy="38" r="20" fill="%23f3e8ff"/><path d="M50 64c-20 0-34 12-34 26h68c0-14-14-26-34-26z" fill="%23f3e8ff"/></svg>` }
];

const ProfilePage = () => {
  const ui = useFeedback();
  const { 
    setActiveNav, 
    currentUser,
    logoutUser,
    savedAddresses,
    addAddress,
    deleteAddress,
    setSelectedAddressId,
    selectedAddressId,
    uploadLandmarkImage,
    fetchWalletBalance,
    setWalletBalance,
  } = useUser();

  const handleDeleteAccount = () => {
    ui.perform(
      'Are you sure you want to delete your account? This action cannot be undone. Active orders or pending obligations will prevent deletion.',
      async () => {
        try {
          const res = await fetch(apiUrl('/api/users/profile'), {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${localStorage.getItem('userToken') || ''}`,
            },
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(body.message || 'Could not delete account. Please try again.');
          }
          ui.notify(body.message || 'Your account has been deleted successfully.', { type: 'success' });
          logoutUser();
        } catch (err) {
          ui.notify(err.message, { type: 'error' });
        }
      }
    );
  };

  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false);
  const [addMoneyAmount, setAddMoneyAmount] = useState('');
  const [isInitiatingTopup, setIsInitiatingTopup] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [topupAlert, setTopupAlert] = useState(null);
  const topupInFlight = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topupStatus = params.get('topupStatus');
    if (topupStatus) {
      setActiveSection('real-wallet');
      if (topupStatus === 'paid') {
        setTopupAlert({ type: 'success', message: '🎉 Wallet top-up successful! Money credited to your account.' });
      } else if (topupStatus === 'failed') {
        setTopupAlert({ type: 'error', message: '❌ Top-up payment failed or cancelled.' });
      }
      fetchWalletBalance?.();
      loadRealWalletDetails();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchWalletBalance]);

  const handleInitiateTopup = async () => {
    if (topupInFlight.current) return;
    const amt = Number(addMoneyAmount);
    if (!Number.isFinite(amt) || amt < 1 || amt > 100000 || Math.abs(amt * 100 - Math.round(amt * 100)) > 0.000001) {
      setTopupError('Enter an amount from ₹1 to ₹1,00,000 with at most two decimal places.');
      return;
    }
    topupInFlight.current = true;
    setIsInitiatingTopup(true);
    setTopupError('');
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + localStorage.getItem('userToken'),
      };
      const res = await boundedFetch(apiUrl('/api/wallet/topup/initiate'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: amt })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || 'Could not start wallet payment.');
      const result = await openRazorpayCheckout(body.data, headers);
      setShowAddMoneyModal(false);
      if (result.ok && result.verified) {
        setTopupAlert({ type: 'success', message: `₹${amt} added to your wallet.` });
      } else {
        setTopupAlert({ type: 'error', message: result.message || 'Payment has not been confirmed. Check your wallet before trying again.' });
      }
      fetchWalletBalance?.();
      await loadRealWalletDetails();
    } catch (err) {
      setTopupError(err.message || 'Could not start wallet payment. Please try again.');
    } finally {
      topupInFlight.current = false;
      setIsInitiatingTopup(false);
    }
  };

  // Inject animation keyframes
  React.useEffect(() => {
    const styleId = 'profile-page-animations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const [activeSection, setActiveSection] = useState(() => new URLSearchParams(window.location.search).get('section') === 'wallet' ? 'real-wallet' : null);

  // Each Account section gets its own history entry, so the phone's back button closes the
  // section and lands on the Account menu instead of leaving the page for Home.
  const isPoppingRef = useRef(false);
  useEffect(() => {
    const onPop = () => {
      isPoppingRef.current = true;
      setActiveSection(window.history.state?.accountSection || null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (isPoppingRef.current) {
      isPoppingRef.current = false;
      return;
    }
    const entry = window.history.state?.accountSection || null;
    if (activeSection && entry !== activeSection) {
      window.history.pushState({ ...(window.history.state || {}), accountSection: activeSection }, '');
    } else if (!activeSection && entry) {
      // Closed with the in-page back arrow: drop the section's history entry too.
      window.history.back();
    }
  }, [activeSection]);

  // Sub-Section states
  const [profileName, setProfileName] = useState(currentUser?.name || '');
  const [profileEmail, setProfileEmail] = useState(currentUser?.email || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  // User Avatar state & file upload ref
  const [userAvatar, setUserAvatar] = useState(() => {
    return currentUser?.avatar || localStorage.getItem('userAvatar') || '';
  });
  const avatarInputRef = React.useRef(null);

  const handleAvatarFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileMsg('Please select a valid image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (dataUrl) {
        setUserAvatar(dataUrl);
        localStorage.setItem('userAvatar', dataUrl);
        if (currentUser) currentUser.avatar = dataUrl;
        setProfileMsg('Profile picture updated successfully!');
      }
    };
    reader.readAsDataURL(file);
  };

  const selectPresetAvatar = (url) => {
    setUserAvatar(url);
    localStorage.setItem('userAvatar', url);
    if (currentUser) currentUser.avatar = url;
    setProfileMsg('Avatar updated successfully!');
  };


  // Address creation states
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('Home');
  const [newAddrName, setNewAddrName] = useState('');
  const [newAddrPhone, setNewAddrPhone] = useState('');
  const [newAddrLine1, setNewAddrLine1] = useState('');
  const [newAddrLine2, setNewAddrLine2] = useState('');
  const [newAddrCity, setNewAddrCity] = useState('');
  const [newAddrState, setNewAddrState] = useState('');
  const [newAddrPincode, setNewAddrPincode] = useState('');
  const [newAddrLandmarkImage, setNewAddrLandmarkImage] = useState('');
  const [uploadingLandmark, setUploadingLandmark] = useState(false);

  const handleLandmarkFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLandmark(true);
    const res = await uploadLandmarkImage(file);
    setUploadingLandmark(false);
    if (res.ok) {
      setNewAddrLandmarkImage(res.imageUrl);
    } else {
      setLocationError(res.message || 'Landmark image upload failed');
    }
  };

  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  /**
   * Fill the address form from the device's location.
   *
   * Resolved through our own endpoint rather than by calling Google from the
   * browser and parsing address components here. That removed a second copy of
   * the parsing logic, stopped the key travelling in a URL, and put this screen
   * behind the server's cache and rate limit — but the reason it matters is
   * that the Geocoding API has no POI database, so someone standing inside a
   * named building was given the surrounding locality. /api/geo/reverse asks
   * Places first and falls back to geocoding.
   */
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('This browser cannot read your location. Please type your address.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        const accuracy = Math.round(position.coords.accuracy);

        try {
          const res = await fetch(
            apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}&accuracy=${accuracy}`),
            { headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') } }
          );
          const body = await res.json().catch(() => ({}));

          if (!res.ok) {
            setLocationError(body.message || 'Could not look up your address. Please type it in.');
            return;
          }

          const a = body.data || {};
          // Only fill what came back. The previous version invented a Lucknow
          // address whenever the lookup failed, which silently put somebody in
          // Indore on a street they had never heard of.
          if (a.address) setNewAddrLine1(a.address);
          if (a.city) setNewAddrCity(a.city);
          if (a.state) setNewAddrState(a.state);
          if (a.pincode) setNewAddrPincode(a.pincode);
        } catch (err) {
          setLocationError('Could not reach the address service. Please type your address in.');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        const messages = {
          1: 'You blocked location access. Allow it, or type your address in.',
          2: 'Your location could not be determined right now.',
          3: 'Finding your location took too long. Please try again.',
        };
        setLocationError(messages[err.code] || 'Could not read your location.');
      },
      // High accuracy matters here: the tighter the fix, the more confidently a
      // nearby building can be named rather than the whole locality.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };


  // Support ticket state — real backend-persisted tickets, not a fake
  // client-side success screen.
  const {
    tickets: supportTickets, categories: supportCategories, loading: supportLoading,
    fetchCategories: fetchSupportCategories, fetchMyTickets: fetchSupportTickets,
    createTicket: createSupportTicket, fetchTicketDetail: fetchSupportTicketDetail,
    sendMessage: sendSupportMessage, reopenTicket: reopenSupportTicket,
  } = useTickets('customer');
  const [supportCategory, setSupportCategory] = useState('');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDesc, setSupportDesc] = useState('');
  const [supportFiles, setSupportFiles] = useState([]);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportJustCreated, setSupportJustCreated] = useState(null);
  const [openSupportTicket, setOpenSupportTicket] = useState(null);
  const [openSupportMessages, setOpenSupportMessages] = useState([]);

  useEffect(() => {
    if (activeSection === 'support') {
      fetchSupportCategories();
      fetchSupportTickets();
    }
  }, [activeSection]);

  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    if (!supportCategory || !supportSubject.trim() || !supportDesc.trim()) return;
    setSupportSubmitting(true);
    try {
      const t = await createSupportTicket({ category: supportCategory, subject: supportSubject, description: supportDesc }, supportFiles);
      setSupportJustCreated(t);
      setSupportCategory(''); setSupportSubject(''); setSupportDesc(''); setSupportFiles([]);
    } catch (err) {
      ui.notify(err.message, {type:'error'});
    } finally {
      setSupportSubmitting(false);
    }
  };

  const openSupportDetail = async (t) => {
    const body = await fetchSupportTicketDetail(t._id);
    setOpenSupportTicket(body.data.ticket);
    setOpenSupportMessages(body.data.messages);
  };

  const refreshSupportDetail = async () => {
    const body = await fetchSupportTicketDetail(openSupportTicket._id);
    setOpenSupportTicket(body.data.ticket);
    setOpenSupportMessages(body.data.messages);
    fetchSupportTickets();
  };

  // Settings states
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [langSelection, setLangSelection] = useState('English');

  const { data: realWalletData, transactions: realWalletTxns, loading: loadingRealWallet,
    error: realWalletError, refresh: loadRealWalletDetails } = useCustomerWallet({
    active: activeSection === 'real-wallet', userId: currentUser?._id || currentUser?.id, onBalance: setWalletBalance,
  });
  // Pull down on the wallet screen to reload the balance and history (replaces the Refresh wallet button).
  useRefreshHandler(() => loadRealWalletDetails(), activeSection === 'real-wallet');

  // Dynamic Privacy Policy states
  const [privacyTab, setPrivacyTab] = useState('user-policy');
  const [privacyPolicyData, setPrivacyPolicyData] = useState(null);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);

  const loadPrivacyPolicy = async (slug) => {
    setLoadingPrivacy(true);
    try {
      const res = await fetch(apiUrl(`/api/privacy-policy/${slug}`));
      const body = await res.json();
      if (body.success && body.data) {
        setPrivacyPolicyData(body.data);
      } else {
        setPrivacyPolicyData(null);
      }
    } catch (err) {
      setPrivacyPolicyData(null);
    } finally {
      setLoadingPrivacy(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'privacy') {
      let targetTab = privacyTab;
      if (privacyTab === 'delivery-policy') {
        targetTab = 'user-policy';
        setPrivacyTab('user-policy');
      }
      loadPrivacyPolicy(targetTab);
    }
  }, [activeSection, privacyTab, currentUser]);

  // Handle Profile Save
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileMsg('');
    
    // Simulate updating user profile call
    setTimeout(() => {
      setIsSavingProfile(false);
      setProfileMsg('Profile updated successfully!');
      if (currentUser) {
        currentUser.name = profileName;
        currentUser.email = profileEmail;
        currentUser.avatar = userAvatar;
      }
      localStorage.setItem('userAvatar', userAvatar);
    }, 800);
  };


  // Handle Adding Address
  const handleAddAddressSubmit = async (e) => {
    e.preventDefault();
    if (!newAddrName || !newAddrPhone || !newAddrLine1 || !newAddrPincode || !newAddrCity || !newAddrState) {
      setLocationError('Please fill out all address details');
      return;
    }

    const result = await addAddress({
      label: newAddrLabel,
      name: newAddrName,
      phone: newAddrPhone,
      line1: newAddrLine1,
      line2: newAddrLine2 || '',
      city: newAddrCity,
      state: newAddrState,
      pincode: newAddrPincode,
      landmarkImage: newAddrLandmarkImage || null,
    });

    if (!result?.ok) {
      setLocationError(result?.message || 'Could not save address. Please try again.');
      return;
    }
    if (result.addressId) setSelectedAddressId(String(result.addressId));
    setLocationError('');
    setIsAddingAddress(false);

    // Clear form fields
    setNewAddrName('');
    setNewAddrPhone('');
    setNewAddrLine1('');
    setNewAddrLine2('');
    setNewAddrCity('');
    setNewAddrState('');
    setNewAddrPincode('');
    setNewAddrLandmarkImage('');
  };

  // Check if current user is already a registered/active seller
  const isSeller = Boolean(
    currentUser?.sellerId ||
    currentUser?.isSeller ||
    currentUser?.roles?.includes('seller') ||
    (typeof window !== 'undefined' && (
      localStorage.getItem('sellerToken') ||
      localStorage.getItem('userRole') === 'seller' ||
      (localStorage.getItem('userProfile') && JSON.parse(localStorage.getItem('userProfile') || '{}').sellerId) ||
      (localStorage.getItem('userProfile') && JSON.parse(localStorage.getItem('userProfile') || '{}').roles?.includes('seller'))
    ))
  );

  // Menu items list mapping
  const menuItems = [
    {
      id: 'profile',
      label: 'My Profile',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      ),
      badge: null,
      action: () => setActiveSection('profile')
    },
    {
      id: 'real-wallet',
      label: 'Bulkimart Wallet',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      ),
      badge: (
        <span className="menu-badge wallet-badge" style={{
          backgroundColor: 'color-mix(in srgb, var(--sf-primary, #B50918) 15%, transparent)',
          color: 'var(--sf-action-hover, #B50918)',
          fontSize: '11px',
          fontWeight: '800',
          padding: '2px 8px',
          borderRadius: '20px'
        }}>
          💰 ₹{realWalletData?.balance?.toFixed(2) ?? '—'}
        </span>
      ),
      action: () => setActiveSection('real-wallet')
    },
    {
      id: 'orders',
      label: 'My Orders',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      ),
      badge: null,
      action: () => setActiveNav('orders', { fromNav: 'account' })
    },
    {
      id: 'ebooks',
      label: 'My E-books',
      icon: <span style={{ fontSize: 20 }}>📚</span>,
      badge: null,
      action: () => setActiveNav('ebooks', { fromNav: 'account' })
    },
    {
      id: 'legal-services', label: 'My Legal Service Requests',
      icon: <span aria-hidden="true">▤</span>, badge: null,
      action: () => {
        window.history.pushState({ nav: 'legal-services', fromNav: 'account' }, '', '/legal-services/requests');
        setActiveNav('legal-services', { fromNav: 'account' });
      }
    },
    {
      id: 'addresses',
      label: 'My Addresses',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      ),
      badge: null,
      action: () => setActiveSection('addresses')
    },

    {
      id: 'become-seller',
      label: isSeller ? 'Your Shop' : 'Become a Seller',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
        </svg>
      ),
      badge: isSeller 
        ? null 
        : <span className="menu-badge active-badge" style={{ background: 'var(--sf-action, #D91430)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>New</span>,
      action: () => window.history.pushState({}, '', '/seller') // Handled natively, bypasses Day 2
    },
    {
      id: 'support',
      label: 'Help & Support',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      ),
      badge: null,
      action: () => setActiveSection('support')
    },
    {
      id: 'privacy',
      label: 'Privacy Policy',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      ),
      badge: null,
      action: () => setActiveSection('privacy')
    }
  ];

  // Helper to render drawer header
  const renderSectionHeader = (title) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '16px 20px',
      background: 'linear-gradient(135deg, var(--sf-action-hover, #B50918) 0%, var(--sf-action, #D91430) 100%)',
      color: '#fff',
      position: 'sticky',
      top: 0,
      zIndex: 10,
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
    }}>
      <button 
        onClick={() => {
          setActiveSection(null);
          setProfileMsg('');
          setSupportJustCreated(null);
        }}
        style={{
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: '12px'
        }}
        aria-label="Back"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>
      <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: '#fff' }}>{title}</h3>
    </div>
  );

  // Render Sub-Sections Layout
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <div style={{ padding: '24px 20px 140px 20px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <div
                style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
                onClick={() => avatarInputRef.current?.click()}
                title="Click to upload custom profile photo"
              >
                <img
                  src={userAvatar || DEFAULT_NEUTRAL_AVATAR}
                  alt={currentUser?.name || 'User Profile'}
                  style={{ width: '88px', height: '88px', borderRadius: '50%', border: '3px solid var(--primary, var(--sf-action, #D91430))', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  background: 'var(--primary, var(--sf-action, #D91430))',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 26,
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  border: '2px solid #fff',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }}>
                  📷
                </div>
              </div>

              <div style={{ marginTop: '8px' }}>
                {false && <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  style={{ background: 'none', border: 'none', color: 'var(--sf-action-hover, #B50918)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                >
                  Upload Custom Photo
                </button>}
              </div>

              {/* Preset Avatars Bar */}
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Presets:</span>
                {PRESET_AVATARS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPresetAvatar(p.url)}
                    title={p.name}
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%', border: userAvatar === p.url ? '2px solid var(--sf-action, #D91430)' : '1px solid #cbd5e1',
                      padding: 0, overflow: 'hidden', cursor: 'pointer', background: 'none', transition: 'transform 0.15s'
                    }}
                  >
                    <img src={p.url} alt={p.name} style={{ width: '100%', height: '100%' }} />
                  </button>
                ))}
              </div>

              <div style={{ margin: '10px 0 0 0', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontSize: '12px', fontWeight: '600', fontFamily: 'monospace' }}>
                  User ID: {currentUser?._id || currentUser?.id || '—'}
                </span>
                <span style={{ color: '#64748b', fontSize: '12px', fontWeight: '600', fontFamily: 'monospace' }}>
                  Account ID: {currentUser?._id || currentUser?.id || '—'}
                </span>
              </div>
            </div>
            
            {profileMsg && (
              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px', color: '#15803d', fontSize: '13px', textAlign: 'center', fontWeight: '600' }}>
                {profileMsg}
              </div>
            )}

            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="auth-input-group">
                <label style={{ color: '#475569', fontWeight: '600' }}>Full Name</label>
                <input 
                  type="text" 
                  value={profileName} 
                  onChange={(e) => setProfileName(e.target.value)} 
                  required
                />
              </div>

              <div className="auth-input-group">
                <label style={{ color: '#475569', fontWeight: '600' }}>Email Address</label>
                <input 
                  type="email" 
                  value={profileEmail} 
                  onChange={(e) => setProfileEmail(e.target.value)} 
                  required
                />
              </div>

              <div className="auth-input-group">
                <label style={{ color: '#475569', fontWeight: '600' }}>Mobile Contact</label>
                <input 
                  type="text" 
                  value={currentUser?.phone || ''} 
                  disabled
                  style={{ backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Contact number is linked to your authentication ID and cannot be modified.</span>
              </div>

              <button 
                type="submit" 
                className="auth-submit-btn" 
                style={{ marginTop: '10px' }}
                disabled={isSavingProfile}
              >
                {isSavingProfile ? 'Saving Details...' : 'Save Profile Changes'}
              </button>
            </form>
          </div>
        );

      case 'real-wallet':
        return (
          <div style={{ padding: '24px 20px 140px 20px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
            <p style={{ margin: 0, fontSize: '13px' }}>Bulkimart Wallet holds money in rupees for payments and refunds. Parcel refunds sent to your wallet appear here.</p>
            {realWalletError && <p role="alert">{realWalletError} {realWalletData && 'The balance below was last loaded successfully and may be outdated.'}</p>}
            {loadingRealWallet && <p role="status">Refreshing wallet…</p>}
            {topupAlert && (
              <div style={{
                padding: '14px 16px',
                borderRadius: '12px',
                backgroundColor: topupAlert.type === 'success' ? '#f0fdf4' : '#fef2f2',
                color: topupAlert.type === 'success' ? '#15803d' : '#b91c1c',
                border: `1px solid ${topupAlert.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                fontSize: '13px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span>{topupAlert.message}</span>
                <button onClick={() => setTopupAlert(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
              </div>
            )}

            <div style={{
              background: 'linear-gradient(135deg, var(--sf-action-hover, #B50918) 0%, var(--sf-action, #D91430) 100%)',
              borderRadius: '16px',
              padding: '24px',
              textAlign: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 14px color-mix(in srgb, var(--sf-primary, #B50918) 28%, transparent)',
              position: 'relative'
            }}>
              <span style={{ fontSize: '12px', color: '#d7f4fc', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>Bulkimart Wallet Balance</span>
              <h2 style={{ fontSize: '36px', fontWeight: '900', margin: '8px 0 14px 0', color: '#ffffff' }}>
                ₹{realWalletData ? realWalletData.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : loadingRealWallet ? '…' : '—'}
              </h2>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(255, 255, 255, 0.2)', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                  <span>Status:</span>
                  <span style={{ textTransform: 'uppercase', color: '#fef08a' }}>{realWalletData?.status || 'ACTIVE'}</span>
                </div>
                <button
                  disabled={isInitiatingTopup}
                  onClick={() => {
                    setShowAddMoneyModal(true);
                    setTopupError('');
                    setAddMoneyAmount('');
                  }}
                  style={{
                    backgroundColor: '#ffffff',
                    color: 'var(--sf-action-hover, #B50918)',
                    border: 'none',
                    borderRadius: '20px',
                    padding: '6px 16px',
                    fontSize: '13px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  💳 + Add Money
                </button>
              </div>
            </div>

            {showAddMoneyModal && (
              <ModalPortal style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(4px)',
                zIndex: 2000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px'
              }}>
                <div style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '20px',
                  maxWidth: '440px',
                  width: '100%',
                  padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                  animation: 'slideIn 0.2s ease-out'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                      💳 Add Money to Wallet
                    </h3>
                    <button
                      disabled={isInitiatingTopup}
                      aria-label="Close add money"
                      onClick={() => setShowAddMoneyModal(false)}
                      style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}
                    >
                      ✕
                    </button>
                  </div>

                  <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '16px', lineHeight: '1.4' }}>
                    Pay securely with Razorpay to add money to your wallet.
                  </p>

                  {topupError && (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      backgroundColor: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                      fontSize: '12.5px',
                      fontWeight: '600',
                      marginBottom: '14px'
                    }}>
                      {topupError}
                    </div>
                  )}

                  {/* Preset Amount Chips */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
                    {[100, 500, 1000, 2000].map(amt => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          setAddMoneyAmount(String(amt));
                          setTopupError('');
                        }}
                        style={{
                          padding: '10px 4px',
                          borderRadius: '10px',
                          border: Number(addMoneyAmount) === amt ? '2px solid var(--sf-action, #D91430)' : '1px solid #cbd5e1',
                          backgroundColor: Number(addMoneyAmount) === amt ? '#f0fdf4' : '#ffffff',
                          color: Number(addMoneyAmount) === amt ? 'var(--sf-action-hover, #B50918)' : '#0f172a',
                          fontWeight: '800',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        +₹{amt}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={(e) => { e.preventDefault(); handleInitiateTopup(); }}>
                    <div style={{ marginBottom: '16px' }}>
                      <label htmlFor="wallet-topup-amount" style={{ display: 'block', fontSize: '12.5px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                        Enter Custom Amount (₹)
                      </label>
                      <input
                        id="wallet-topup-amount"
                        type="number"
                        step="0.01"
                        min="1"
                        max="100000"
                        placeholder="e.g. 750"
                        value={addMoneyAmount}
                        onChange={(e) => {
                          setAddMoneyAmount(e.target.value);
                          setTopupError('');
                        }}
                        required
                        style={{
                          width: '100%',
                          padding: '12px 14px',
                          borderRadius: '10px',
                          border: '1.5px solid #cbd5e1',
                          fontSize: '15px',
                          fontWeight: '700',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <button
                        type="submit"
                        disabled={isInitiatingTopup}
                        style={{
                          width: '100%',
                          padding: '14px',
                          borderRadius: '12px',
                          border: 'none',
                          backgroundColor: 'var(--sf-action, #D91430)',
                          color: '#ffffff',
                          fontWeight: '800',
                          fontSize: '14.5px',
                          cursor: isInitiatingTopup ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}
                      >
                        {isInitiatingTopup ? 'Starting payment...' : `Pay ₹${addMoneyAmount || 0}`}
                      </button>

                    </div>
                  </form>
                </div>
              </ModalPortal>
            )}

            <h4 style={{ margin: '12px 0 0 0', fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>Recent Wallet Transactions</h4>
            {loadingRealWallet && !realWalletData ? (
              <p style={{ fontSize: '13px', color: '#64748b' }}>Loading wallet transactions...</p>
            ) : !realWalletData ? null : realWalletTxns.length === 0 ? (
              <div style={{ padding: '20px', background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>No wallet transaction history yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {realWalletTxns.map(tx => {
                  const isCredit = tx.direction === 'credit';
                  return (
                    <div key={tx._id || tx.transactionId} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 16px',
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                    }}>
                      <div>
                        <span style={{ fontSize: '13.5px', fontWeight: '700', display: 'block', color: '#0f172a' }}>{tx.description || tx.type}</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleString('en-IN') : '—'}
                          {tx.referenceId ? ` • Ref: ${tx.referenceId}` : ''}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          fontSize: '14.5px',
                          fontWeight: '800',
                          color: isCredit ? '#16a34a' : '#ef4444'
                        }}>
                          {isCredit ? '+' : '-'} ₹{Number(tx.amount || 0).toFixed(2)}
                        </span>
                        {tx.balanceAfter !== undefined && (
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#94a3b8', marginTop: '2px' }}>
                            Bal: ₹{Number(tx.balanceAfter).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'addresses':
        return (
          <div style={{ padding: '24px 20px 140px 20px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
            {!isAddingAddress ? (
              <>
                <button 
                  onClick={() => setIsAddingAddress(true)}
                  style={{
                    padding: '14px',
                    border: '1.5px dashed var(--primary, var(--sf-action, #D91430))',
                    borderRadius: '14px',
                    backgroundColor: '#f0fdf4',
                    color: 'var(--primary, var(--sf-action-hover, #B50918))',
                    fontWeight: '800',
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Add New Delivery Address
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {savedAddresses.map(addr => {
                    const addrId = addr._id || addr.id;
                    const isSelected = String(selectedAddressId) === String(addrId);
                    return (
                      <div 
                        key={addrId}
                        style={{
                          padding: '16px',
                          backgroundColor: '#ffffff',
                          border: isSelected ? '2px solid var(--primary, var(--sf-action, #D91430))' : '1px solid #e2e8f0',
                          borderRadius: '14px',
                          position: 'relative',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{
                            backgroundColor: 'var(--sf-highlight, #FFF0B3)',
                            color: 'var(--sf-action-hover, #B50918)',
                            fontSize: '11px',
                            fontWeight: '800',
                            padding: '3px 10px',
                            borderRadius: '20px',
                            border: '1px solid #BAEAF8'
                          }}>
                            {addr.label || addr.type || 'Home'}
                          </span>
                          
                          {addr.isDefault && (
                            <span style={{ fontSize: '11px', color: 'var(--sf-action-hover, #B50918)', fontWeight: '800' }}>
                              Default Address
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.5' }}>
                          <strong style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: '#0f172a' }}>{addr.name}</strong>
                          {[addr.line1 || addr.house, addr.line2 || addr.street].filter(Boolean).join(', ')}<br />
                          {addr.city}, {addr.state} - {addr.pincode}<br />
                          📞 Contact: {addr.phone}
                        </div>

                        <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid #e2e8f0', marginTop: '12px', paddingTop: '10px' }}>
                          {!isSelected && (
                            <button 
                              onClick={() => setSelectedAddressId(addrId)}
                              style={{ background: 'none', border: 'none', color: 'var(--primary, var(--sf-action-hover, #B50918))', fontSize: '12px', fontWeight: '800', cursor: 'pointer', padding: 0 }}
                            >
                              Set Active
                            </button>
                          )}
                          <button 
                            onClick={() => ui.perform({title:'Delete this address?',message:'Remove this saved address from your account?',confirmLabel:'Delete',destructive:true},async () => {
                              const res = await deleteAddress(addrId);
                              if (res && res.ok === false) {
                                ui.notify(res.message || 'Failed to delete address');
                              }
                              return res;
                            })}
                            style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', fontWeight: '800', cursor: 'pointer', padding: 0 }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Add address form */
              <form onSubmit={handleAddAddressSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {['Home', 'Work', 'Other'].map(lbl => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setNewAddrLabel(lbl)}
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '10px',
                        border: newAddrLabel === lbl ? '1.5px solid var(--primary, var(--sf-action, #D91430))' : '1.5px solid #cbd5e1',
                        backgroundColor: newAddrLabel === lbl ? 'var(--primary, var(--sf-action, #D91430))' : '#ffffff',
                        color: newAddrLabel === lbl ? '#fff' : '#0f172a',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={locating}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: '#f0fdf4',
                    border: '1.5px dashed var(--primary, var(--sf-action, #D91430))',
                    borderRadius: '10px',
                    color: 'var(--primary, var(--sf-action-hover, #B50918))',
                    fontWeight: '800',
                    fontSize: '13px',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  <span>📍</span>
                  <span>{locating ? 'Fetching Live Location...' : 'Use Current Location'}</span>
                </button>
                {locationError && (
                  <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: '600', display: 'block', textAlign: 'center' }}>
                    {locationError}
                  </span>
                )}

                <div className="auth-input-group">
                  <label style={{ color: '#475569', fontWeight: '600' }}>Receiver Full Name</label>
                  <input 
                    type="text" 
                    value={newAddrName} 
                    onChange={(e) => setNewAddrName(e.target.value)} 
                    placeholder="e.g. Rahul Sharma"
                    required
                  />
                </div>

                <div className="auth-input-group">
                  <label style={{ color: '#475569', fontWeight: '600' }}>Receiver Phone Number</label>
                  <input 
                    type="tel" 
                    value={newAddrPhone} 
                    onChange={(e) => setNewAddrPhone(e.target.value)} 
                    placeholder="10-digit number"
                    maxLength={10}
                    required
                  />
                </div>

                <div className="auth-input-group">
                  <label style={{ color: '#475569', fontWeight: '600' }}>Flat / House / Block No.</label>
                  <input 
                    type="text" 
                    value={newAddrLine1} 
                    onChange={(e) => setNewAddrLine1(e.target.value)} 
                    placeholder="Flat 202, Block B"
                    required
                  />
                </div>

                <div className="auth-input-group">
                  <label style={{ color: '#475569', fontWeight: '600' }}>Street / Locality / Landmark</label>
                  <input 
                    type="text" 
                    value={newAddrLine2} 
                    onChange={(e) => setNewAddrLine2(e.target.value)} 
                    placeholder="Vikas Nagar, Sector 12"
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <div className="auth-input-group" style={{ flex: 1 }}>
                    <label style={{ color: '#475569', fontWeight: '600' }}>City</label>
                    <input 
                      type="text" 
                      value={newAddrCity} 
                      onChange={(e) => setNewAddrCity(e.target.value)} 
                      placeholder="Lucknow"
                      required
                    />
                  </div>
                  <div className="auth-input-group" style={{ flex: 1 }}>
                    <label style={{ color: '#475569', fontWeight: '600' }}>State</label>
                    <input 
                      type="text" 
                      value={newAddrState} 
                      onChange={(e) => setNewAddrState(e.target.value)} 
                      placeholder="Uttar Pradesh"
                      required
                    />
                  </div>
                </div>

                <div className="auth-input-group">
                  <label style={{ color: '#475569', fontWeight: '600' }}>Pincode / Postal Code</label>
                  <input 
                    type="text" 
                    value={newAddrPincode} 
                    onChange={(e) => setNewAddrPincode(e.target.value)} 
                    placeholder="226022"
                    maxLength={6}
                    required
                  />
                </div>

                <div className="auth-input-group" style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <LandmarkImagePicker
                    value={newAddrLandmarkImage}
                    onChange={(url) => setNewAddrLandmarkImage(url)}
                    onUpload={uploadLandmarkImage}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                  <button type="submit" className="auth-submit-btn" style={{ flex: 2 }}>
                    Save Address
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setIsAddingAddress(false)}
                    style={{
                      flex: 1,
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      backgroundColor: '#f1f5f9',
                      color: '#475569',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        );



      case 'support':
        return (
          <div style={{ padding: '24px 20px 140px 20px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
            {supportJustCreated ? (
              <div style={{ textAlign: 'center', padding: '24px 10px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '12px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '48px' }}>✉️</span>
                <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>Ticket Submitted Successfully!</h4>
                <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
                  Your support ticket ID is <strong>#{supportJustCreated.ticketNumber}</strong>. Our team is reviewing the issue and will alert you shortly.
                </p>
                <button onClick={() => setSupportJustCreated(null)} className="auth-submit-btn" style={{ marginTop: '12px' }}>
                  Back to Help
                </button>
              </div>
            ) : (
              <>
                <h4 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>Contact Customer Support</h4>
                <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5', margin: 0 }}>
                  Need help with an order, payment, or delivery timing? Open a support ticket and our team will get back within 24 hours.
                </p>

                <form onSubmit={handleSupportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="auth-input-group">
                    <label style={{ color: '#475569', fontWeight: '600' }}>Category</label>
                    <select
                      value={supportCategory}
                      onChange={(e) => setSupportCategory(e.target.value)}
                      required
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '14px' }}
                    >
                      <option value="">Select a category</option>
                      {supportCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div className="auth-input-group">
                    <label style={{ color: '#475569', fontWeight: '600' }}>Query Subject</label>
                    <input type="text" placeholder="e.g. Wallet balance query" value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} required />
                  </div>

                  <div className="auth-input-group">
                    <label style={{ color: '#475569', fontWeight: '600' }}>How can we assist you?</label>
                    <textarea
                      placeholder="Explain your problem or questions in details..."
                      value={supportDesc}
                      onChange={(e) => setSupportDesc(e.target.value)}
                      style={{
                        width: '100%',
                        height: '100px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: '1.5px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                        fontSize: '14px',
                        outline: 'none',
                        boxSizing: 'border-box',
                        resize: 'none'
                      }}
                      required
                    />
                  </div>

                  <div className="auth-input-group">
                    <label style={{ color: '#475569', fontWeight: '600' }}>Attachments (optional, up to 5)</label>
                    <AttachmentUploader
                      files={supportFiles}
                      onAddFiles={(selected) => setSupportFiles((prev) => [...prev, ...selected].slice(0, 5))}
                      onRemoveFile={(idxToRemove) => setSupportFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove))}
                      maxFiles={5}
                    />
                  </div>

                  <button type="submit" className="auth-submit-btn" disabled={supportSubmitting}>
                    {supportSubmitting ? 'Submitting…' : 'Submit Support Ticket'}
                  </button>
                </form>

                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: '#0f172a', fontWeight: '800' }}>MY TICKETS</h4>
                  {supportLoading ? (
                    <p style={{ fontSize: 12, color: '#64748b' }}>Loading…</p>
                  ) : supportTickets.length === 0 ? (
                    <div style={{ padding: '16px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>No tickets yet</p>
                    </div>
                  ) : supportTickets.map((t) => (
                    <div
                      key={t._id}
                      onClick={() => openSupportDetail(t)}
                      style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>#{t.ticketNumber}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'var(--sf-highlight)', color: 'var(--sf-highlight-text)' }}>
                          {(t.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6, color: '#0f172a' }}>{t.subject}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {openSupportTicket && (
              <TicketDetailModal
                ticket={openSupportTicket}
                messages={openSupportMessages}
                currentUserId={currentUser?._id}
                onClose={() => setOpenSupportTicket(null)}
                onReply={async (msg) => { await sendSupportMessage(openSupportTicket._id, msg); await refreshSupportDetail(); }}
                onReopen={async () => { await reopenSupportTicket(openSupportTicket._id); await refreshSupportDetail(); }}
              />
            )}
          </div>
        );

      case 'privacy':
        const PRIVACY_ROLE_TABS = [
          { slug: 'user-policy', label: 'User', icon: '👤' },
          { slug: 'seller-policy', label: 'Seller', icon: '🏪' },
        ];

        // Ensure active tab is valid for current role visibility
        const isTabValid = PRIVACY_ROLE_TABS.some((t) => t.slug === privacyTab);
        const currentActiveTab = isTabValid ? privacyTab : 'user-policy';

        return (
          <div style={{ padding: '20px 20px 140px 20px', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
            {/* Role Filter Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PRIVACY_ROLE_TABS.length}, 1fr)`, gap: '8px' }}>
              {PRIVACY_ROLE_TABS.map((t) => {
                const isActive = currentActiveTab === t.slug;
                return (
                  <button
                    key={t.slug}
                    onClick={() => setPrivacyTab(t.slug)}
                    style={{
                      padding: '10px 6px',
                      borderRadius: '12px',
                      border: isActive ? '2px solid var(--sf-action, #D91430)' : '1px solid #cbd5e1',
                      backgroundColor: isActive ? 'var(--sf-highlight, #FFF0B3)' : '#ffffff',
                      color: isActive ? 'var(--sf-action-hover, #B50918)' : '#475569',
                      fontSize: '12px',
                      fontWeight: isActive ? '800' : '600',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: isActive ? '0 2px 8px color-mix(in srgb, var(--sf-primary, #B50918) 14%, transparent)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: '16px' }}>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {loadingPrivacy ? (
              <div style={{ backgroundColor: '#ffffff', padding: '30px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Loading privacy policy...</p>
              </div>
            ) : !privacyPolicyData ? (
              <div style={{ backgroundColor: '#ffffff', padding: '30px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Privacy policy content unavailable for this role.</p>
              </div>
            ) : (
              <>
                <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--sf-highlight, #FFF0B3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sf-action-hover, #B50918)', flexShrink: 0 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{privacyPolicyData.roleTitle}</h4>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        Version {privacyPolicyData.version || '1.0.0'} • Updated {new Date(privacyPolicyData.effectiveDate || privacyPolicyData.updatedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  {privacyPolicyData.summary && (
                    <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.6', color: '#475569' }}>
                      {privacyPolicyData.summary}
                    </p>
                  )}
                </div>

                {/* Policy Dynamic Sections */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(privacyPolicyData.sections || []).map((sec, idx) => (
                    <div key={sec.id || idx} style={{ backgroundColor: '#ffffff', padding: '14px 16px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                      <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block', marginBottom: '4px' }}>{sec.title}</strong>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                        {sec.content}
                      </p>
                      {sec.points && sec.points.length > 0 && (
                        <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', fontSize: '11.5px', color: '#475569', lineHeight: '1.6' }}>
                          {sec.points.map((pt, pIdx) => (
                            <li key={pIdx}>{pt}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="profile-page-container" style={{ position: 'relative', paddingBottom: '20px' }}>
      {/* Hidden File Input for Avatar Upload */}
      <input
        type="file"
        ref={avatarInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleAvatarFileChange}
      />

      {/* Bulkimart account header — the title bar sits outside the gradient
          card so it can stay pinned while the page scrolls. */}
      <div className="profile-header-top profile-appbar">
        <button className="back-arrow-white" onClick={() => setActiveNav('home')} aria-label="Go to Home">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h2 className="profile-title">Account</h2>
        <div style={{ width: 24 }}></div> {/* Balance layout */}
      </div>
      <div className="profile-header-gradient">

        {/* User Card info inside Header */}
        <div className="profile-user-card">
          <div
            style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
            onClick={() => avatarInputRef.current?.click()}
            title="Click to change profile picture"
          >
            <img
              src={userAvatar || DEFAULT_NEUTRAL_AVATAR}
              alt={currentUser?.name || 'User Profile'}
              className="user-profile-avatar"
              style={{ width: 68, height: 68, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--text-white)' }}
            />
            <div style={{
              position: 'absolute',
              bottom: 2,
              right: 0,
              background: 'var(--primary)',
              color: '#fff',
              borderRadius: '50%',
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              border: '2px solid #fff',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
            }}>
              ✏️
            </div>
          </div>
          <div className="user-profile-details">
            <div className="user-name-row">
              <span className="user-profile-name">{currentUser?.name || (currentUser?.phone ? `+91 ${currentUser.phone}` : 'Member')}</span>
              <span className="user-active-badge">Active</span>
            </div>
            <span className="user-profile-phone">{currentUser?.phone ? `+91 ${currentUser.phone}` : ''}</span>
            {(currentUser?._id || currentUser?.id) && (
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace', marginTop: '2px' }}>
                ID: {currentUser?._id || currentUser?.id}
              </span>
            )}
          </div>
        </div>



      </div>

      {/* Account Menu Card wrapper */}
      <div className="profile-menu-card">
        <div className="menu-links-list">
          {menuItems.map((item) => (
            <div
              key={item.id}
              className="menu-link-row"
              onClick={item.action}
            >
              <div className="menu-link-left">
                <span className="menu-icon">{item.icon}</span>
                <span className="menu-label">{item.label}</span>
              </div>
              <div className="menu-link-right">
                {item.badge}
                <span className="menu-chevron">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
              </div>
            </div>
          ))}

          {/* Logout button in Red */}
          <div 
            className="menu-link-row logout-row" role="button" tabIndex={0}
            onKeyDown={event => {if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}
            onClick={() => ui.perform('Log out?', logoutUser)}
            style={{
              marginTop: '16px',
              marginBottom: '12px',
              padding: '14px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '14px',
              cursor: 'pointer'
            }}
          >
            <div className="menu-link-left">
              <span className="menu-icon logout-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </span>
              <span className="menu-label logout-label" style={{ fontWeight: '700' }}>Logout</span>
            </div>
            <span className="menu-chevron" style={{ color: '#ef4444' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>

          {/* Delete Account button */}
          <div 
            className="menu-link-row delete-account-row" role="button" tabIndex={0}
            onKeyDown={event => {if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}
            onClick={handleDeleteAccount}
            style={{
              marginBottom: '30px',
              padding: '14px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.04)',
              border: '1px dashed rgba(239, 68, 68, 0.4)',
              borderRadius: '14px',
              cursor: 'pointer'
            }}
          >
            <div className="menu-link-left">
              <span className="menu-icon" style={{ color: '#dc2626' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </span>
              <span className="menu-label" style={{ fontWeight: '700', color: '#dc2626' }}>Delete Account</span>
            </div>
            <span className="menu-chevron" style={{ color: '#dc2626' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Slide-over Section Overlay Drawer */}
      {activeSection && (
        <ModalPortal style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'stretch'
        }}>
          <div role="dialog" aria-modal="true" aria-label="Account details" style={{
            width: '100%',
            minWidth: 0,
            overflowWrap: 'anywhere',
            maxWidth: '540px',
            height: '100dvh',
            backgroundColor: '#f8fafc',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 0 40px rgba(0, 0, 0, 0.25)',
            animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}>
            {renderSectionHeader(
              menuItems.find(item => item.id === activeSection)?.label || 'Detail'
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              {renderSectionContent()}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default ProfilePage;
