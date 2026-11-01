import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { roundCoord } from '../utils/location';

/**
 * Foreground location only. Asked for when the rider goes on duty, starts a trip,
 * or taps "Use current location". The app declares no background-location permission
 * and stops every watcher when it is backgrounded (see DutyContext).
 */
Geolocation.setRNConfiguration({ skipPermissionRequests: true, locationProvider: 'auto' });

export const LOCATION_ERRORS = {
  denied: 'Location permission is off. Allow location for Bulkimart Delivery in phone settings, then retry.',
  unavailable: 'Your location is unavailable right now. Turn on GPS and retry.',
  timeout: 'Getting your location is taking too long. Move to open sky and retry.',
  generic: 'Could not read your location. Retry in a moment.',
};

const errorKey = (code) => ({ 1: 'denied', 2: 'unavailable', 3: 'timeout' }[code] || 'generic');

export async function hasLocationPermission() {
  if (Platform.OS !== 'android') return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
}

export async function requestLocationPermission() {
  if (Platform.OS !== 'android') return true;
  if (await hasLocationPermission()) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: 'Allow location while you deliver',
    message: 'Bulkimart uses your location while the app is open and you are on duty, to send nearby orders and show customers where their delivery is.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

const readOnce = (options) => new Promise((resolve) => {
  Geolocation.getCurrentPosition(
    (pos) => resolve({ ok: true, point: { lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude), accuracy: Math.round(pos.coords.accuracy || 0) } }),
    (err) => { const reason = errorKey(err?.code); resolve({ ok: false, reason, message: LOCATION_ERRORS[reason] }); },
    options,
  );
});

/**
 * One fresh location fix. Resolves { ok, point } or { ok:false, reason, message }. Never throws.
 * GPS first; indoors GPS often cannot get a fix, so on a timeout or "unavailable" it asks once more
 * for a fresh network (Wi-Fi / cell) fix. Both are new readings — an old cached position is never reused.
 */
export async function getCurrentPoint({ timeout = 15000, ask = true } = {}) {
  const allowed = ask ? await requestLocationPermission() : await hasLocationPermission();
  if (!allowed) return { ok: false, reason: 'denied', message: LOCATION_ERRORS.denied };
  const gps = await readOnce({ enableHighAccuracy: true, timeout, maximumAge: 0 });
  if (gps.ok || gps.reason === 'denied') return gps;
  const network = await readOnce({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  return network.ok ? network : gps;
}

/** Continuous fixes while a trip is live. Returns a stop function. */
export function watchPoint(onPoint, onError) {
  const watchId = Geolocation.watchPosition(
    (pos) => onPoint({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude), accuracy: Math.round(pos.coords.accuracy || 0) }),
    (err) => onError?.(LOCATION_ERRORS[errorKey(err?.code)]),
    { enableHighAccuracy: true, distanceFilter: 10, interval: 5000, fastestInterval: 5000, timeout: 20000, maximumAge: 5000 },
  );
  return () => Geolocation.clearWatch(watchId);
}
