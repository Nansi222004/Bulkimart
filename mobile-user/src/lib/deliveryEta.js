/**
 * Delivery time estimates for Quick (rider-delivered) orders.
 *
 * One place for the arithmetic so checkout, the order-placed screen and the live
 * tracking map can never disagree about how long the same trip takes.
 *
 * Distances are straight lines (the same haversine as backend utils/geo.js) and
 * the riding speed is the backend's 18 km/h. Roads are never straight, so the
 * straight line is stretched by ROAD_FACTOR; the customer is better served by a
 * time we beat than one we miss.
 */

export const RIDE_KMPH = 18;            // backend utils/geo.js etaMinutes
export const ROAD_FACTOR = 1.3;         // typical city road distance ÷ straight-line distance
export const PREP_MINUTES = 10;         // store accepts and packs a Quick order
export const HANDOVER_MINUTES = 3;      // rider collects the parcel at the store

export const hasPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** { lat, lng } from a record whose coordinates may be strings, null or missing; null unless both are real numbers. */
export function toPoint(record) {
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const p = { lat: num(record?.lat), lng: num(record?.lng) };
  return hasPoint(p) && !(p.lat === 0 && p.lng === 0) ? p : null;
}

export function distanceKm(a, b) {
  if (!hasPoint(a) || !hasPoint(b)) return null;
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Riding time between two points, at least one minute; null when either point is unknown. */
export function rideMinutes(a, b) {
  const km = distanceKm(a, b);
  return km === null ? null : Math.max(1, Math.round(((km * ROAD_FACTOR) / RIDE_KMPH) * 60));
}

/** Before a rider is involved: store packs it, then the ride from the store to the customer. */
export function quickEtaMinutes(store, home) {
  const ride = rideMinutes(store, home);
  return ride === null ? null : PREP_MINUTES + ride;
}

/**
 * Minutes until the rider reaches the customer, from where the rider is right now.
 * Heading to the store: ride to the store, collect, then ride to the customer.
 * Returns null when it cannot be worked out (no live position or missing coordinates).
 */
export function liveEtaMinutes({ rider, shop, home, stage }) {
  if (stage === 'arrived_at_customer' || stage === 'delivered') return null;
  const here = rider?.location;
  if (rider?.leg === 'to_customer') return rideMinutes(here, home);
  const toStore = stage === 'arrived_at_store' ? 0 : rideMinutes(here, shop);
  const toHome = rideMinutes(shop, home);
  return toStore === null || toHome === null ? null : toStore + HANDOVER_MINUTES + toHome;
}

/** Compass bearing in degrees (0 = north, clockwise) from a to b. */
export function bearingDeg(a, b) {
  if (!hasPoint(a) || !hasPoint(b)) return null;
  const rad = d => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** "~25 min", or "~1 hr 10 min" for longer trips. */
export function formatEta(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `~${h} hr${m ? ` ${m} min` : ''}`;
}

/** The rider's vehicle (DeliveryPartner.vehicleType) as a map glyph. */
export const VEHICLE_GLYPH = { bicycle: '🚲', bike: '🛵', auto: '🛺', car: '🚗' };
export const vehicleGlyph = type => VEHICLE_GLYPH[type] || '🛵';
