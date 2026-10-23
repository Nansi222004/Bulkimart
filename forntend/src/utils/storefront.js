export { DEFAULT_TOKENS, PRESETS, themeStyle, lifecycle } from '../../../backend/shared/storefront.mjs';
export function freshExperience(data, now = Date.now()) {
  return !!data?.version && Array.isArray(data.banners) && Array.isArray(data.sections) && Number.isFinite(Date.parse(data.validUntil)) && Date.parse(data.validUntil) > now;
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
