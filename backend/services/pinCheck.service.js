import { reverseGeocode } from './geocode.service.js';

/**
 * Does the map pin sit where the written address says?
 *
 * A saved address keeps whatever pin it was saved with. When the pin was dropped somewhere else
 * (the customer's current location while typing a friend's address, say), every distance, fare and
 * rider assignment built on it is wrong while the address text still looks right. The written
 * pincode is the one part of the address that can be compared cheaply: Google's reverse lookup of
 * the pin gives the pincode the pin is really in.
 *
 * Advisory only: a mismatch is returned as a warning for the customer to check; nothing is blocked.
 * A failed or unavailable lookup returns null (no warning) rather than an error, so a slow map
 * service can never stop a booking. Lookups are cached by geocode.service.js.
 *
 * @returns {Promise<{ enteredPincode: string, pinPincode: string } | null>}
 */
export async function pinPincodeMismatch({ lat, lng, pincode }) {
  if (!/^\d{6}$/.test(String(pincode || '')) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  try {
    const hit = await reverseGeocode(Number(lat), Number(lng));
    const pinPincode = hit?.ok ? String(hit.address?.pincode || '') : '';
    if (!/^\d{6}$/.test(pinPincode) || pinPincode === String(pincode)) return null;
    return { enteredPincode: String(pincode), pinPincode };
  } catch {
    return null;
  }
}

/** Mismatch warnings for a set of named points, e.g. { pickup, dropoff }. Points that match are left out. */
export async function pinWarnings(points) {
  const entries = await Promise.all(Object.entries(points).map(async ([point, value]) => {
    const mismatch = value ? await pinPincodeMismatch(value) : null;
    return mismatch ? { point, ...mismatch } : null;
  }));
  return entries.filter(Boolean);
}
