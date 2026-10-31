// Port of frontend/src/modules/User/context/StorefrontContext.jsx + utils/storefront.js.
// The admin-managed Storefront Studio publication (theme, banners, header categories, sections, promotional
// splash, announcement, animations) is fetched from GET /api/storefront/experience — nothing is bundled.
// Publication rules are the web's: a copy is used only while fresh (validUntil), kept for at most a 2-minute
// grace period if a refresh fails, and never past a scheduled change (scheduleUntil). Refresh runs 5 s before
// expiry (≤30 s), 5 s after a failure, on app foreground, when back online and on pull-to-refresh.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { boundedFetch } from '../api/client';
import { local, session, readJSON } from '../lib/storage';
import { on, EVENTS } from '../lib/events';
import { DEFAULT_TOKENS } from '../shared/storefront';
import { effectActive, effectApplies } from '../shared/celebration';
import { themeFrom } from '../theme';
import { ThemeContext } from '../theme/ThemeContext';
import { useUser } from './UserContext';

const fallback = { theme: { tokens: DEFAULT_TOKENS }, banners: [], headerCategories: [], sections: [], splash: null, announcement: null };
const Context = createContext({ ...fallback, loading: false, device: 'mobile' });
const NowContext = createContext(Date.now());
export const useStorefront = () => useContext(Context);
/** Server-corrected time, ticking each second. Only countdowns and animations read it. */
export const useStorefrontNow = () => useContext(NowContext);

export function normalizeExperience(data) {
  return data?.theme?.id ? data : { ...data, theme: { tokens: DEFAULT_TOKENS } };
}
export function freshExperience(data, now = Date.now()) {
  return !!data?.version && Array.isArray(data.banners) && Array.isArray(data.sections) && Number.isFinite(Date.parse(data.validUntil)) && Date.parse(data.validUntil) > now;
}
export function readExperience(key) {
  for (const store of [session, local]) {
    const data = readJSON(store, `bulkimart:experience:${key}`);
    if (freshExperience(data) && (!data.scheduleUntil || Date.parse(data.scheduleUntil) > Date.now())) return data;
  }
  return null;
}
export function rememberExperience(key, data) {
  for (const store of [session, local]) { try { store.setItem(`bulkimart:experience:${key}`, JSON.stringify(data)); } catch { /* optional cache */ } }
}
export const EXPERIENCE_GRACE_MS = 120000;
export function showableExperience(data, now = Date.now()) {
  if (freshExperience(data, now)) return true;
  if (!data?.version || !Array.isArray(data.banners) || !Array.isArray(data.sections)) return false;
  const schedule = data.scheduleUntil ? Date.parse(data.scheduleUntil) : Infinity;
  return Date.parse(data.validUntil) + EXPERIENCE_GRACE_MS > now && now < schedule;
}

// Splash frequency (web utils/storefront.js): 'launch' every launch, 'session' once per app session,
// 'daily' once per India day, 'version' once per published revision.
export function frequencyKey(splash, now = Date.now()) {
  const base = `bulkimart:splash:${splash.id}:${splash.revision}`;
  return splash.config.frequency === 'daily' ? `${base}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}` : base;
}
export function eligibleSplash(splash, { now = Date.now(), consumed = false } = {}) {
  if (!splash || consumed || (splash.endAt && Date.parse(splash.endAt) <= now) || (splash.startAt && Date.parse(splash.startAt) > now)) return false;
  if (splash.config.frequency === 'launch') return true;
  return !(splash.config.frequency === 'session' ? session : local).getItem(frequencyKey(splash, now));
}
export function markSplash(splash, now = Date.now()) {
  if (splash.config.frequency === 'launch') return;
  (splash.config.frequency === 'session' ? session : local).setItem(frequencyKey(splash, now), '1');
}
export function countdown(endAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(endAt) - now) / 1000));
  if (!Number.isFinite(seconds) || !seconds) return '';
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
// The colours this device last showed, for the next launch's first paint (web rememberBootLook / bootLook).
export const BOOT_LOOK_KEY = 'bulkimart:boot-look';
const hex = value => (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined);
export function rememberBootLook(tokens = {}, until = null) {
  try { local.setItem(BOOT_LOOK_KEY, JSON.stringify({ header: hex(tokens.header), headerText: hex(tokens.headerText), background: hex(tokens.background), search: hex(tokens.search), until: until || null })); } catch { /* optional */ }
}
export function bootLook(now = Date.now()) {
  const look = readJSON(local, BOOT_LOOK_KEY);
  if (!look || (look.until && !(Date.parse(look.until) > now))) return null;
  return { header: hex(look.header), headerText: hex(look.headerText), background: hex(look.background), search: hex(look.search) };
}

