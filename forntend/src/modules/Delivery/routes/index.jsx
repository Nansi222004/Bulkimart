import React, { useState, useEffect } from 'react';
import { DeliveryProvider, useDelivery } from '../context/DeliveryContext';
import DeliveryAuthPage from '../pages/DeliveryAuthPage';
import DeliveryOnboardingPage from '../pages/DeliveryOnboardingPage';
import DeliveryDashboardPage from '../pages/DeliveryDashboardPage';
import ActiveDeliveryPage from '../pages/ActiveDeliveryPage';
import EarningsPage from '../pages/EarningsPage';
import RiderHistoryPage from '../pages/RiderHistoryPage';
import ReturnPickupsPage from '../pages/ReturnPickupsPage';
import DeliveryProfilePage from '../pages/DeliveryProfilePage';
import DeliverySupportPage from '../pages/DeliverySupportPage';
import DeliveryNavbar from '../components/DeliveryNavbar';
import ReturnPickupPingModal from '../components/ReturnPickupPingModal';
import '../Delivery.css';
import { DELIVERY_SESSION_CHANGED } from '../../../utils/deliverySession';

const DeliveryRoutesContent = () => {
  const {
    isOnboarded, riderAuthed, bootstrapping, activeOrder, toastMessage, sessionError, retrySession,
    returnPickupPingOffer, acceptReturnPickup, declineReturnPickup, expireReturnPickup,
  } = useDelivery();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  // Sync state with location change events (popstate, pushstate, replacestate)
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    
    window.addEventListener('popstate', handleLocationChange);
    
    // Add listeners for dynamic context shifts (when App.jsx pushes new states)
    const interval = setInterval(() => {
      if (window.location.pathname !== currentPath) {
        setCurrentPath(window.location.pathname);
      }
    }, 200);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      clearInterval(interval);
    };
  }, [currentPath]);

  // Determine active tab from URL subpath
  const getActiveTab = () => {
    if (currentPath.endsWith('/earnings')) return 'earnings';
    if (currentPath.endsWith('/history')) return 'history';
    if (currentPath.endsWith('/returns')) return 'returns';
    if (currentPath.endsWith('/profile')) return 'profile';
    if (currentPath.endsWith('/support')) return 'support';
    return 'dashboard';
  };

  const activeTab = getActiveTab();

  const handleTabChange = (tabName) => {
    const pathSuffix = tabName === 'dashboard' ? 'dashboard' : tabName;
    window.history.pushState(null, '', `/delivery/${pathSuffix}`);
    setCurrentPath(`/delivery/${pathSuffix}`);
  };

  // An existing token is still being checked. Rendering the sign-in form now
  // would flash it at a rider who is already signed in.
  if (sessionError) return <div className="delivery-app-container" role="alert">{sessionError}<button type="button" onClick={retrySession}>Retry verification</button></div>;
  if (bootstrapping) {
    return (
      <div className="delivery-app-container">
        <div className="delivery-loading-text" style={{ padding: 40, textAlign: 'center' }}>
          Loading…
        </div>
      </div>
    );
  }

  // Nothing in the rider flow works without a session — the onboarding steps,
  // the location save and the document uploads all call authenticated endpoints.
  // So the phone check comes first, before any of it is shown.
  if (!riderAuthed) {
    return (
      <div className="delivery-app-container delivery-auth-viewport">
        {toastMessage && <div className="delivery-toast-banner">{toastMessage}</div>}
        <DeliveryAuthPage />
      </div>
    );
  }

  // If driver has not onboarded, force Onboarding Page layout
  if (!isOnboarded) {
    return (
      <div className="delivery-app-container">
        {toastMessage && <div className="delivery-toast-banner">{toastMessage}</div>}
        <div className="delivery-main-viewport delivery-onboarding-viewport">
          <DeliveryOnboardingPage />
        </div>
      </div>
    );
  }

  // Active delivery overlay overrides subpaths if an active order is being processed
  const renderActiveView = () => {
    if (activeOrder) {
      return <ActiveDeliveryPage />;
    }
    
    switch (activeTab) {
      case 'dashboard':
        return <DeliveryDashboardPage />;
      case 'earnings':
        return <EarningsPage />;
      case 'history':
        return <RiderHistoryPage />;
      case 'returns':
        return <ReturnPickupsPage />;
      case 'profile':
        return <DeliveryProfilePage />;
      case 'support':
        return <DeliverySupportPage />;
      default:
        return <DeliveryDashboardPage />;
    }
  };

  return (
    <div className="delivery-app-container">
      {/* Toast Alert popups */}
      {toastMessage && <div className="delivery-toast-banner">{toastMessage}</div>}

      {/* Main content scroll container */}
      <div className="delivery-main-viewport">
        {renderActiveView()}
      </div>

      {/*
        QUICK COMMERCE ONLY — rendered here, above every tab/subpath (not
        inside DeliveryDashboardPage the way OrderPingModal is), so a return
        pickup offer stays on screen no matter which route the rider is on
        (Section 17.5) — including on top of an active forward delivery.
      */}
      {returnPickupPingOffer && (
        <ReturnPickupPingModal
          offer={returnPickupPingOffer}
          onAccept={() => acceptReturnPickup(returnPickupPingOffer.returnId)}
          onDecline={() => declineReturnPickup(returnPickupPingOffer.returnId)}
          onExpire={() => expireReturnPickup(returnPickupPingOffer.returnId)}
        />
      )}

      {/* Bottom navbar for mobile viewport (hidden if in active delivery) */}
      {!activeOrder && (
        <DeliveryNavbar activeTab={activeTab} setActiveTab={handleTabChange} />
      )}
    </div>
  );
};

export const DeliveryRoutes = () => {
  const [session, setSession] = useState(() => ({ token: localStorage.getItem('deliveryToken'), revision: 0 }));
  useEffect(() => {
    const sync = event => {
      if (event.type === 'storage' && event.key && event.key !== 'deliveryToken') return;
      setSession(previous => ({ token: localStorage.getItem('deliveryToken'), revision: previous.revision + 1 }));
    };
    window.addEventListener(DELIVERY_SESSION_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(DELIVERY_SESSION_CHANGED, sync); window.removeEventListener('storage', sync); };
  }, []);
  return (
    <DeliveryProvider key={`${session.token || 'guest'}:${session.revision}`}>
      <DeliveryRoutesContent />
    </DeliveryProvider>
  );
};

export default DeliveryRoutes;
