import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { useStorefront } from '../context/StorefrontContext';
import { useUser } from '../context/UserContext';
import { eligibleSplash, markSplash, themeStyle, bootLook, bootLookStyle, splashSeconds, SPLASH_SKIP_AFTER } from '../../../utils/storefront';
import SplashCard from './SplashCard';
import { useMediaReady } from './StorefrontMedia';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import defaultBanner from '../../../assets/banner1.webp';
import bulkimartIcon from '../../../assets/logo-icon-transparent.png';

// "Once per launch" must outlive this component: signing in or out remounts
// the whole customer tree (CustomerSessionGate keys it by session), which used
// to reset a ref and show the splash again. The window object lives exactly as
// long as one app launch, so the guard sits there.
const LAUNCH_GUARD = '__bulkimartSplashShown';
const splashKey = splash => `${splash.id}:${splash.revision}`;
const shownThisLaunch = splash => Boolean(splash) && Boolean(window[LAUNCH_GUARD]?.has(splashKey(splash)));
const rememberLaunch = splash => { (window[LAUNCH_GUARD] ||= new Set()).add(splashKey(splash)); };
const LaunchContext = createContext(false);
export const useLaunchSplash = () => useContext(LaunchContext);

// Same markup as the launch screen in index.html (its styles live there): the logo with a spinner on
// the live theme colour once it is known, otherwise on the theme last shown on this device.
export const StoreLoading = ({ tokens }) => <div className="boot-home sf-launch-wait" style={bootLookStyle(tokens ? { header: tokens.header, headerText: tokens.headerText } : bootLook())} role="status" aria-busy="true" aria-label="Loading Bulkimart">
  <img className="boot-logo" src={bulkimartIcon} alt="" width="104" height="104" />
  <b className="boot-spinner" />
</div>;

export default function PromotionalSplash({ children }) {
  const { splash, now, device, theme, loading, version, banners = [] } = useStorefront();
  // The first screen is ready when its main banner picture is: the loader waits for it once (given
  // up after 3 seconds), so the page does not appear with an empty grey banner.
  const revealed = useRef(false);
  const heroArt = banners.length ? (device === 'mobile' && banners[0].mobileImage || banners[0].image) : defaultBanner;
  const heroReady = useMediaReady(version && !revealed.current ? heroArt : null, 3000);
  const { activeNav, selectedProduct, selectedCampaignId, productDetailLoading, productDetailError, selectedOrder, reviewProductId } = useUser();
  const navigate = usePromotionNavigation();
  const homeLaunch = activeNav === 'home' && !selectedProduct && !selectedCampaignId && !productDetailLoading && !productDetailError && !selectedOrder && !reviewProductId;
  // The splash is an app-launch screen for phones. On a desktop the website opens directly.
  const phone = device === 'mobile';
  const consumed = useRef(false), [open, setOpen] = useState(() => {
    if (!phone || !homeLaunch || shownThisLaunch(splash) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return null;
    let session, local;
    try { session = window.sessionStorage; local = window.localStorage; } catch { /* storage is optional */ }
    return eligibleSplash(splash, { now, session, local }) ? splash : null;
  });
  const [launchChecked, setLaunchChecked] = useState(false);
  useEffect(() => {
    if (!phone) { setLaunchChecked(true); return; }
    // Decide before mounting the home tree, then prepare it behind the splash.
    // A fresh cached version can be used while the provider revalidates it.
    if (homeLaunch && !launchChecked && loading && !version) return;
    if (!homeLaunch || (!open && document.querySelector('[role="dialog"], [role="alertdialog"]'))) { setLaunchChecked(true); return; }
    let session, local;
    try { session = window.sessionStorage; local = window.localStorage; } catch { /* private browsing can deny storage entirely */ }
    const storage = { now, session, local, consumed: consumed.current || shownThisLaunch(splash) };
    if (eligibleSplash(splash, storage)) { consumed.current = true; rememberLaunch(splash); markSplash(splash, storage); setOpen(splash); }
    setLaunchChecked(true);
  }, [splash, now, homeLaunch, launchChecked, loading, version, phone, open]);
  // The launch may open a cached copy while the storefront revalidates. When the refresh brings the
  // same splash republished (e.g. a new duration), switch to it instead of closing after a second.
  useEffect(() => {
    if (!open || splash?.id !== open.id || splash.revision === open.revision) return;
    rememberLaunch(splash); setOpen(splash);
  }, [splash, open]);
  // On wide screens the artwork also fills the backdrop, blurred, so a portrait splash never sits on a bare colour.
  const art = open && (device === 'mobile' && open.banner.mobileImage || open.banner.image);
  const artReady = useMediaReady(art);
  useEffect(() => {
    if (!open) return;
    const escape = event => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  // The configured seconds count from when the artwork is on screen, not from when it started downloading.
  useEffect(() => {
    if (!open || !artReady) return;
    const timer = setTimeout(() => setOpen(null), splashSeconds(open.config.duration) * 1000);
    return () => clearTimeout(timer);
  }, [open, artReady]);
  const visible = phone && open && open.id === splash?.id && (!open.endAt || Date.parse(open.endAt) > now) && homeLaunch;
  if (!visible) {
    // Mobile goes directly to the eligible splash, or home after the bounded
    // configuration check. Only desktop waits behind the branded image loader.
    if (homeLaunch && !revealed.current && (!launchChecked || (loading && !version) || (!phone && version && !heroReady))) {
      return phone ? null : <StoreLoading tokens={version ? theme.tokens : null} />;
    }
    if (homeLaunch) revealed.current = true;
  }
  if (!visible && !children) return null;
  // Keep this tree mounted when the overlay closes: its requests and images can
  // finish in the background, without exposing controls or opening other dialogs.
  return <>
    {children && <LaunchContext.Provider value={Boolean(visible)}><div className="sf-launch-content" style={{ display: visible ? 'none' : 'contents' }} inert={visible ? true : undefined} aria-hidden={visible ? true : undefined}>{children}</div></LaunchContext.Provider>}
    {visible && <ModalPortal className="sf-splash" style={{ ...themeStyle(theme.tokens), ...(art ? { '--sf-splash-art': `url(${JSON.stringify(art)})` } : {}) }} role="dialog" aria-modal="true" aria-label={open.banner.title || 'Promotion'}>
    <SplashCard banner={open.banner} device={device} now={now} endAt={open.endAt} showCountdown={open.config.countdown}
      onNavigate={destination => { setOpen(null); navigate(destination); }}
      onSkip={splashSeconds(open.config.duration) > SPLASH_SKIP_AFTER ? () => setOpen(null) : undefined} />
  </ModalPortal>}
  </>;
}
