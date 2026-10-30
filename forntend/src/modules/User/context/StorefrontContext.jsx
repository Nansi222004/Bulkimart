import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useUser } from './UserContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { DEFAULT_TOKENS, freshExperience, showableExperience, normalizeExperience, themeStyle, rememberBootLook, readExperience, rememberExperience } from '../../../utils/storefront';
import { CustomerThemeContext } from '../../../components/CustomerThemeContext';
import { effectActive, effectApplies } from '../../../../../backend/shared/celebration.mjs';
const fallback = { theme: { tokens: DEFAULT_TOKENS }, banners: [], headerCategories: [], sections: [], splash: null, announcement: null };
const Context = createContext({ ...fallback, now: Date.now(), loading: false });
export const useStorefront = () => useContext(Context);
// On a phone, index.html starts the first storefront request while the app downloads. It is used
// for the matching storefront, given up after 3 seconds so a stalled request cannot block, and
// cleared once its answer is applied (React may start the first load twice in development).
export function takeEarlyExperience(key) {
  const early = typeof window !== 'undefined' && window.__bulkimartEarlyExperience;
  if (!early || early.key !== key) return null;
  return Promise.race([early.promise, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
}
const forgetEarlyExperience = () => { if (typeof window !== 'undefined') window.__bulkimartEarlyExperience = null; };
export function StorefrontProvider({ children }) {
  const user = useUser();
  const { activeMode, activeSubNav } = user;
  const [loading, setLoading] = useState(true), [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const [device, setDevice] = useState(() => window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop');
  const scope = activeMode === 'quick' ? 'quick' : 'shop-all';
  const category = ['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy'].includes(activeSubNav) ? '' : activeSubNav || '';
  const key = `${scope}:${device}:${category}`;
  const [data, setData] = useState(() => { const cached = readExperience(key); return cached ? { ...cached, key } : null; });
  useEffect(() => { const media = window.matchMedia('(max-width: 768px)'); const change = () => setDevice(media.matches ? 'mobile' : 'desktop'); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false, timer, pending = false, queued = false, initial = true;
    const controller = new AbortController();
    setLoading(true);
    const cached = readExperience(key);
    setData(cached ? { ...cached, key } : null);
    const refresh = async () => {
      if (cancelled) return;
      if (pending) { queued = true; return; }
      pending = true; clearTimeout(timer);
      let delay = 30000;
      try {
        const early = initial && takeEarlyExperience(key);
        let body = early ? await early : null;
        if (early) forgetEarlyExperience(); // answered (or given up): later loads ask the server
        if (early && !body) throw new Error('Early storefront request failed');
        if (!body || !freshExperience(body.data, Date.parse(body.data?.serverTime))) {
          const response = await boundedFetch(apiUrl(`/api/storefront/experience?${new URLSearchParams({ scope, device, category })}`), { signal: controller.signal, priority: 'high' }, initial ? 3000 : 10000);
          body = await response.json();
          if (!response.ok) throw new Error('Invalid storefront configuration');
        }
        if (!freshExperience(body.data, Date.parse(body.data?.serverTime))) throw new Error('Invalid storefront configuration');
        if (cancelled) return;
        offset.current = Date.parse(body.data.serverTime) - Date.now();
        setData({ ...body.data, key }); setClock(Date.now());
        // Refresh a few seconds before the copy expires, so the next one arrives while this one is still current.
        const ttl = Date.parse(body.data.validUntil) - Date.parse(body.data.serverTime);
        delay = Math.max(1000, Math.min(30000, ttl > 10000 ? ttl - 5000 : ttl));
        rememberExperience(key, body.data);
      } catch { delay = 5000; /* Retry soon; the current theme stays during the grace period below. */ }
      finally {
        initial = false;
        pending = false;
        if (!cancelled) {
          setLoading(false);
          if (queued) { queued = false; refresh(); }
          else { timer = setTimeout(refresh, delay); }
        }
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh(); window.addEventListener('app:soft-refresh', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); window.removeEventListener('app:soft-refresh', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [key]);
  const now = clock + offset.current;
  const current = data?.key === key && showableExperience(data, now) ? normalizeExperience(data) : fallback;
  useEffect(() => {
    // The desktop gutters sit outside the customer shell. Restore the host
    // background on exit so other portals keep their existing appearance.
    if (!document.body) return;
    const previous = document.body.style.background;
    document.body.style.background = current.theme.tokens.background || DEFAULT_TOKENS.background;
    return () => { document.body.style.background = previous; };
  }, [current.theme.tokens]);
  // Remember the published look (default included) for the next launch's first paint.
  useEffect(() => { if (current !== fallback) rememberBootLook(current.theme.tokens, current.theme.endAt); }, [current.theme.tokens, current.theme.endAt]);
  const effect = current.animations?.find(e => effectActive(e, now) && effectApplies(e, user));
  // The page-level effect is rendered by the festive header (or, without one,
  // inside the hero banner). It is never mounted over the whole viewport.
  return <Context.Provider value={{ ...current, effect, now, loading, device }}><CustomerThemeContext.Provider value={themeStyle(current.theme.tokens)}>{children}</CustomerThemeContext.Provider></Context.Provider>;
}
