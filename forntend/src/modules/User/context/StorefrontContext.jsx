import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useUser } from './UserContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { DEFAULT_TOKENS, freshExperience, normalizeExperience, themeStyle } from '../../../utils/storefront';
import { CustomerThemeContext } from '../../../components/CustomerThemeContext';
const fallback = { theme: { tokens: DEFAULT_TOKENS }, banners: [], headerCategories: [], sections: [], splash: null, announcement: null };
const Context = createContext({ ...fallback, now: Date.now(), loading: false });
export const useStorefront = () => useContext(Context);
export function StorefrontProvider({ children }) {
  const { activeMode, activeSubNav } = useUser();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const [device, setDevice] = useState(() => window.matchMedia('(max-width: 600px)').matches ? 'mobile' : 'desktop');
  const scope = activeMode === 'quick' ? 'quick' : 'shop-all';
  const category = ['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy'].includes(activeSubNav) ? '' : activeSubNav || '';
  const key = `${scope}:${device}:${category}`;
  useEffect(() => { const media = window.matchMedia('(max-width: 600px)'); const change = () => setDevice(media.matches ? 'mobile' : 'desktop'); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false, timer, pending = false, queued = false;
    const controller = new AbortController();
    setLoading(true); setData(null);
    try { const cached = JSON.parse(sessionStorage.getItem(`bulkimart:experience:${key}`)); if (freshExperience(cached)) setData({ ...cached, key }); } catch { /* optional cache */ }
    const refresh = async () => {
      if (cancelled) return;
      if (pending) { queued = true; return; }
      pending = true; clearTimeout(timer);
      let delay = 30000;
      try {
        const response = await boundedFetch(apiUrl(`/api/storefront/experience?${new URLSearchParams({ scope, device, category })}`), { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !freshExperience(body.data, Date.parse(body.data?.serverTime))) throw new Error('Invalid storefront configuration');
        if (cancelled) return;
        offset.current = Date.parse(body.data.serverTime) - Date.now();
        setData({ ...body.data, key }); setClock(Date.now());
        delay = Math.max(1000, Math.min(30000, Date.parse(body.data.validUntil) - Date.parse(body.data.serverTime)));
        try { sessionStorage.setItem(`bulkimart:experience:${key}`, JSON.stringify(body.data)); } catch { /* quota/private mode */ }
      } catch { /* valid cached content expires below; normal shopping always remains */ }
      finally {
        pending = false;
        if (!cancelled) {
          setLoading(false);
          if (queued) { queued = false; refresh(); }
          else { timer = setTimeout(refresh, delay); }
        }
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh(); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [key]);
  const now = clock + offset.current;
  const current = data?.key === key && freshExperience(data, now) ? normalizeExperience(data) : fallback;
  useEffect(() => {
    // The desktop gutters sit outside the customer shell. Restore the host
    // background on exit so other portals keep their existing appearance.
    if (!document.body) return;
    const previous = document.body.style.background;
    document.body.style.background = current.theme.tokens.background || DEFAULT_TOKENS.background;
    return () => { document.body.style.background = previous; };
  }, [current.theme.tokens]);
  return <Context.Provider value={{ ...current, now, loading, device }}><CustomerThemeContext.Provider value={themeStyle(current.theme.tokens)}>{children}</CustomerThemeContext.Provider></Context.Provider>;
}
