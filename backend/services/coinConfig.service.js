import CoinConfig from '../models/CoinConfig.js';
import { COIN_DEFAULTS } from '../constants/enums.js';

/**
 * Cached the same way services/deliveryCharge.service.js caches
 * DeliveryChargeSetting — coin math (earning/redemption) runs on hot cart
 * and checkout paths, so this must never be a DB read per call.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const DEFAULTS = () => ({
  earnPercentage: COIN_DEFAULTS.EARN_PERCENTAGE,
  coinValue: COIN_DEFAULTS.COIN_VALUE,
  minimumRedemptionOrderValue: COIN_DEFAULTS.MINIMUM_REDEMPTION_ORDER_VALUE,
  maximumRedemptionPercentage: COIN_DEFAULTS.MAXIMUM_REDEMPTION_PERCENTAGE,
  isActive: true,
});

export const loadCoinConfig = async () => {
  const row = await CoinConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? {
        _id: row._id,
        earnPercentage: row.earnPercentage,
        coinValue: row.coinValue,
        minimumRedemptionOrderValue: row.minimumRedemptionOrderValue,
        maximumRedemptionPercentage: row.maximumRedemptionPercentage,
        isActive: row.isActive,
      }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

/** Forget the cache so the next read picks up a just-saved admin change. */
export const invalidateCoinConfig = () => { cache = null; cachedAt = 0; };

/** Synchronous — never blocks a price/coin computation on a stale cache. */
export const getCoinConfig = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};
