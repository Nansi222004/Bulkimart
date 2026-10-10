import React from 'react';
import LandingPage from '../pages/LandingPage';
import CustomerSplashScreen from '../components/CustomerSplashScreen';

/**
 * User module routes entry point.
 * In a full app, this would use react-router-dom Routes/Route config.
 */
export const UserRoutes = () => {
  return (
    <>
      <LandingPage />
      <CustomerSplashScreen />
    </>
  );
};

export default UserRoutes;
