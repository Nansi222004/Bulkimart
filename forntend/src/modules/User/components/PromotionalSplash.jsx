import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { useStorefront } from '../context/StorefrontContext';
import { useUser } from '../context/UserContext';
import { eligibleSplash, markSplash, themeStyle } from '../../../utils/storefront';
import SplashCard from './SplashCard';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
export default function PromotionalSplash() {
  const { splash, now, device, theme } = useStorefront();
  const { activeNav, selectedProduct, selectedCampaignId } = useUser();
  const navigate = usePromotionNavigation();
  const consumed = useRef(false), [open, setOpen] = useState(null);
  useEffect(() => {
    if (activeNav !== 'home' || selectedProduct || selectedCampaignId || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    let session, local;
    try { session = window.sessionStorage; local = window.localStorage; } catch { /* private browsing can deny storage entirely */ }
    const storage = { now, session, local, consumed: consumed.current };
    if (eligibleSplash(splash, storage)) { consumed.current = true; markSplash(splash, storage); setOpen(splash); }
  }, [splash, now, activeNav, selectedProduct, selectedCampaignId]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(null), Math.min(15, Math.max(2, open.config.duration)) * 1000);
    const escape = event => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', escape);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!open || open.id !== splash?.id || open.revision !== splash?.revision || (open.endAt && Date.parse(open.endAt) <= now) || activeNav !== 'home' || selectedProduct || selectedCampaignId) return null;
  return <ModalPortal className="sf-splash" style={themeStyle(theme.tokens)} role="dialog" aria-modal="true" aria-label={open.banner.title || 'Promotion'}>
    <SplashCard banner={open.banner} device={device} now={now} endAt={open.endAt} showCountdown={open.config.countdown}
      onDismiss={() => setOpen(null)} onNavigate={destination => { setOpen(null); navigate(destination); }} />
  </ModalPortal>;
}
