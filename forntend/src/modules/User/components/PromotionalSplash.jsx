import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { useStorefront } from '../context/StorefrontContext';
import { useUser } from '../context/UserContext';
import { eligibleSplash, markSplash, themeStyle } from '../../../utils/storefront';
import SplashCard from './SplashCard';
import usePromotionNavigation from '../hooks/usePromotionNavigation';

// "Once per launch" must outlive this component: signing in or out remounts
// the whole customer tree (CustomerSessionGate keys it by session), which used
// to reset a ref and show the splash again. The window object lives exactly as
// long as one app launch, so the guard sits there.
const LAUNCH_GUARD = '__bulkimartSplashShown';
const splashKey = splash => `${splash.id}:${splash.revision}`;
const shownThisLaunch = splash => Boolean(splash) && Boolean(window[LAUNCH_GUARD]?.has(splashKey(splash)));
const rememberLaunch = splash => { (window[LAUNCH_GUARD] ||= new Set()).add(splashKey(splash)); };

export default function PromotionalSplash({ children }) {
  const { splash, now, device, theme, loading, version } = useStorefront();
  const { activeNav, selectedProduct, selectedCampaignId, productDetailLoading, productDetailError, selectedOrder, reviewProductId } = useUser();
  const navigate = usePromotionNavigation();
  const consumed = useRef(false), [open, setOpen] = useState(null);
  const [launchChecked, setLaunchChecked] = useState(false);
  const homeLaunch = activeNav === 'home' && !selectedProduct && !selectedCampaignId && !productDetailLoading && !productDetailError && !selectedOrder && !reviewProductId;
  useEffect(() => {
    // Decide before mounting the home tree: CSS hiding still starts its requests.
    // A fresh cached version can be used while the provider revalidates it.
    if (homeLaunch && !launchChecked && loading && !version) return;
    if (!homeLaunch || document.querySelector('[role="dialog"], [role="alertdialog"]')) { setLaunchChecked(true); return; }
    let session, local;
    try { session = window.sessionStorage; local = window.localStorage; } catch { /* private browsing can deny storage entirely */ }
    const storage = { now, session, local, consumed: consumed.current || shownThisLaunch(splash) };
    if (eligibleSplash(splash, storage)) { consumed.current = true; rememberLaunch(splash); markSplash(splash, storage); setOpen(splash); }
    setLaunchChecked(true);
  }, [splash, now, homeLaunch, launchChecked, loading, version]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(null), Math.min(15, Math.max(2, open.config.duration)) * 1000);
    const escape = event => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', escape);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', escape); };
  }, [open]);
  const visible = open && open.id === splash?.id && open.revision === splash?.revision && (!open.endAt || Date.parse(open.endAt) > now) && homeLaunch;
  if (!visible) {
    if (homeLaunch && !launchChecked) return <div className="sf-launch-loading" style={themeStyle(theme.tokens)}><strong>Bulkimart</strong><p role="status">Opening your store…</p></div>;
    return children || null;
  }
  return <ModalPortal className="sf-splash" style={themeStyle(theme.tokens)} role="dialog" aria-modal="true" aria-label={open.banner.title || 'Promotion'}>
    <SplashCard banner={open.banner} device={device} now={now} endAt={open.endAt} showCountdown={open.config.countdown}
      onNavigate={destination => { setOpen(null); navigate(destination); }} />
  </ModalPortal>;
}
