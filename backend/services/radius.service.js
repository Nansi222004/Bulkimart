import { distanceKm } from '../utils/geo.js';

/**
 * The one place "is X within Y's configured radius" gets decided —
 * product visibility, cart/checkout eligibility, and rider dispatch all
 * call this instead of each working out their own distance/radius rule.
 *
 * `radiusKm` absent/undefined means UNRESTRICTED, not "0 km" — a seller
 * or rider nobody has configured a radius for yet must keep behaving
 * exactly as they did before this feature existed. This is deliberate,
 * not a default value: Seller.js/DeliveryPartner.js store no radius at
 * all until an admin sets one, and this function is where that absence
 * is turned into "always serviceable" rather than silently defaulting to
 * some assumed number an admin never actually chose.
 *
 * Missing coordinates on either side (seller/rider has no lat/lng, or the
 * customer has none) means the distance itself is unknowable — treated as
 * NOT serviceable rather than guessed at, per the plan's own rule: never
 * assume someone is within range when their location isn't known.
 */
export const isWithinRadius = (sourceLoc, targetLoc, radiusKm) => {
  if (radiusKm === undefined || radiusKm === null) return true;
  const km = distanceKm(sourceLoc, targetLoc);
  if (km === undefined) return false;
  return km <= radiusKm; // boundary case: distance === radius is WITHIN
};

/** Same check, but also hands back the computed distance (or undefined),
 *  for callers that want to report/log why something was excluded. */
export const radiusCheck = (sourceLoc, targetLoc, radiusKm) => {
  const km = distanceKm(sourceLoc, targetLoc);
  const within = radiusKm === undefined || radiusKm === null
    ? true
    : (km !== undefined && km <= radiusKm);
  return { within, distanceKm: km };
};

/**
 * Batched — given a Map/array of {id, location, radiusKm} entries and one
 * reference point, returns the Set of ids that are serviceable. Used to
 * filter unique sellers once rather than recomputing per product (see
 * product.controller.js), the same "identify unique sellers, then filter"
 * shape used for delivery-partner dispatch.
 */
export const serviceableIds = (entries, referenceLocation) => {
  const ids = new Set();
  for (const e of entries) {
    if (isWithinRadius(e.location, referenceLocation, e.radiusKm)) ids.add(String(e.id));
  }
  return ids;
};
