import React, { useCallback, useEffect, useState } from 'react';
import { SellerProvider, useSeller } from '../context/SellerContext';
import DashboardPage from '../pages/DashboardPage';
import OnboardingPage from '../pages/OnboardingPage';
import SellerLoginPage from '../pages/SellerLoginPage';
import SellerEntryPage from '../pages/SellerEntryPage';
import SellerStatusGate from '../components/SellerStatusGate';
import { apiUrl } from '../../../utils/api';
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
  const { toastMessage } = useSeller();

  const [state, setState] = useState({ ...SIGNED_OUT, loading: true });

  // Default to 'login' mode (single phone number authentication)
  const [intent, setIntent] = useState('login');

  const loadStatus = useCallback(async () => {
    setState((p) => ({ ...p, loading: true }));
    const token = localStorage.getItem('userToken');

    if (!token) {
      setState(SIGNED_OUT);
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/sellers/me'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));

      // Dead session — expired token, or the account no longer exists.
      if (res.status === 401) {
        localStorage.removeItem('userToken');
        localStorage.removeItem('userProfile');
        setState(SIGNED_OUT);
        return;
      }

      // Signed in, but no seller profile yet → start onboarding.
      if (res.status === 404) {
        setState({ loading: false, authed: true, status: 'none', storeName: null, rejectionReason: null });
        return;
      }

      setState({
        loading: false,
        authed: true,
        status: body?.seller?.status || 'none',
        storeName: body?.seller?.storeDetails?.name || body?.seller?.businessName || null,
        rejectionReason: body?.seller?.rejectionReason || null,
      });
    } catch {
      setState({ loading: false, authed: true, status: 'none', storeName: null, rejectionReason: null });
    }
  }, []);

  useEffect(() => {
    if (window.location.pathname === '/seller/logout') {
      signOut();
    } else {
      loadStatus();
    }
  }, [loadStatus]);

  const signOut = async () => {
    try {
      const token = localStorage.getItem('userToken');
      if (token) {
        await fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }
    } finally {
      localStorage.removeItem('userToken');
      localStorage.removeItem('userProfile');
      setIntent('login');
      setState(SIGNED_OUT);
    }
  };

  const renderBody = () => {
    if (state.loading) {
      return (
        <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, fontSize: 13 }}>
          Checking your seller account…
        </div>
      );
    }

    // Not signed in → show SellerLoginPage directly (Phone OTP login)
    if (!state.authed) {
      return (
        <SellerLoginPage
          mode={intent || 'login'}
          onLoggedIn={loadStatus}
          onBack={() => setIntent('login')}
        />
      );
    }

    // Signed in via "Login" but this number has no store registered.
    // Don't silently drop them into the wizard — explain, and offer to register.
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

export const SellerRoutes = () => (
  <SellerProvider>
    <SellerRoutesContent />
  </SellerProvider>
);

export default SellerRoutes;
