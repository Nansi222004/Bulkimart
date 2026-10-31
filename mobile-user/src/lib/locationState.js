// Port of frontend/src/utils/locationState.js. The browsing location lives for the app session
// (web: sessionStorage, 24 h max); the prompt decision persists (web: localStorage).
import { local, session } from './storage';

export const LOCATION_CHOICE = 'bulkimart:location-choice';
const POINT_KEY = 'bulkimart:browsing-location';
const MAX_AGE = 24 * 60 * 60 * 1000;
export const validPoint = value => typeof value?.lat === 'number' && typeof value?.lng === 'number'
  && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180 && (value.lat !== 0 || value.lng !== 0);
export function rememberLocationChoice(outcome) {
  try { local.setItem(LOCATION_CHOICE, JSON.stringify({ outcome, at: Date.now() })); } catch { /* optional */ }
}
export function readBrowsingLocation() {
  try {
    const value = JSON.parse(session.getItem(POINT_KEY) || 'null');
    if (!value || !Number.isFinite(value.at) || typeof value.label !== 'string' || !value.label.trim() || Date.now() - value.at > MAX_AGE || value.at > Date.now() || (value.coords && !validPoint(value.coords))) { session.removeItem(POINT_KEY); return null; }
    return value;
  } catch { return null; }
}
export function saveBrowsingLocation(label, coords, source) {
  if (coords && !validPoint(coords)) throw new Error('Invalid location coordinates. Enter your location manually.');
  session.setItem(POINT_KEY, JSON.stringify({ label: String(label).slice(0, 250), coords: coords || null, source, at: Date.now() }));
  rememberLocationChoice(source);
}
export function shouldPromptForLocation() {
  try { return !readBrowsingLocation() && !local.getItem(LOCATION_CHOICE) && !local.getItem('locationAsked'); } catch { return false; }
}
export function revokeBrowsingGps() {
  const saved = readBrowsingLocation();
  if (saved?.source === 'gps') session.removeItem(POINT_KEY);
}
