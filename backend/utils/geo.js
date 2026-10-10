/**
 * Location parsing shared by anything that stores a place.
 *
 * Two ways a rider gives us their base location, and they carry different
 * trust:
 *   - "gps"    — the browser's Geolocation API handed us coordinates. Precise,
 *                but the street address is whatever the rider typed.
 *   - "manual" — the rider typed the address. We may have no coordinates at
 *                all, so proximity matching has to fall back to the pincode.
 *
 * Coordinates are stored twice on purpose: as plain `lat`/`lng` because that is
 * what every screen renders, and as a GeoJSON point because that is the only
 * shape MongoDB's 2dsphere index will accept for "riders near this store".
 */

const LAT = [-90, 90];
const LNG = [-180, 180];

const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Validate and normalise a location payload.
 * Returns { ok: true, location } or { ok: false, message }.
 *
 * @param {object} input   raw body fields
 * @param {object} opts
 * @param {boolean} opts.requireCoords  reject the payload unless lat/lng are present
 */
export const parseLocation = (input = {}, { requireCoords = false } = {}) => {
  const {
    lat, lng, address, landmark, city, state, pincode,
    source, accuracy,
  } = input;

  const latN = num(lat);
  const lngN = num(lng);

  if (Number.isNaN(latN) || Number.isNaN(lngN)) {
    return { ok: false, message: 'Latitude and longitude must be numbers' };
  }

  const hasCoords = latN !== undefined && lngN !== undefined;

  // One without the other is always a bug on the caller's side — storing it
  // would put a point on the equator or the prime meridian.
  if ((latN === undefined) !== (lngN === undefined)) {
    return { ok: false, message: 'Latitude and longitude must be sent together' };
  }
  if (requireCoords && !hasCoords) {
    return { ok: false, message: 'Location coordinates are required' };
  }
  if (hasCoords) {
    if (latN < LAT[0] || latN > LAT[1]) {
      return { ok: false, message: `Latitude must be between ${LAT[0]} and ${LAT[1]}` };
    }
    if (lngN < LNG[0] || lngN > LNG[1]) {
      return { ok: false, message: `Longitude must be between ${LNG[0]} and ${LNG[1]}` };
    }
    // 0,0 is in the Gulf of Guinea. It is never a real Indian address, and it
    // is exactly what an uninitialised form sends.
    if (latN === 0 && lngN === 0) {
      return { ok: false, message: 'Those coordinates are not valid — please try again' };
    }
  }

  const pin = pincode === undefined || pincode === null ? undefined : String(pincode).trim();
  if (pin !== undefined && pin !== '' && !/^\d{6}$/.test(pin)) {
    return { ok: false, message: 'Pincode must be 6 digits' };
  }

  const src = source === 'gps' ? 'gps' : 'manual';
  const acc = num(accuracy);

  const location = {
    address:  address  ? String(address).trim()  : undefined,
    landmark: landmark ? String(landmark).trim() : undefined,
    city:     city     ? String(city).trim()     : undefined,
    state:    state    ? String(state).trim()    : undefined,
    pincode:  pin || undefined,
    source:   src,
    updatedAt: new Date(),
  };

  if (hasCoords) {
    location.lat = latN;
    location.lng = lngN;
    // GeoJSON is [longitude, latitude] — the reverse of how humans say it.
    location.point = { type: 'Point', coordinates: [lngN, latN] };
    // Only meaningful for a GPS fix; a typed address has no accuracy radius.
    if (src === 'gps' && acc !== undefined && !Number.isNaN(acc) && acc >= 0) {
      location.accuracy = acc;
    }
  }

  return { ok: true, location };
};

/** Is there enough here to put the rider on a map? */
export const hasUsableLocation = (loc) =>
  Boolean(loc && ((loc.lat !== undefined && loc.lng !== undefined) || loc.pincode));

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Straight-line, not road distance — a rider on a bike will always travel
 * further than this. It is honest enough to rank nearby riders and to show an
 * approximate figure, and it costs nothing, whereas asking Google for a real
 * driving distance is a billed request per pair.
 *
 * Returns undefined rather than 0 when either point is missing, so a caller
 * cannot mistake "unknown" for "right here".
 */
export const distanceKm = (a, b) => {
  if (a?.lat === undefined || a?.lng === undefined) return undefined;
  if (b?.lat === undefined || b?.lng === undefined) return undefined;

  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return Number((2 * R * Math.asin(Math.sqrt(h))).toFixed(2));
};

/** A rough ETA from a straight-line distance, at typical city two-wheeler pace. */
export const etaMinutes = (km, kmph = 18) =>
  km === undefined ? undefined : Math.max(2, Math.round((km / kmph) * 60));
