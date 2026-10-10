import DeliveryPartner from '../models/DeliveryPartner.js';
import { distanceKm, etaMinutes } from '../utils/geo.js';
import { httpError } from '../utils/response.js';
import { riderPayout } from './riderPay.service.js';
import { PAYOUT_MODE } from '../constants/enums.js';
import { maxConcurrentDeliveries, openDeliveryCount } from './riderCapacity.service.js';
import {
  CHANNEL,
  VENDOR_STATUS,
  SAME_DAY_MAX_PROCESSING_MINUTES,
  SAME_DAY_SELLER_INCENTIVE,
  SAME_DAY_DELIVERY_FEE,
} from '../constants/enums.js';
import { getRadiusSetting } from './radiusSetting.service.js';

/**
 * Whether a particular customer can have a particular product today.
 *
 * The single place that answers that question. Four screens ask it — the product
 * grid, the product page, the cart and the checkout — and they must never
 * disagree, because a customer shown "Same-Day available" on a listing and
 * refused it at checkout has been lied to by the same system twice.
 *
 * This codebase has already paid for that lesson four times: claimable statuses
 * lived in three files and drifted, the payout formula lived in two and drifted,
 * the DNS fix was pasted into eight scripts, and address parsing into three. So
 * there is one function here, and callers get a verdict rather than the parts
 * needed to compute their own.
 *
 * Two things it deliberately does not do. It does not assign a rider — it only
 * establishes that one could be found, and the existing Quick broadcast does the
 * real work later. And it does not write anything; a verdict is a reading, and
 * the caller decides what to do with it.
 */

// ---------------------------------------------------------------------------
// Reading a seller's configuration off a request
// ---------------------------------------------------------------------------

/**
 * Both product forms post multipart, because they carry images — so a nested
 * object arrives as a JSON string, exactly as `dimensions` already does.
 * Anything unparseable is the caller's mistake, not a reason to save nothing.
 */
const asObject = (raw, label) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, `Could not read the ${label} settings`);
  }
};

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * The Same-Day settings that belong to a listing.
 *
 * Turning it off keeps whatever was configured, with `enabled: false`. Losing a
 * seller's cut-off and packing time because they paused Same-Day for a week
 * would mean retyping it all to switch back on, and the settings do no harm
 * sitting there — every reader tests `enabled`, not presence.
 *
 * Creating a product with it off stores nothing at all, so the products already
 * in the database and every new one that never opts in stay identical.
 */
export const parseProductSameDay = (raw, existing) => {
  const input = asObject(raw, 'same-day');
  if (input === undefined) return undefined;          // not part of this request

  if (!truthy(input.enabled)) {
    // Nothing to preserve on a brand new listing; nothing to invent either.
    return existing ? { ...existing.toObject?.() ?? existing, enabled: false } : undefined;
  }

  const minutes = Number(input.processingMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw httpError(400, 'Enter how many minutes you need to pack this item');
  }
  if (minutes > SAME_DAY_MAX_PROCESSING_MINUTES) {
    throw httpError(
      400,
      `Packing time cannot be more than ${SAME_DAY_MAX_PROCESSING_MINUTES} minutes for a same-day item`
    );
  }

  return { enabled: true, processingMinutes: Math.round(minutes) };
};

/**
 * The Same-Day settings that belong to the shop.
 *
 * The cut-off and the radius are required when switching on, because both
 * narrow a promise the customer is shown — a shop with neither is offering
 * same-day everywhere, forever, which is not a thing anyone means to offer.
 * Days are optional: an empty list reads as every day, which is what a shop that
 * never thought about it intends.
 *
 * The radius is checked here for a decent message and again by the schema, which
 * is the one that cannot be bypassed.
 */
export const parseSellerSameDay = (raw, existing) => {
  const input = asObject(raw, 'same-day');
  if (input === undefined) return undefined;

  if (!truthy(input.enabled)) {
    return existing ? { ...existing.toObject?.() ?? existing, enabled: false } : undefined;
  }

  const cutoffTime = String(input.cutoffTime || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) {
    throw httpError(400, 'Enter a cut-off time as HH:MM, for example 16:00');
  }

  const radiusKm = Number(input.radiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw httpError(400, 'Enter how far from your shop you will deliver same-day');
  }
  const sameDayMaxRadiusKm = getRadiusSetting().sameDayMaxRadiusKm;
  if (radiusKm > sameDayMaxRadiusKm) {
    throw httpError(400, `Same-day delivery cannot be offered beyond ${sameDayMaxRadiusKm} km`);
  }

  const days = input.availableDays === undefined || input.availableDays === null
    ? []
    : (Array.isArray(input.availableDays) ? input.availableDays : [input.availableDays]).map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw httpError(400, 'Pick the days you fulfil same-day orders');
  }

  return {
    enabled: true,
    cutoffTime,
    radiusKm: Number(radiusKm.toFixed(2)),
    availableDays: [...new Set(days)].sort(),
  };
};