export function StorefrontProvider({ children }) {
  const user = useUser();
  const { activeMode, activeSubNav, activeNav, selectedCampaignId } = user;
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const device = 'mobile';
  const scope = activeMode === 'quick' ? 'quick' : 'shop-all';
  const category = ['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy'].includes(activeSubNav) ? '' : activeSubNav || '';
  const key = `${scope}:${device}:${category}`;
  const [data, setData] = useState(() => { const cached = readExperience(key); return cached ? { ...cached, key } : null; });

  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === 'active') setClock(Date.now()); }, 1000);
    return () => clearInterval(timer);
  }, []);

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
        const response = await boundedFetch(`/api/storefront/experience?${new URLSearchParams({ scope, device, category })}`, { signal: controller.signal }, initial ? 3000 : 10000);
        const body = await response.json();
        if (!response.ok) throw new Error('Invalid storefront configuration');
        if (!freshExperience(body.data, Date.parse(body.data?.serverTime))) throw new Error('Invalid storefront configuration');
        if (cancelled) return;
        offset.current = Date.parse(body.data.serverTime) - Date.now();
        setData({ ...body.data, key }); setClock(Date.now());
        const ttl = Date.parse(body.data.validUntil) - Date.parse(body.data.serverTime);
        delay = Math.max(1000, Math.min(30000, ttl > 10000 ? ttl - 5000 : ttl));
        rememberExperience(key, body.data);
      } catch { delay = 5000; /* retry soon; the current theme stays during the grace period */ }
      finally {
        initial = false;
        pending = false;
        if (!cancelled) {
          setLoading(false);
          if (queued) { queued = false; refresh(); } else { timer = setTimeout(refresh, delay); }
        }
      }
    };
    refresh();
    const stopSoft = on(EVENTS.SOFT_REFRESH, refresh);
    const stopOnline = on(EVENTS.ONLINE, refresh);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); stopSoft(); stopOnline(); appState.remove(); };
  }, [key, scope, category]);

  const now = clock + offset.current;
  const showable = Boolean(data?.key === key && showableExperience(data, now));
  const current = useMemo(() => (showable ? normalizeExperience(data) : fallback), [showable, data]);
  const effectCandidates = current.animations || [];
  const activeEffects = effectCandidates.filter(e => effectActive(e, now)).map(e => `${e.id}:${e.revision}`).join('|');
  const productOpen = activeNav === 'product', orderOpen = activeNav === 'order', reviewOpen = activeNav === 'review';
  const effect = useMemo(() => effectCandidates.find(e => effectActive(e, Date.now() + offset.current) && effectApplies(e, {
    activeNav: ['product', 'order', 'review', 'campaign'].includes(activeNav) ? 'overlay' : activeNav,
    selectedCampaignId: activeNav === 'campaign' ? selectedCampaignId : null,
    selectedProduct: productOpen ? {} : null, selectedOrder: orderOpen ? {} : null, reviewProductId: reviewOpen ? 'x' : null, productDetailLoading: false,
  })), [activeEffects, current, activeNav, selectedCampaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (current !== fallback) rememberBootLook(current.theme.tokens, current.theme.endAt); }, [current]);
  const theme = useMemo(() => themeFrom(current.theme.tokens), [current.theme.tokens]);
  const value = useMemo(() => ({ ...current, effect, loading, device }), [current, effect, loading]);
  return <Context.Provider value={value}>
    <ThemeContext.Provider value={theme}>
      <NowContext.Provider value={now}>{children}</NowContext.Provider>
    </ThemeContext.Provider>
  </Context.Provider>;
}
