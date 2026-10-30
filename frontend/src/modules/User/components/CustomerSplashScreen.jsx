import { useEffect, useState } from 'react';
import bulkimartIcon from '../../../assets/logo-icon-transparent.png';

const MINIMUM_SPLASH_MS = 680;
const FADE_OUT_MS = 180;

/** A brief storefront-only startup cover; never waits for network requests. */
const CustomerSplashScreen = () => {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let removeTimer;
    const exitTimer = window.setTimeout(() => {
      setLeaving(true);
      removeTimer = window.setTimeout(() => setVisible(false), FADE_OUT_MS);
    }, MINIMUM_SPLASH_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`customer-splash${leaving ? ' customer-splash--leaving' : ''}`} role="status" aria-label="Loading Bulkimart">
      <div className="customer-splash__brand">
        <img className="customer-splash__icon" src={bulkimartIcon} alt="" />
        <span className="customer-splash__name"><span>Bulk</span><span>imart</span></span>
        <span className="customer-splash__tagline">Sabse Smart Bulkimart</span>
      </div>
    </div>
  );
};

export default CustomerSplashScreen;
