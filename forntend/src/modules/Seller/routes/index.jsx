import { boundedFetch, portalRequest, clearPortalRequests } from '../../../utils/portalRequests';
import React, { useCallback, useEffect, useState } from 'react';
import { SellerProvider, useSeller } from '../context/SellerContext';
import DashboardPage from '../pages/DashboardPage';
import OnboardingPage from '../pages/OnboardingPage';
import SellerLoginPage from '../pages/SellerLoginPage';
import SellerEntryPage from '../pages/SellerEntryPage';
import SellerStatusGate from '../components/SellerStatusGate';
import { clearSellerDraft, getSellerDraftKey } from '../utils/onboardingDraft';
import { apiUrl } from '../../../utils/api';
import { SELLER_SESSION_CHANGED } from '../../../utils/portalSession';
import { deregisterPushToken } from '../../../utils/firebaseMessaging';
import { disconnectSocket } from '../../../utils/socket';
import '../Seller.css';

/**
 * Seller access is decided by the SERVER, never by local state.
 *
 *   no session              → sign in (the number they registered with)
 *   no profile / incomplete → onboarding
 *   pending / under_review  → status screen (panel stays locked)
 *   rejected / suspended    → status screen with the reason
 *   approved                → dashboard
 *
 * The backend enforces the same rule on every panel route, so a user cannot
 * reach seller features by manipulating the client.
 */
const SIGNED_OUT = {
  loading: false,
  authed: false,
  status: null,
  storeName: null,
  rejectionReason: null,
};

