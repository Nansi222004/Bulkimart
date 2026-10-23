import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { useStorefront } from '../context/StorefrontContext';
import { useUser } from '../context/UserContext';
import { eligibleSplash, markSplash, themeStyle, countdown } from '../../../utils/storefront';
import StorefrontMedia from './StorefrontMedia';
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
    <div className="sf-splash-card">
      <button className="sf-skip" onClick={() => setOpen(null)} aria-label="Close promotion">Skip ✕</button>
      <StorefrontMedia banner={open.banner} device={device} eager />
      <div className="sf-splash-copy"><span className="sf-eyebrow">BULKIMART PICKS</span><h2>{open.banner.title}</h2><p>{open.banner.subtitle}</p>
        {open.config.countdown && open.endAt && <p>Ends in <time>{countdown(open.endAt, now)}</time></p>}
        {open.banner.destination.type !== 'NONE' && <button className="sf-cta" onClick={() => { setOpen(null); navigate(open.banner.destination); }}>{open.banner.cta || 'Explore now'} →</button>}
      </div>
    </div>
  </ModalPortal>;
}
