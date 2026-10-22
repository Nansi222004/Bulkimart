import DeliveryRate from '../models/DeliveryRate.js';
import { PAYOUT_MODE, CHANNEL, DELIVERY_MODE } from '../constants/enums.js';

/**
 * What a rider earns for a delivery.
 *
 * One function, because there were two rules and they disagreed. The offer
 * screen promised `80 + km × 12` while the payout on completion was
 * `km × 12 + 20` — so a rider shown ₹97 for a 1.4 km trip was actually paid
 * ₹37, and only found out afterwards. A rider decides whether to accept on that
 * number; it has to be the number they get.
 *
 * Rates are now set per delivery mode by an admin, because a Quick trip and a
 * Same-Day trip are not the same job. They are still read through here, so the
 * offer and the settlement can never drift apart again.
 *
 * This function is deliberately SYNCHRONOUS. It runs on every offer poll and
 * inside the batched Same-Day eligibility check; a database read per call would
 * put a query on the hottest path in the rider app. Rates are held in a
 * module-level cache instead, refreshed when an admin saves and on a short TTL.
 */

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/**
 * What the platform paid before rates were configurable.
 *
 * Kept as the floor under everything: an empty collection, a database that has
 * not answered yet, or a mode nobody has configured all land here rather than
 * paying a rider zero. Same-Day's defaults are higher than Quick's because the
 * job is longer and carries a promise.
 */
const ENV_DEFAULTS = () => ({
  [PAYOUT_MODE.QUICK]: {
    base: num('RIDER_BASE_PAY', 20),
    perKm: num('RIDER_PER_KM_PAY', 10),
    minPayout: 0,
    maxPayout: undefined,
  },
  [PAYOUT_MODE.SAME_DAY]: {
    base: num('RIDER_SAMEDAY_BASE_PAY', 30),
    perKm: num('RIDER_SAMEDAY_PER_KM_PAY', 15),
    minPayout: 0,
    maxPayout: undefined,
  },
});

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

/**
 * Read the live rates into the cache.
 *
 * Called once at boot and again whenever an admin saves. The TTL is a safety
 * net for a second process saving a rate this one never heard about, not the
 * primary refresh — an admin who changes a rate expects the next offer to carry
 * it, not the one after a minute.
 */
export const loadRates = async () => {
  const rows = await DeliveryRate.find({ isActive: true, $or: [{ effectiveFrom: { $lte: new Date() } }, { effectiveFrom: { $exists: false } }] }).sort({ createdAt: -1 }).lean();

  const next = ENV_DEFAULTS();
  for (const row of rows) {
    // Newest active row per mode wins; older actives are historical noise.
    if (next[row.mode]?._id) continue;
    next[row.mode] = {
      _id: row._id,
      financeVersion: row.financeVersion,
      base: row.base,
      perKm: row.perKm,
      minPayout: row.minPayout || 0,
      maxPayout: row.maxPayout,
    };
  }

  cache = next;
  cachedAt = Date.now();
  return cache;
};

/** Forget the cache so the next payout reads fresh rates. */
export const invalidateRates = () => { cache = null; cachedAt = 0; };

const activeRates = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  // Never block a payout on a stale cache: serve what we have (or the env
  // defaults) and let the next loadRates() catch up.
  return cache || ENV_DEFAULTS();
};

/**
 * Which rate card applies to an order.
 *
 * The ONE place the customer's delivery mode is translated into the rider's job
 * type. A Quick order has no `delivery.mode` at all — it has one way of
 * arriving — so the absence of a mode is not missing data, it is a Quick trip.
 *
 * @param {object} order
 * @returns {'quick'|'same_day'}
 */
export const payoutModeOf = (order) => (
  order?.delivery?.mode === DELIVERY_MODE.SAME_DAY || order?.type === CHANNEL.ECOM
    ? PAYOUT_MODE.SAME_DAY
    : PAYOUT_MODE.QUICK
);

/**
 * @param {number|undefined} distanceKm  shop → customer, the leg being paid for
 * @param {object}  [opts]
 * @param {string}  [opts.mode]   'quick' | 'same_day' — defaults to Quick
 * @param {number}  [opts.tip]
 * @param {object}  [opts.rates]  a frozen snapshot; wins over the live rates, so
 *                                a delivery already accepted settles at the rate
 *                                it was offered under
 */
export const riderPayout = (distanceKm, { mode = PAYOUT_MODE.QUICK, tip = 0, rates } = {}) => {
  const card = rates || activeRates()[mode] || activeRates()[PAYOUT_MODE.QUICK];

  const base = Number(card.base) || 0;
  const perKm = Number(card.perKm) || 0;

  const km = Number.isFinite(distanceKm) ? distanceKm : 0;

  /**
   * No delivery bills for less than 1 km of distance pay.
   *
   * A same-building drop-off, a sub-1km hop, or a trip whose distance
   * couldn't be measured at all all land at km ≈ 0 here — and with `base`
   * commonly configured as 0 (the admin screen only exposes a per-km rate),
   * that used to pay the rider nothing for a real trip they actually made.
   * Anything 1 km or longer is still billed at its real, unrounded distance;
   * this floor only ever raises a very short trip up to one km's worth.
   */
  const billableKm = Math.max(km, 1);
  const distancePay = Math.round(billableKm * perKm);
  const tipAmount = Math.max(0, Math.round(tip));

  let total = base + distancePay;
  if (card.minPayout) total = Math.max(total, Number(card.minPayout));
  if (card.maxPayout !== undefined && card.maxPayout !== null) total = Math.min(total, Number(card.maxPayout));

  return {
    mode,
    base,
    perKm,
    distanceKm: km,
    distancePay,
    tip: tipAmount,
    // The tip is the customer's money and is never capped by a platform rate.
    total: total + tipAmount,
    rateId: card._id || card.rateId,
    requiresIndependentCustomerTariff: card.financeVersion === 2,
  };
};

/**
 * The rate card to freeze onto a delivery when a rider accepts it.
 *
 * Stored so that settlement pays what the offer promised. Without this, an admin
 * raising the per-kilometre rate while a rider was mid-trip would pay them a
 * different figure than the one they accepted — the same class of surprise the
 * single-function rule was written to prevent, arriving from a new direction.
 */
export const rateSnapshotFor = (mode) => {
  const card = activeRates()[mode] || activeRates()[PAYOUT_MODE.QUICK];
  return {
    mode,
    base: card.base,
    perKm: card.perKm,
    minPayout: card.minPayout || 0,
    maxPayout: card.maxPayout,
    rateId: card._id,
    financeVersion: card.financeVersion,
  };
};
