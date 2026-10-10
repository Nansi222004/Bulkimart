import DeliveryChargeSetting from '../models/DeliveryChargeSetting.js';
import { DEFAULT_DELIVERY_CHARGE } from '../constants/enums.js';

/**
 * What a customer is charged for delivery — admin-configurable, cached the
 * same way services/riderPay.service.js caches rider pay rates.
 *
 * A flat fee, always charged (the only waivers are an empty cart and a
 * free-shipping coupon, both applied in pricing.service.js) — there is no
 * spend threshold that waives it.
 *
 * priceOrder() (pricing.service.js) reads this on every cart/checkout price
 * computation, which is a very hot path — no DB query per call. Loaded once
 * at boot and refreshed the instant an admin saves a new value; the TTL
 * below is only a safety net for a second server process that saved a
 * change this one never heard about.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

/** What the platform charged before this was configurable — the floor under everything. */
const DEFAULTS = () => ({
  flatFee: DEFAULT_DELIVERY_CHARGE,
});

export const loadDeliveryChargeSetting = async () => {
  const row = await DeliveryChargeSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? { _id: row._id, flatFee: row.flatFee }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

/** Forget the cache so the next price computation reads fresh. */
export const invalidateDeliveryChargeSetting = () => { cache = null; cachedAt = 0; };

/** Synchronous — never blocks a price computation on a stale cache. */
export const getDeliveryChargeSetting = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};