/**
 * Why Same-Day was refused.
 *
 * A code as well as a sentence, because the two have different audiences: the
 * frontend switches on the code, a person reads the sentence. Keeping the
 * wording here rather than in four screens is what stops the same refusal being
 * explained three different ways.
 */
export const SAME_DAY_REASON = {
  OK: 'OK',
  PRODUCT_DISABLED: 'PRODUCT_DISABLED',
  SELLER_DISABLED: 'SELLER_DISABLED',
  SELLER_NOT_OPERATIONAL: 'SELLER_NOT_OPERATIONAL',
  NOT_ECOMMERCE: 'NOT_ECOMMERCE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  NO_SHOP_LOCATION: 'NO_SHOP_LOCATION',
  NO_CUSTOMER_LOCATION: 'NO_CUSTOMER_LOCATION',
  TOO_FAR: 'TOO_FAR',
  CLOSED_TODAY: 'CLOSED_TODAY',
  CUTOFF_PASSED: 'CUTOFF_PASSED',
  NOT_ENOUGH_TIME: 'NOT_ENOUGH_TIME',
  NO_RIDER: 'NO_RIDER',
  MULTIPLE_SELLERS: 'MULTIPLE_SELLERS',
};

const no = (code, reason, extra = {}) => ({ available: false, code, reason, ...extra });

