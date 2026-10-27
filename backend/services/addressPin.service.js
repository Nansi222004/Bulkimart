import { forwardGeocode } from './geocode.service.js';

/**
 * A saved address without a map pin is located once, and the pin is kept.
 *
 * Delivery is priced by distance when the destination has a point and by the
 * flat fee when it does not. The cart quote reads the saved address and the
 * order geocodes it, so an unpinned address used to be quoted the flat fee and
 * then charged the distance rate. Pinning it here, with the same lookup the
 * order uses, gives both the same point and the same charge.
 */
const hasPin = address => address?.lat != null && address?.lng != null;

export const geocodeAddressPin = async (address) => {
  if (!address?.line1 || !address?.city || !address?.pincode) return null;
  const hit = await forwardGeocode([address.line1, address.line2, address.city, address.state, address.pincode, 'India']);
  return hit.ok ? { lat: hit.lat, lng: hit.lng, locationSource: 'geocoded' } : null;
};

/** Pins every unpinned address on a User document; saves only when one changed. */
export const pinSavedAddresses = async (user) => {
  let changed = false;
  for (const address of user?.addresses || []) {
    if (hasPin(address)) continue;
    const pin = await geocodeAddressPin(address);
    if (pin) { Object.assign(address, pin); changed = true; }
  }
  if (changed) await user.save();
  return changed;
};
