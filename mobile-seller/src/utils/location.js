import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export class LocationError extends Error {}

// Asked only when the seller taps "Use my current location" (never at start-up).
async function ensureLocationPermission() {
  if (Platform.OS !== 'android') return;
  const { ACCESS_FINE_LOCATION: FINE, ACCESS_COARSE_LOCATION: COARSE } = PermissionsAndroid.PERMISSIONS;
  const { GRANTED, NEVER_ASK_AGAIN } = PermissionsAndroid.RESULTS;
  if (await PermissionsAndroid.check(FINE)) return;
  // Android 12+ ignores a request for FINE on its own; both must be asked together.
  const results = await PermissionsAndroid.requestMultiple([FINE, COARSE]);
  if (results[FINE] === GRANTED) return;
  if (results[COARSE] === GRANTED) {
    throw new LocationError('Bulkimart Seller needs your precise location to pin the store. Choose "Precise" in the permission prompt or in Android Settings.');
  }
  const result = results[FINE];
  throw new LocationError(result === NEVER_ASK_AGAIN
    ? 'Location permission is turned off for Bulkimart Seller. Allow it in Android Settings to pin your store.'
    : 'Allow location access to pin your store. Your typed address stays as it is.');
}

/** One high-accuracy fix, same options as the web ProfileTab (15 s timeout, no cached position). */
export async function currentPosition() {
  await ensureLocationPermission();
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new LocationError(err?.code === 3 ? 'Getting your location took too long. Move near a window and try again.'
        : err?.code === 2 ? 'Location is unavailable. Turn on location services and try again.'
          : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
