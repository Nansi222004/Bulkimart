import RadiusSetting from '../models/RadiusSetting.js';
import {
  SAME_DAY_MAX_RADIUS_KM,
  SELLER_SERVICE_MAX_RADIUS_KM,
  DELIVERY_PARTNER_MAX_RADIUS_KM,
} from '../constants/enums.js';

/**
 * The three radius ceilings — admin-configurable, cached the same way
 * services/deliveryCharge.service.js caches the customer delivery charge.
 *
 * sameDay.service.js reads this on every Same-Day eligibility check, which
 * is a hot path — no DB query per call. Loaded once at boot and refreshed
 * the instant an admin saves a new value; the TTL below is only a safety
 * net for a second server process that saved a change this one never
 * heard about.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

/** What the platform used before this was configurable — the env-var floor under everything. */
const DEFAULTS = () => ({
  sameDayMaxRadiusKm: SAME_DAY_MAX_RADIUS_KM,
  sellerServiceMaxRadiusKm: SELLER_SERVICE_MAX_RADIUS_KM,
  deliveryPartnerMaxRadiusKm: DELIVERY_PARTNER_MAX_RADIUS_KM,
});

export const loadRadiusSetting = async () => {
  const row = await RadiusSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? {
        _id: row._id,
        sameDayMaxRadiusKm: row.sameDayMaxRadiusKm,
        sellerServiceMaxRadiusKm: row.sellerServiceMaxRadiusKm,
        deliveryPartnerMaxRadiusKm: row.deliveryPartnerMaxRadiusKm,
      }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

/** Forget the cache so the next read picks up a fresh DB row. */
export const invalidateRadiusSetting = () => { cache = null; cachedAt = 0; };

/** Synchronous — never blocks a hot-path eligibility check on a stale cache. */
export const getRadiusSetting = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};
