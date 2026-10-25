/**
 * Reverse geocoding — coordinates to a street address.
 *
 * This exists so a rider who taps "use my current location" does not then have
 * to type the address they are standing at. The GPS gives us a point; Google
 * turns that point into the fields the form needs.
 *
 * Every call costs money, so two things are deliberate:
 *   - it runs server-side, where the key cannot be lifted out of the page and
 *     the call rate is ours to control
 *   - identical lookups are cached, because a rider tapping the button twice
 *     is one address, not two billable requests
 */

const GOOGLE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Is reverse geocoding usable at all? Callers should check before promising it. */
export const isGeocodingConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Coordinates rounded to 4 decimals — roughly 11 m, which is finer than a
 * consumer GPS fix is honest about anyway. Two riders in the same building
 * therefore share one lookup instead of paying for two.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // addresses do not move
const CACHE_MAX = 500;
const cache = new Map();

const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency so the eviction below drops genuinely cold entries.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key, value) => {
  if (cache.size >= CACHE_MAX) {
    // Map preserves insertion order, so the first key is the least recently used.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, at: Date.now() });
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Pull the first component carrying any of these types. */
const pick = (components, ...types) => {
  for (const type of types) {
    const found = components.find((c) => c.types.includes(type));
    if (found) return found.long_name;
  }
  return undefined;
};

/**
 * Turn Google's component list into the fields the form shows.
 *
 * `formatted_address` is not used for the street line: it repeats the city,
 * state and pincode that have their own inputs, so a rider would see the same
 * text three times over. The line is rebuilt from the components instead.
 */
const toAddressFields = (result) => {
  const c = result.address_components || [];

  const line = [
    pick(c, 'premise', 'street_number'),
    pick(c, 'route'),
    pick(c, 'neighborhood', 'sublocality_level_1', 'sublocality'),
  ].filter(Boolean);

  const city = pick(c, 'locality', 'administrative_area_level_3', 'administrative_area_level_2');
  const state = pick(c, 'administrative_area_level_1');
  const pincode = pick(c, 'postal_code');

  return {
    // Fall back to the formatted address only when the components gave nothing
    // usable — better a repetitive line than an empty one.
    address: line.length ? line.join(', ') : (result.formatted_address || undefined),
    city,
    state,
    // Guard the shape here too: an Indian pincode is 6 digits, and anything
    // else would be rejected by the save endpoint a moment later.
    pincode: pincode && /^\d{6}$/.test(pincode) ? pincode : undefined,
    formatted: result.formatted_address,
  };
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Reverse geocode a point.
 *
 * @returns {Promise<{ok: true, address: object, cached: boolean} | {ok: false, message: string}>}
 */
export const reverseGeocode = async (lat, lng) => {
  if (!isGeocodingConfigured()) {
    return { ok: false, message: 'Address lookup is not configured' };
  }

  const key = cacheKey(lat, lng);
  const cached = cacheGet(key);
  if (cached) return { ok: true, address: cached, cached: true };

  const url = `${GOOGLE_ENDPOINT}?latlng=${lat},${lng}`
    + `&key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY)}`
    + '&result_type=street_address|premise|subpremise|route|sublocality|locality'
    + '&language=en';

  let payload;
  try {
    // A rider is waiting on this with the button spinning — fail fast rather
    // than hold the form hostage to a slow upstream.
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    payload = await res.json();
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      message: timedOut
        ? 'Address lookup timed out. Please enter your address manually.'
        : 'Could not reach the address service. Please enter your address manually.',
    };
  }

  if (payload.status === 'ZERO_RESULTS' || !payload.results?.length) {
    return { ok: false, message: 'No address found at that location. Please enter it manually.' };
  }
  if (payload.status !== 'OK') {
    // status carries billing/key/quota faults. Those are our problem to fix,
    // not something to explain to a rider, so log it and stay vague to them.
    console.error('[geocode] google returned', payload.status, payload.error_message || '');
    return { ok: false, message: 'Address lookup is unavailable. Please enter your address manually.' };
  }

  const address = toAddressFields(payload.results[0]);

  // A result with no pincode makes the form fail validation later; prefer a
  // later result that has one over the most precise one that does not.
  if (!address.pincode) {
    const withPin = payload.results.find((r) =>
      r.address_components?.some((c) => c.types.includes('postal_code'))
    );
    if (withPin) {
      const better = toAddressFields(withPin);
      address.pincode = better.pincode;
      address.city = address.city || better.city;
      address.state = address.state || better.state;
    }
  }

  cacheSet(key, address);
  return { ok: true, address, cached: false };
};

// ---------------------------------------------------------------------------
// Forward: address text to coordinates
// ---------------------------------------------------------------------------

/**
 * Turn a written address into coordinates.
 *
 * The opposite direction to reverseGeocode, and needed for a different reason:
 * an address that was typed or saved before the app captured a GPS pin has no
 * coordinates at all. Without them an order has no destination — no distance,
 * no rider pay, and no marker on the customer's own tracking map.
 *
 * Google does not fail on nonsense. Ask it for pincode "999999" and it returns
 * status OK with the geographic centre of India, so a country-level match is
 * rejected here rather than written down as somebody's doorstep.
 *
 * @param {string[]} parts  address fragments, most specific first
 * @returns {Promise<{ok: true, lat, lng, precision, matched} | {ok: false, message}>}
 */
export const forwardGeocode = async (parts) => {
  if (!isGeocodingConfigured()) {
    return { ok: false, message: 'Address lookup is not configured' };
  }

  const query = (parts || []).filter(Boolean).join(', ').trim();
  if (!query) return { ok: false, message: 'No address to look up' };

  const cached = cacheGet(`fwd:${query.toLowerCase()}`);
  if (cached) return { ...cached, cached: true };

  const url = `${GOOGLE_ENDPOINT}?address=${encodeURIComponent(query)}`
    + `&key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY)}`
    + '&region=in&language=en';

  let body;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    body = await res.json();
  } catch {
    return { ok: false, message: 'Could not reach the address service' };
  }

  if (body.status !== 'OK' || !body.results?.length) {
    return { ok: false, message: `No location found for "${query}"` };
  }

  const best = body.results[0];
  const { lat, lng } = best.geometry?.location || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { ok: false, message: 'The address service returned no coordinates' };
  }

  // A usable match names somewhere. Country and nothing else is a miss dressed
  // up as a hit, and writing it down puts a customer in the middle of India.
  const types = new Set((best.address_components || []).flatMap((c) => c.types));
  const namesAPlace = ['postal_code', 'locality', 'sublocality',
    'administrative_area_level_2', 'administrative_area_level_3', 'route', 'premise']
    .some((t) => types.has(t));
  if (!namesAPlace) {
    return { ok: false, message: `"${query}" is too vague to locate` };
  }

  const result = {
    ok: true,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    // ROOFTOP is a building; APPROXIMATE usually means a locality centre, which
    // can be most of a kilometre from the actual door.
    precision: best.geometry?.location_type || 'UNKNOWN',
    matched: best.formatted_address,
    // Keep the postal code from this exact result with its coordinates. A
    // second reverse lookup can identify a neighbouring street or business.
    pincode: toAddressFields(best).pincode,
  };

  cacheSet(`fwd:${query.toLowerCase()}`, result);
  return result;
};

