import React from 'react';
import { SHGProvider, useSHG } from '../context/SHGContext';
import SHGDashboardPage from '../pages/SHGDashboardPage';
import SHGOnboardingPage from '../pages/SHGOnboardingPage';
import SHGLoginPage from '../pages/SHGLoginPage';
import '../SHG.css';

const SHGRouteContent = () => {
  const { isOnboarded } = useSHG();
  const path = window.location.pathname;

  // No session token — always the login screen, regardless of path, so a
  // logged-out visit to /shg never falls through to the onboarding wizard.
  if (!localStorage.getItem('userToken') || path === '/shg/login') {
    return <SHGLoginPage />;
  }

  return isOnboarded ? <SHGDashboardPage /> : <SHGOnboardingPage />;
};

export const SHGRoutes = () => {
  return (
    <SHGProvider>
      <div className="shg-app-container">
        <SHGRouteContent />
      </div>
    </SHGProvider>
  );
};

export default SHGRoutes;
