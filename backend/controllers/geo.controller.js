import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { parseLocation } from '../utils/geo.js';
import { resolveLocation, forwardGeocode, isGeocodingConfigured } from '../services/geocode.service.js';

// @desc    Turn GPS coordinates into address fields a form can fill in
// @route   GET /api/geo/reverse?lat=&lng=
// @access  Private (any signed-in user)
export const lookupAddress = asyncHandler(async (req, res) => {
  if (!isGeocodingConfigured()) {
    throw httpError(503, 'Address lookup is unavailable. Please enter your address manually.');
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  // Validate before spending a paid API call on nonsense.
  const parsed = parseLocation({ lat, lng }, { requireCoords: true });
  if (!parsed.ok) throw httpError(400, parsed.message);

  /**
   * The GPS accuracy the device reported, in metres.
   *
   * Optional, and the resolver copes without it — but supplying it is what
   * lets a nearby building be trusted or dismissed. A place 30 m away means
   * something very different from an 8 m fix than from a 90 m one.
   */
  const accuracy = Number(req.query.accuracy);

  /**
   * Same route, same response shape, better answer.
   *
   * `resolveLocation` asks Places for the building first and falls back to the
   * reverse geocoding this endpoint has always used. Callers that only read
   * `address`, `city`, `state` and `pincode` — which is all of them today —
   * need no change: `address` simply becomes the building name when one is
   * confidently identified, and the postal line stays in `formatted`.
   */
  const result = await resolveLocation(lat, lng, Number.isFinite(accuracy) ? accuracy : undefined);

  // A failed lookup is not a failed form — the address can always be typed.
  if (!result.ok) throw httpError(502, result.message);

  return ok(res, result.address, 'Address found');
});

// @desc    Turn typed address text into a point
// @route   GET /api/geo/forward?q=
// @access  Private (any signed-in user)
export const lookupPlace = asyncHandler(async (req, res) => {
  if (!isGeocodingConfigured()) {
    throw httpError(503, 'Address lookup is unavailable right now.');
  }

  const q = String(req.query.q || '').trim();
  if (q.length < 3) throw httpError(400, 'Type at least a locality or a pincode');

  const hit = await forwardGeocode([q, 'India']);

  /**
   * A miss is a 404, not an empty success.
   *
   * The caller is about to save this as somewhere a rider will be sent, so
   * "we could not find it" has to be impossible to mistake for "found it".
   */
  if (!hit.ok) throw httpError(404, hit.message);

  return ok(res, {
    lat: hit.lat,
    lng: hit.lng,
    // ROOFTOP is a building; anything else is a neighbourhood at best, and the
    // caller may want to say so before a rider is sent there.
    precision: hit.precision,
    matched: hit.matched,
  }, 'Location found');
});