// ---------------------------------------------------------------------------
// POI: which building is this?
// ---------------------------------------------------------------------------

/**
 * Nearby place detection, and why it exists.
 *
 * The Geocoding API has no POI database. It maps coordinates onto *postal*
 * addressing — plot, street, locality — so standing inside Corporate House it
 * answers "Chhoti Gwaltoli", and no amount of GPS accuracy changes that. The
 * building's name lives in Places, which is a different index entirely.
 *
 * Places API (New) specifically. The legacy Nearby Search was tried against the
 * same point and ranked a road above the building; the New API returns the
 * building because it ranks on prominence rather than proximity alone.
 */

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

/**
 * Place types worth showing somebody as "where you are".
 *
 * Tiered rather than a flat allow-list: a mall and a post box are both
 * establishments, but only one is how a person describes their location.
 */
const TYPE_SCORE = {
  corporate_office: 10, shopping_mall: 10, hospital: 10, university: 10,
  airport: 10, train_station: 10, stadium: 10, premise: 9, subpremise: 9,
  lodging: 8, hotel: 8, school: 8, bank: 7, supermarket: 7, department_store: 7,
  store: 6, restaurant: 6, cafe: 6, pharmacy: 6, gym: 6,
  // Generic, but still a building.
  establishment: 3, point_of_interest: 3,
};

