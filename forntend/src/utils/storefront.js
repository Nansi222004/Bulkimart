export { DEFAULT_TOKENS, COLOR_KEYS, resolveTokens, PRESETS, PRESET_EFFECTS, themeStyle, lifecycle, DEFAULT_HEADER, DEFAULT_COUNTDOWN, HEADER_TARGETS, headerDestination, countdownState, countdownParts, SPLASH_DURATION, SPLASH_SKIP_AFTER, splashSeconds, splashDurationText } from '../../../backend/shared/storefront.mjs';
// An anonymous response from a pre-migration server/cache is a brand fallback,
// not an administrator's published theme. Explicit theme IDs remain authoritative.
export function normalizeExperience(data) {
  return data?.theme?.id ? data : { ...data, theme: { tokens: DEFAULT_TOKENS } };
}
import { DEFAULT_TOKENS } from '../../../backend/shared/storefront.mjs';
export function freshExperience(data, now = Date.now()) {
  return !!data?.version && Array.isArray(data.banners) && Array.isArray(data.sections) && Number.isFinite(Date.parse(data.validUntil)) && Date.parse(data.validUntil) > now;
}
// Only reuse a still-current publication. Persistent storage makes a fresh copy
// available across app/browser launches; storage denial must never block startup.
export function readExperience(key) {
  for (const name of ['sessionStorage', 'localStorage']) {
    try {
      const data = JSON.parse(window[name].getItem(`bulkimart:experience:${key}`));
      if (freshExperience(data) && (!data.scheduleUntil || Date.parse(data.scheduleUntil) > Date.now())) return data;
    } catch { /* optional cache */ }
  }
  return null;
}
export function rememberExperience(key, data) {
  for (const name of ['sessionStorage', 'localStorage']) {
    try { window[name].setItem(`bulkimart:experience:${key}`, JSON.stringify(data)); } catch { /* optional cache */ }
  }
}
// What the storefront may keep showing. validUntil is only the refresh deadline, so a slow or
// failed refresh keeps the admin's theme for up to two minutes, but never past a scheduled change.
export const EXPERIENCE_GRACE_MS = 120000;
export function showableExperience(data, now = Date.now()) {
  if (freshExperience(data, now)) return true;
  if (!data?.version || !Array.isArray(data.banners) || !Array.isArray(data.sections)) return false;
  const schedule = data.scheduleUntil ? Date.parse(data.scheduleUntil) : Infinity;
  return Date.parse(data.validUntil) + EXPERIENCE_GRACE_MS > now && now < schedule;
}
export function frequencyKey(splash, now = Date.now()) {
  const base = `bulkimart:splash:${splash.id}:${splash.revision}`;
  return splash.config.frequency === 'daily' ? `${base}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}` : base;
}
export function eligibleSplash(splash, { now = Date.now(), session, local, consumed = false } = {}) {
  if (!splash || consumed || (splash.endAt && Date.parse(splash.endAt) <= now) || (splash.startAt && Date.parse(splash.startAt) > now)) return false;
  if (splash.config.frequency === 'launch') return true;
  try { return !(splash.config.frequency === 'session' ? session : local)?.getItem(frequencyKey(splash, now)); } catch { return true; }
}
export function markSplash(splash, { session, local, now = Date.now() }) {
  if (splash.config.frequency === 'launch') return;
  try { (splash.config.frequency === 'session' ? session : local)?.setItem(frequencyKey(splash, now), '1'); } catch { /* memory launch guard remains effective */ }
}
export function countdown(endAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(endAt) - now) / 1000));
  if (!Number.isFinite(seconds) || !seconds) return '';
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
// The colours this device last showed. The first paint (index.html) and the phone launch
// screen use them, so an active theme appears at once instead of the default red. Only plain
// hex colours are stored and read; anything else falls back to the default look.
export const BOOT_LOOK_KEY = 'bulkimart:boot-look';
const hex = value => typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined;
export function rememberBootLook(tokens = {}, until = null) {
  try { localStorage.setItem(BOOT_LOOK_KEY, JSON.stringify({ header: hex(tokens.header), headerText: hex(tokens.headerText), background: hex(tokens.background), search: hex(tokens.search), until: until || null })); } catch { /* storage is optional */ }
}
export function bootLook(now = Date.now()) {
  try {
    const look = JSON.parse(localStorage.getItem(BOOT_LOOK_KEY));
    if (!look || (look.until && !(Date.parse(look.until) > now))) return null;
    return { header: hex(look.header), headerText: hex(look.headerText), background: hex(look.background), search: hex(look.search) };
  } catch { return null; }
}
export const bootLookStyle = look => look ? Object.fromEntries([['--boot-header', look.header], ['--boot-header-text', look.headerText], ['--boot-background', look.background], ['--boot-search', look.search]].filter(([, v]) => v)) : {};