/** "16:00" → minutes since midnight. Undefined for anything malformed. */
const minutesOfDay = (hhmm) => {
  if (typeof hhmm !== 'string') return undefined;
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** A point the distance helper can use, from either shape a shop stores. */
const shopPoint = (seller) => {
  const d = seller?.storeDetails;
  if (!d) return undefined;
  if (d.lat !== undefined && d.lng !== undefined) return { lat: d.lat, lng: d.lng };
  const c = d.point?.coordinates;
  return Array.isArray(c) && c.length === 2 ? { lat: c[1], lng: c[0] } : undefined;
};

/**
 * How far out we are willing to look for a rider, in metres.
 *
 * The Quick broadcast starts at PICKUP_RADIUS_METERS and widens twice, so this
 * matches the widest it will genuinely search. Anything further would claim a
 * rider the broadcast is never going to ring.
 */
const riderSearchMeters = () => (Number(process.env.PICKUP_RADIUS_METERS) || 5000) * 3;

/**
 * Is there a rider who could actually take this?
 *
 * Deliberately narrower than the Quick broadcast, which falls back to matching
 * pincode zones and then to any approved rider anywhere in the database. Those
 * fallbacks are a reasonable net for Quick. Here they would let us promise
 * Same-Day on the strength of a rider two cities away — so this asks the geo
 * question only, and takes "no" for an answer.
 */
const aRiderCouldTakeIt = async (shop, cache) => {
  /**
   * One answer per shop per request.
   *
   * A basket of three items from one shop asked this three times and got the
   * same answer three times — three geo queries and, when the concurrency limit
   * is on, three more count queries behind them. The rider situation cannot
   * change between two lines of the same basket, so the first answer stands for
   * the group.
   *
   * The cache is passed in rather than held here, so it lives exactly as long as
   * the request that made it. A module-level cache would go stale the moment a
   * rider went off duty and would keep promising them for as long as the process
   * ran.
   */
  const key = shop.lat + ',' + shop.lng;
  if (cache && cache.has(key)) return cache.get(key);

  const remember = (answer) => {
    if (cache) cache.set(key, answer);
    return answer;
  };

  let riders;
  try {
    riders = await DeliveryPartner.find({
      status: VENDOR_STATUS.APPROVED,
      isAvailable: true,
      'baseLocation.point': {
        $near: {
          $geometry: { type: 'Point', coordinates: [shop.lng, shop.lat] },
          $maxDistance: riderSearchMeters(),
        },
      },
    }).select('_id').limit(5).lean();
  } catch (err) {
    // A geo failure is not evidence that nobody is available, but it is not
    // evidence that somebody is either. Refusing is the safe direction: a
    // promise not made costs a sale, a promise broken costs a customer.
    console.warn(`[SAME-DAY] rider lookup failed: ${err.message}`);
    // Not cached: a failure is a moment, not an answer, and remembering it would
    // refuse every other line in the basket for a reason that has passed.
    return false;
  }

  if (riders.length === 0) return remember(false);

  // While the concurrency limit is off (development), every found rider counts
  // and there is nothing to query.
  if (maxConcurrentDeliveries() === 0) return remember(true);

  for (const r of riders) {
    if ((await openDeliveryCount(r._id)) < maxConcurrentDeliveries()) return remember(true);
  }
  return remember(false);
};

/** The money a Same-Day order adds, and who each part is for. */
const charges = (km) => {
  const fee = SAME_DAY_DELIVERY_FEE;
  const sellerIncentive = SAME_DAY_SELLER_INCENTIVE;
  return {
    // What the customer pays to have it carried today.
    deliveryFee: fee,
    // What the customer pays for the shop fulfilling today, collected on the
    // seller's behalf. Recorded only — nothing settles it yet.
    sellerIncentive,
    // The two above are the whole of the customer's delivery charge.
    customerDeliveryCharge: fee + sellerIncentive,
    // Platform cost, not customer money. Quoted from the same function the
    // rider's offer screen and their settlement both use.
    // A Same-Day trip, so the Same-Day rate card — not Quick's.
    riderPayoutQuoted: riderPayout(km, { mode: PAYOUT_MODE.SAME_DAY }).total,
  };
};

/**
 * @param {object} args
 * @param {object} args.product      a Product document or lean object
 * @param {object} args.seller       the Seller that owns it
 * @param {object} args.destination  { lat, lng } — where the customer wants it
 * @param {number} [args.qty]        how many, for the stock check
 * @param {Date}   [args.now]        injectable, so cutoff tests are not clock-dependent
 */
export const checkSameDayEligibility = async ({
  product, seller, destination, qty = 1, now = new Date(),
  // Optional per-request memo for the rider lookup. Callers checking several
  // lines from one shop pass one in; a single check leaves it out and nothing
  // is remembered.
  riderCache,
} = {}) => {
  /**
   * The seller's gate, and nothing before it.
   *
   * Returning here costs one property read. Every check below this line costs
   * arithmetic, a geo query, or both — and running them for a product whose
   * seller never opted in would be work done to reach a conclusion already
   * known.
   */
  if (!product?.sameDay?.enabled) {
    return no(SAME_DAY_REASON.PRODUCT_DISABLED, 'This item is not offered for same-day delivery');
  }

  if (product.type !== CHANNEL.ECOM) {
    return no(SAME_DAY_REASON.NOT_ECOMMERCE, 'Same-day delivery applies to Shop All items');
  }

  if (!seller?.sameDay?.enabled) {
    return no(SAME_DAY_REASON.SELLER_DISABLED, 'This store is not offering same-day delivery');
  }

  if (seller.status !== VENDOR_STATUS.APPROVED) {
    return no(SAME_DAY_REASON.SELLER_NOT_OPERATIONAL, 'This store is not currently taking same-day orders');
  }

  if (!(product.stock >= qty)) {
    return no(SAME_DAY_REASON.OUT_OF_STOCK, 'Not enough stock for same-day delivery');
  }

  // ---- can we even measure the trip? --------------------------------------
  const shop = shopPoint(seller);
  if (!shop) {
    return no(SAME_DAY_REASON.NO_SHOP_LOCATION, 'This store has not pinned its location');
  }
  if (destination?.lat === undefined || destination?.lng === undefined) {
    return no(SAME_DAY_REASON.NO_CUSTOMER_LOCATION, 'Add a delivery address to see same-day availability');
  }

  const km = distanceKm(shop, destination);
  if (km === undefined) {
    return no(SAME_DAY_REASON.NO_CUSTOMER_LOCATION, 'We could not work out the distance to your address');
  }

  /**
   * The (admin-configured) km rule — seller to customer.
   *
   * Not to be confused with how far we look for a rider, which is a different
   * radius answering a different question. A seller may narrow their own reach
   * below the platform ceiling; `Math.min` is what stops a stored value above it
   * mattering even if one ever got past the schema. The ceiling itself is read
   * live from RadiusSetting (via radiusSetting.service.js's cache) so an admin
   * change takes effect on the very next eligibility check, no restart.
   */
  const sameDayMaxRadiusKm = getRadiusSetting().sameDayMaxRadiusKm;
  const limitKm = Math.min(
    Number.isFinite(seller.sameDay.radiusKm) ? seller.sameDay.radiusKm : sameDayMaxRadiusKm,
    sameDayMaxRadiusKm
  );
  if (km > limitKm) {
    return no(
      SAME_DAY_REASON.TOO_FAR,
      `Same-day delivery reaches ${limitKm} km from this store; you are about ${km} km away`,
      { distanceKm: km }
    );
  }

  // ---- is the shop open for this today? -----------------------------------
  const days = seller.sameDay.availableDays;
  if (Array.isArray(days) && days.length > 0 && !days.includes(now.getDay())) {
    return no(SAME_DAY_REASON.CLOSED_TODAY, 'This store is not fulfilling same-day orders today', { distanceKm: km });
  }

  const cutoff = minutesOfDay(seller.sameDay.cutoffTime);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (cutoff !== undefined) {
    if (nowMins >= cutoff) {
      return no(
        SAME_DAY_REASON.CUTOFF_PASSED,
        `Same-day orders close at ${seller.sameDay.cutoffTime}`,
        { distanceKm: km }
      );
    }

    /**
     * Packing has to finish before the shop stops sending parcels out.
     *
     * An order taken five minutes before a 16:00 cut-off, from a shop that needs
     * an hour to pack, cannot go today — the cut-off is when parcels leave, not
     * when orders stop being accepted. Checking the cut-off alone would promise
     * a delivery that physically cannot happen.
     */
    const processing = Number(product.sameDay.processingMinutes) || 0;
    if (nowMins + processing > cutoff) {
      return no(
        SAME_DAY_REASON.NOT_ENOUGH_TIME,
        'There is not enough time left today to pack this order',
        { distanceKm: km }
      );
    }
  }

  // ---- last, because it is the expensive one ------------------------------
  if (!(await aRiderCouldTakeIt(shop, riderCache))) {
    return no(SAME_DAY_REASON.NO_RIDER, 'No delivery partner is free near this store right now', { distanceKm: km });
  }

  const money = charges(km);
  const processing = Number(product.sameDay.processingMinutes) || 0;

  return {
    available: true,
    code: SAME_DAY_REASON.OK,
    reason: 'Same-day delivery is available',
    distanceKm: km,
    ...money,
    /**
     * When we expect it to arrive: packing, then the ride.
     *
     * A straight-line ETA, so it is optimistic by exactly as much as the
     * distance is. Snapshotted onto the order at checkout, where being roughly
     * right and honest about it beats being precise about the wrong thing.
     */
    promisedBy: new Date(now.getTime() + (processing + (etaMinutes(km) || 0)) * 60 * 1000),
  };
};

/**
 * The same question for a whole basket.
 *
 * Same-Day is offered on a cart only when every line can have it, because an
 * order carries one status, one carrier and one delivery record — there is
 * nowhere to record that half the basket is coming today and half on Thursday.
 *
 * The multi-seller check comes first and is a deliberate limitation rather than
 * an oversight: splitting an order per vendor cascades into per-vendor payouts,
 * partial cancellation and separate tracking, which is a larger decision than
 * this feature. Every order in the database today is single-seller, so nothing
 * regresses by drawing the line here.
 *
 * @param {object[]} lines  [{ product, seller, qty }]
 */
export const checkCartSameDayEligibility = async ({ lines = [], destination, now = new Date() }) => {
  // One shop per group, so one rider answer for the whole group — shared across
  // its lines instead of asked once per item.
  const riderCache = new Map();

  if (lines.length === 0) {
    return no(SAME_DAY_REASON.OUT_OF_STOCK, 'Your basket is empty');
  }

  const sellerIds = new Set(lines.map((l) => String(l.seller?._id || l.product?.sellerId)));
  if (sellerIds.size > 1) {
    return no(
      SAME_DAY_REASON.MULTIPLE_SELLERS,
      'Same-day delivery is available when your basket is from one store'
    );
  }

  let furthest = 0;
  let latestPromise = null;

  for (const line of lines) {
    const verdict = await checkSameDayEligibility({
      product: line.product,
      seller: line.seller,
      destination,
      qty: line.qty,
      now,
      riderCache,
    });
    // The first refusal is the whole basket's answer, and its reason is the one
    // worth showing — it names the item that cannot make it.
    if (!verdict.available) return verdict;

    furthest = Math.max(furthest, verdict.distanceKm);
    if (!latestPromise || verdict.promisedBy > latestPromise) latestPromise = verdict.promisedBy;
  }

  /**
   * Charged once per order, not once per line.
   *
   * One rider makes one trip carrying the whole basket, so a second item does
   * not cost a second delivery — and the seller is fulfilling one order quickly,
   * not three.
   */
  const money = charges(furthest);

  return {
    available: true,
    code: SAME_DAY_REASON.OK,
    reason: 'Same-day delivery is available',
    distanceKm: furthest,
    ...money,
    promisedBy: latestPromise,
  };
};

export default checkSameDayEligibility;