/**
 * Types that must never stand in for a building.
 *
 * A road or an administrative area is precisely the answer reverse geocoding
 * already gives, so returning one here would add cost and change nothing.
 */
const TYPE_REJECT = new Set([
  'route', 'street_address', 'locality', 'sublocality', 'political',
  'postal_code', 'plus_code', 'administrative_area_level_1',
  'administrative_area_level_2', 'administrative_area_level_3', 'country',
  'bus_stop', 'transit_station', 'parking',
]);

/** Metres between two points. */
const metresBetween = (a, b) => {
  const R = 6371000, t = (x) => (x * Math.PI) / 180;
  const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * How wide to look.
 *
 * Tied to the GPS reading rather than fixed. A 40 m circle around an 8 m fix is
 * a building; the same circle around a 90 m fix is a guess about which of
 * several buildings you are standing in.
 *
 * Deliberately capped. Widening the search to compensate for a poor fix is how
 * you confidently name the shop across the road — the answer gets less true as
 * the radius grows, not more.
 */
const searchRadius = (accuracy) => {
  if (!Number.isFinite(accuracy)) return 40;
  return Math.min(Math.max(accuracy * 1.5, 30), 75);
};

/** Beyond this, the fix is too vague for any POI claim to mean anything. */
const ACCURACY_CEILING_M = 100;

/**
 * Find the building at these coordinates.
 * @returns {Promise<{ok:true, place:object}|{ok:false, reason:string}>}
 */
export const findNearbyPlace = async (lat, lng, accuracy) => {
  if (!isGeocodingConfigured()) return { ok: false, reason: 'not configured' };

  // A fix this loose cannot single out a building. Reverse geocoding's locality
  // answer is the honest one here, and it costs less.
  if (Number.isFinite(accuracy) && accuracy > ACCURACY_CEILING_M) {
    return { ok: false, reason: `gps accuracy ${Math.round(accuracy)}m is too poor for POI` };
  }

  const radius = searchRadius(accuracy);
  const key = `poi:${lat.toFixed(4)},${lng.toFixed(4)}:${Math.round(radius)}`;

  const cached = cacheGet(key);
  if (cached !== undefined) {
    // `null` is a cached absence — remembered so we do not pay to be told
    // "nothing here" twice for the same doorstep.
    return cached === null
      ? { ok: false, reason: 'no relevant place nearby (cached)' }
      : { ok: true, place: cached, cached: true };
  }

  let body;
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        // Billed by the fields requested, so ask only for what is read below.
        'X-Goog-FieldMask': 'places.displayName,places.types,places.location,places.formattedAddress',
      },
      body: JSON.stringify({
        maxResultCount: 10,
        /**
         * Prominence, not proximity.
         *
         * DISTANCE was tried first and got this exactly wrong: an office
         * building is full of tenant firms, so the ten nearest results were all
         * accountants and travel agents and the building itself came back
         * seventh — outside the candidate set once it was trimmed. Ranking by
         * prominence puts the container first, and the scoring below still
         * re-orders what comes back rather than trusting Google's first row.
         */
        rankPreference: 'POPULARITY',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
      signal: AbortSignal.timeout(6000),
    });
    body = await res.json();

    if (!res.ok) {
      // Quota, key restriction, API not enabled — our problem, not the
      // caller's, and all recoverable by falling through to reverse geocoding.
      console.warn('[POI] Places API refused:', body?.error?.message || res.status);
      return { ok: false, reason: 'places api error' };
    }
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { ok: false, reason: timedOut ? 'places api timed out' : 'places api unreachable' };
  }

  const here = { lat, lng };

  /**
   * Which of these is the building the others sit inside?
   *
   * Type alone cannot answer it, because Google's own tagging is uneven: at C21
   * Mall it labels the anchor department store `shopping_mall` too, so the
   * store and the mall tie on type and the store wins on distance. The tenants
   * give the answer away, though - six of the ten results carry "C21 Mall" in
   * their name or postal address. A place the neighbours keep citing as part of
   * their own address is the container, whatever its type says.
   *
   * Built from the raw response rather than the surviving candidates, since a
   * rejected result still counts as a witness.
   */
  const haystack = (body.places || [])
    .map((p) => `${p.displayName?.text || ''} ${p.formattedAddress || ''}`.toLowerCase());

  const mentions = (name) => {
    const needle = name.toLowerCase();
    // Very short names ("21", "MR") match half the street by accident.
    if (needle.length < 5) return 0;
    return haystack.filter((h) => h.includes(needle)).length;
  };

  const candidates = (body.places || []).map((p) => {
    const name = p.displayName?.text?.trim();
    const types = p.types || [];
    if (!name) return null;

    if (types.some((t) => TYPE_REJECT.has(t))) return null;

    const typeScore = Math.max(0, ...types.map((t) => TYPE_SCORE[t] || 0));
    if (typeScore === 0) return null;

    // A name that is only a house number is not a place name.
    if (!/[a-zA-Z]{3}/.test(name)) return null;

    const distance = p.location
      ? metresBetween(here, { lat: p.location.latitude, lng: p.location.longitude })
      : radius;

    /**
     * Type leads; distance moderates.
     *
     * The first cut had this backwards - distance dominated, so inside an
     * office block the nearest tenant firm won and the building itself lost.
     * What a person means by "where I am" is the container: the mall, the
     * hospital, the office block, not whichever consultancy happens to be nine
     * metres away. Distance still counts, but only enough to stop a prominent
     * landmark across the road beating the building you are standing in.
     */
    const proximity = Math.max(0, 1 - distance / radius);
    // Its own entry is always in the haystack, so two witnesses means three hits.
    const witnesses = mentions(name);
    const containerBonus = witnesses >= 3 ? 8 : 0;
    return {
      name,
      types,
      distance: Math.round(distance),
      typeScore,
      score: typeScore * 2 + proximity * 5 + containerBonus,
      formattedAddress: p.formattedAddress,
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    cacheSet(key, null);
    return { ok: false, reason: 'no relevant place nearby' };
  }

  const best = candidates[0];

  /**
   * Confidence measures the POI's distance against how sure we are of our own
   * position, not distance alone. Twelve metres from an 8 m fix is the building
   * you are in; forty-five metres from a 50 m fix is a coin toss.
   */
  const margin = Number.isFinite(accuracy) ? Math.max(accuracy, 20) : 30;
  const confidence = best.distance <= margin ? 'high'
    : best.distance <= margin * 1.6 ? 'medium'
    : 'low';

  if (confidence === 'low') {
    cacheSet(key, null);
    return {
      ok: false,
      reason: `nearest place is ${best.distance}m from a ${Math.round(accuracy || 0)}m fix`,
    };
  }

  const place = { ...best, confidence };
  cacheSet(key, place);
  return { ok: true, place };
};

// ---------------------------------------------------------------------------
// The one resolver every role goes through
// ---------------------------------------------------------------------------

/**
 * Coordinates to something a person recognises.
 *
 * POI first, reverse geocoding second — but reverse geocoding still runs either
 * way, because the city, state and pincode it returns are what the rest of the
 * app stores, filters and delivers on. The POI replaces only the display line.
 *
 * Coordinates are never replaced by any of this. They remain the source of
 * truth for distance, radius queries, routing and tracking.
 */
export const resolveLocation = async (lat, lng, accuracy) => {
  // Both are wanted regardless, so they run together rather than in sequence.
  const [poi, geo] = await Promise.all([
    findNearbyPlace(lat, lng, accuracy),
    reverseGeocode(lat, lng),
  ]);

  // Reverse geocoding failing is the pre-existing failure mode, unchanged.
  if (!geo.ok) {
    if (poi.ok) {
      // A name with no address components still beats nothing.
      return {
        ok: true,
        address: {
          address: poi.place.name,
          placeName: poi.place.name,
          source: 'poi',
          confidence: poi.place.confidence,
        },
      };
    }
    return geo;
  }

  const base = geo.address;

  if (!poi.ok) {
    return {
      ok: true,
      address: {
        ...base,
        placeName: null,
        source: 'reverse_geocode',
        confidence: null,
        poiSkippedBecause: poi.reason,
      },
    };
  }

  return {
    ok: true,
    address: {
      ...base,
      // The display line becomes the building. Every existing consumer reads
      // `address`, so all of them get the improvement without being touched.
      address: poi.place.name,
      placeName: poi.place.name,
      placeDistanceM: poi.place.distance,
      source: 'poi',
      confidence: poi.place.confidence,
      // `formatted` still carries the full postal address, untouched.
    },
  };
};
