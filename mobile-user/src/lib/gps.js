// Foreground location on demand (web: navigator.geolocation.getCurrentPosition with enableHighAccuracy,
// timeout 15 s, maximumAge 0). The permission prompt only appears when the customer asks to use GPS.
// Error codes mirror the browser's: 1 = denied, 2 = unavailable, 3 = timeout.
import * as Location from 'expo-location';

/**
 * A readable address for a point, from the phone's own geocoder (free, no sign-in needed) — e.g.
 * "Vijay Nagar, Indore, Madhya Pradesh, 452010". Returns '' when the phone cannot resolve it.
 */
export async function deviceAddressLabel({ lat, lng }, timeout = 8000) {
  let timer;
  try {
    const places = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
      new Promise(resolve => { timer = setTimeout(() => resolve([]), timeout); }),
    ]);
    const p = places?.[0];
    if (!p) return '';
    const parts = [p.district || p.street || p.name, p.city || p.subregion, p.region, p.postalCode]
      .map(v => String(v || '').trim()).filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(', ');
  } catch {
    return '';
  } finally { clearTimeout(timer); }
}

export const looksLikeCoordinates = label => /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(String(label || ''));

export async function getCurrentPosition({ timeout = 15000 } = {}) {
  const permission = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!permission.granted) { const error = new Error('denied'); error.code = 1; throw error; }
  let timer;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('timeout'); error.code = 3; reject(error); }, timeout); }),
    ]);
    return position;
  } catch (error) {
    if (error?.code === 3) throw error;
    const unavailable = new Error('unavailable'); unavailable.code = 2; throw unavailable;
  } finally { clearTimeout(timer); }
}