const SellerRoutesContent = () => {
  const { toastMessage, userProfile } = useSeller();

  const [state, setState] = useState({ ...SIGNED_OUT, loading: true });

  // Default to 'login' mode (single phone number authentication)
  const [intent, setIntent] = useState('login');

  const loadStatus = useCallback(async (activeIntent) => {
    setState((p) => ({ ...p, loading: true }));
    const token = localStorage.getItem('sellerToken');

    if (!token) {
      setState(SIGNED_OUT);
      return;
    }

    try {
      const verified = await portalRequest('seller', token, '/api/auth/me', { cacheMs: 60000 });
      const identity = await verified.json().catch(() => ({}));
      if (token !== localStorage.getItem('sellerToken')) return;
      if (verified.status >= 500) throw new Error('Session unavailable');
      if (!verified.ok || !identity.success || identity.sessionRole !== 'seller' || !identity.profile?._id) {
        setState(SIGNED_OUT); return;
      }
      localStorage.setItem('sellerUserProfile', JSON.stringify(identity.profile));
      const res = await portalRequest('seller', token, '/api/sellers/me', { cacheMs: 1000 });
      const body = await res.json().catch(() => ({}));
      if (token !== localStorage.getItem('sellerToken')) return;

      // Dead session — expired token, or the account no longer exists.
      if (res.status === 401) {
        deregisterPushToken('seller').catch(() => {});
        localStorage.removeItem('sellerToken');
        localStorage.removeItem('sellerUserProfile');
        setState(SIGNED_OUT);
        return;
      }

      // Signed in, but no seller profile yet
      if (res.status === 404 || (res.ok && body.success && body.seller === null)) {
        const effectiveIntent = activeIntent || intent;
        if (effectiveIntent === 'register') {
          // User just completed phone OTP for registering a new store, continue to onboarding
          setState({ loading: false, authed: true, status: 'incomplete', storeName: null, rejectionReason: null });
        } else {
          // Standard visit or customer account without a seller profile: show SellerLoginPage
          setState({ loading: false, authed: false, status: 'none', storeName: null, rejectionReason: null });
        }
        return;
      }

      if (res.status >= 500) throw new Error('Seller profile unavailable');
      if (!res.ok) { setState(SIGNED_OUT); return; }

      setState({
        loading: false,
        authed: true,
        status: body?.seller?.status || 'none',
        storeName: body?.seller?.storeDetails?.name || body?.seller?.businessName || null,
        rejectionReason: body?.seller?.rejectionReason || null,
      });
    } catch {
      if (token !== localStorage.getItem('sellerToken')) return;
      setState({ loading: false, verificationError: true });
    }
  }, [intent]);

  useEffect(() => {
    if (window.location.pathname === '/seller/logout') {
      signOut();
    } else {
      loadStatus();
    }
  }, [loadStatus]);

  useEffect(() => {
    const changed = event => { if (!event.key || event.key === 'sellerToken') loadStatus(); };
    window.addEventListener('storage', changed);
    window.addEventListener(SELLER_SESSION_CHANGED, changed);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener(SELLER_SESSION_CHANGED, changed); };
  }, [loadStatus]);

  const signOut = async () => {
    disconnectSocket();
    clearSellerDraft(window.localStorage, getSellerDraftKey(userProfile?._id || userProfile?.id || userProfile?.userId));
    await deregisterPushToken('seller').catch(() => {});
    try {
      const token = localStorage.getItem('sellerToken');
      if (token) {
        await boundedFetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }, 5000).catch(() => {});
      }
    } finally {
      clearPortalRequests('seller'); localStorage.removeItem('sellerToken');
      localStorage.removeItem('sellerUserProfile');
      setIntent('login');
      setState(SIGNED_OUT);
    }
  };

  const renderBody = () => {
    if (state.verificationError) return <div role="alert">Unable to verify your seller session. Check your connection.<button type="button" onClick={() => loadStatus()}>Retry verification</button></div>;
    if (state.loading) {
      return (
        <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, fontSize: 13 }}>
          Checking your seller account…
        </div>
      );
    }

    // Not signed in as a seller → show SellerLoginPage directly (Phone OTP login / register)
    if (!state.authed) {
      return (
        <SellerLoginPage
          mode={intent || 'login'}
          onLoggedIn={(registeredIntent) => {
            if (registeredIntent) setIntent(registeredIntent);
            loadStatus(registeredIntent);
          }}
          onBack={() => setIntent('login')}
          onToggleMode={setIntent}
        />
      );
    }

    // Signed in via "Login" but this number has no store registered.
    if (intent === 'login' && state.status === 'none') {
      return (
        <div className="seller-main-content">
          <div className="onboarding-container" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
            <h3 className="onboarding-title">No seller account found</h3>
            <p className="onboarding-subtitle">
              This mobile number is not registered as a seller on Bulkimart yet.
            </p>
            <button
              className="primary-onboarding-btn"
              style={{ marginTop: 20 }}
              onClick={() => setIntent('register')}
            >
              Register my store
            </button>
            <div style={{ marginTop: 14 }}>
              <button className="otp-resend-btn" onClick={signOut}>
                Use a different number
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Signed in but registration not started or unfinished.
    if (state.status === 'none' || state.status === 'incomplete') {
      return <OnboardingPage onSubmitted={loadStatus} />;
    }

    if (state.status === 'approved') {
      return <DashboardPage />;
    }

    // pending | under_review | rejected | suspended
    return (
      <SellerStatusGate
        status={state.status}
        storeName={state.storeName}
        rejectionReason={state.rejectionReason}
        onRetry={loadStatus}
        onExit={signOut}
      />
    );
  };

  return (
    <div className="seller-app-container">
      {toastMessage && (
        <div className="seller-toast-container">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {renderBody()}
    </div>
  );
};

export const SellerRoutes = () => {
  const [session, setSession] = useState(() => ({ token: localStorage.getItem('sellerToken'), epoch: 0 }));
  useEffect(() => {
    const changed = () => setSession(previous => {
      const token = localStorage.getItem('sellerToken');
      if (token === previous.token) return previous;
      // Keep initial onboarding intent when guest signs in, but discard all
      // account-specific React state when an existing seller is replaced.
      return { token, epoch: previous.epoch + (previous.token ? 1 : 0) };
    });
    window.addEventListener('storage', changed); window.addEventListener(SELLER_SESSION_CHANGED, changed);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener(SELLER_SESSION_CHANGED, changed); };
  }, []);
  return <SellerProvider key={session.epoch}><SellerRoutesContent /></SellerProvider>;
};

export default SellerRoutes;
