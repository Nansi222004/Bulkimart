import { httpError } from '../utils/response.js';
import {
  SUBSCRIPTION_FREQUENCY,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_MAX_WEIGHT_KG,
  SUBSCRIPTION_MAX_DELIVERIES,
  WEEKDAYS,
  CHANNEL,
} from '../constants/enums.js';

/**
 * The rules a grocery subscription has to satisfy, and the calendar it becomes.
 *
 * Kept out of the controller because all of it is arithmetic on dates and money
 * that wants testing directly — a monthly plan starting on the 31st, a weekly
 * plan whose first delivery day has already passed this week, a basket exactly
 * on the weight ceiling. Driving those through HTTP to find out would be slow
 * and would tell you less.
 *
 * The subscription basket is deliberately NOT the cart. A customer building a
 * month of rations is doing something different from filling a basket for
 * tonight, and the two must not empty or reprice each other. Items arrive in the
 * request payload; `cart.controller.js` is never touched.
 */

/** Grams, as Product stores it, to kilograms. A missing weight is not free. */
const ASSUMED_KG = 0.5;

export const weightKgOf = (product) => {
  const grams = Number(product?.weight);
  if (!Number.isFinite(grams) || grams <= 0) return ASSUMED_KG;
  return grams / 1000;
};

/**
 * Every product must come from one shop — a Seller's or an SHG group's,
 * either is fine, but never a mix of two shops (of either kind).
 *
 * A subscription is one rider making the same trip repeatedly. Two vendors
 * means two pickups on every one of thirty deliveries, which is a different
 * product from the one being sold here — so it is refused at creation
 * rather than discovered by a rider on day one.
 *
 * @returns {{ sellerId?: string, shgStoreId?: string }} whichever one vendor
 *          fulfils this basket — the exact pair Subscription/
 *          SubscriptionBasket store, never both set.
 */
export const assertSingleVendor = (products) => {
  // `sellerId`/`shgStoreId` arrive either as a raw ObjectId (createSubscription's
  // unpopulated read) or a populated document (calculateSubscriptionBasket's
  // `.populate('sellerId')`) — `._id` handles the populated shape, the plain
  // value handles the raw one.
  const idOf = (v) => (v && v._id ? String(v._id) : (v ? String(v) : null));
  const vendorKeyOf = (p) => {
    const sellerId = idOf(p.sellerId);
    if (sellerId) return `seller:${sellerId}`;
    const shgStoreId = idOf(p.shgStoreId);
    return shgStoreId ? `shg:${shgStoreId}` : null;
  };
  const missing = products.find((p) => !vendorKeyOf(p));
  if (missing) {
    throw httpError(400, `"${missing.name}" is not sold by a subscribable store`);
  }

  const vendorKeys = [...new Set(products.map(vendorKeyOf))];
  if (vendorKeys.length > 1) {
    const names = products
      .map((p) => p.name)
      .slice(0, 3)
      .join(', ');
    throw httpError(400,
      `A subscription can only contain items from one store. Your basket has items from ${vendorKeys.length} stores (${names}…).`);
  }

  const [kind, id] = vendorKeys[0].split(':');
  return kind === 'seller' ? { sellerId: id } : { shgStoreId: id };
};

/**
 * The weight ceiling, checked per delivery.
 *
 * @param {Array<{product: object, qty: number}>} lines
 */
export const assertWeightWithinLimit = (lines) => {
  const totalKg = lines.reduce((sum, l) => sum + weightKgOf(l.product) * (Number(l.qty) || 0), 0);
  const rounded = Math.round(totalKg * 100) / 100;

  if (rounded > SUBSCRIPTION_MAX_WEIGHT_KG) {
    throw httpError(400,
      `One delivery cannot weigh more than ${SUBSCRIPTION_MAX_WEIGHT_KG} kg. This basket weighs ${rounded} kg — remove an item or reduce a quantity.`);
  }
  return rounded;
};

/** Midnight, so two dates on the same day compare equal. */
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * The dates this plan will deliver on.
 *
 * @param {object} args
 * @param {'daily'|'weekly'|'monthly'} args.frequency
 * @param {number} args.count        how many deliveries
 * @param {Date}   args.startDate
 * @param {string} [args.deliveryDay] 'Monday'… — weekly only
 * @returns {Date[]} chronological, length === count
 */
export const buildSchedule = ({ frequency, count, startDate, deliveryDay }) => {
  if (!SUBSCRIPTION_FREQUENCIES.includes(frequency)) {
    throw httpError(400, `Unknown frequency "${frequency}" — expected ${SUBSCRIPTION_FREQUENCIES.join(', ')}`);
  }

  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, 'A plan needs at least one delivery');
  if (n > SUBSCRIPTION_MAX_DELIVERIES) {
    throw httpError(400, `A plan cannot run to more than ${SUBSCRIPTION_MAX_DELIVERIES} deliveries`);
  }

  const start = startOfDay(startDate);
  if (Number.isNaN(start.getTime())) throw httpError(400, 'That start date is not a date');
  if (start < startOfDay(new Date())) throw httpError(400, 'A subscription cannot start in the past');

  const dates = [];

  if (frequency === SUBSCRIPTION_FREQUENCY.DAILY) {
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  if (frequency === SUBSCRIPTION_FREQUENCY.WEEKLY) {
    const target = WEEKDAYS.indexOf(deliveryDay);
    if (target === -1) throw httpError(400, `Choose a delivery day — ${WEEKDAYS.join(', ')}`);

    /**
     * The first delivery is the chosen weekday ON OR AFTER the start date.
     *
     * A customer starting on a Wednesday and choosing Monday means next Monday,
     * not the Monday that has already gone. Starting exactly on the chosen day
     * delivers that same day rather than waiting a week for it to come round.
     */
    const first = new Date(start);
    const shift = (target - start.getDay() + 7) % 7;
    first.setDate(start.getDate() + shift);

    for (let i = 0; i < n; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i * 7);
      dates.push(d);
    }
    return dates;
  }

  // Monthly — the same calendar day, month after month.
  const day = start.getDate();
  for (let i = 0; i < n; i++) {
    /**
     * Anchored to the 1st and then set, so a short month cannot overflow.
     *
     * `new Date(y, m, 31)` for February silently becomes the 2nd or 3rd of
     * March. A plan bought on the 31st would then drift a few days later every
     * short month. Clamping to the last day of the month keeps it on the end of
     * the month, which is what "the 31st" means to the person who chose it.
     */
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDayOfMonth));
    d.setHours(0, 0, 0, 0);
    dates.push(d);
  }
  return dates;
};

/**
 * What the whole plan costs, paid once, up front.
 *
 * One basket repeated N times. The CDS discount is the co-operative membership
 * benefit the platform already applies elsewhere, read from the same env figure
 * so a member is not offered one rate at checkout and another here.
 *
 * @param {Array<{product: object, qty: number}>} lines
 * @param {number} deliveries
 * @param {object} user
 */
export const priceSubscription = (lines, deliveries, user) => {
  const perDelivery = lines.reduce(
    (sum, l) => sum + (Number(l.product.price) || 0) * (Number(l.qty) || 0),
    0
  );

  const totalAmount = Math.round(perDelivery * deliveries * 100) / 100;

  // A verified member only — an unverified number is a claim, not a benefit.
  const percent = user?.isCDSVerified ? Number(process.env.CDS_DISCOUNT_PERCENT || 5) : 0;
  const cdsDiscount = Math.round(totalAmount * (percent / 100) * 100) / 100;

  return {
    perDelivery: Math.round(perDelivery * 100) / 100,
    deliveries,
    totalAmount,
    cdsDiscount,
    cdsPercent: percent,
    finalAmount: Math.round((totalAmount - cdsDiscount) * 100) / 100,
  };
};

/**
 * The calendar date a delivery falls on, and its time slot's start time,
 * combined into the one moment the delivery is actually promised for.
 *
 * `deliverySchedule.date` only ever carries a day — `buildSchedule` anchors
 * every date to midnight — while `timeSlot` ("02:00 PM - 03:00 PM") is a
 * separate, once-per-plan display string never combined with it. Nothing
 * before this did that combining, which is exactly why "30 minutes before
 * delivery" could not be computed correctly, and why a delivery scheduled
 * for later today could be wrongly treated as already past.
 *
 * No timezone conversion here on purpose. Every other date computation in
 * this backend (this file's own `startOfDay`, order/delivery timestamps
 * elsewhere) is plain server-local `Date` arithmetic, with no Asia/Kolkata
 * or UTC-offset handling anywhere in the codebase. This follows that same
 * convention rather than introducing a second, inconsistent one.
 *
 * @param {Date|string} date
 * @param {string} [timeSlot] e.g. "02:00 PM - 03:00 PM"
 * @returns {Date|null} null only if `date` itself is not a valid date
 */
export const combineDeliveryDateAndTime = (date, timeSlot) => {
  const base = new Date(date);
  if (Number.isNaN(base.getTime())) return null;

  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(timeSlot || '').trim());
  if (!match) return base; // no parseable slot — midnight stands, same as before this helper existed

  const [, hourStr, minStr, meridiem] = match;
  let hour = Number(hourStr) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;

  const combined = new Date(base);
  combined.setHours(hour, Number(minStr), 0, 0);
  return combined;
};

/** The effective delivery moment, minus a lead time — when the seller must be alerted. */
export const prepAlertTimeFor = (date, timeSlot, leadMinutes = 30) => {
  const deliveryAt = combineDeliveryDateAndTime(date, timeSlot);
  return deliveryAt ? new Date(deliveryAt.getTime() - leadMinutes * 60 * 1000) : null;
};

/**
 * The next delivery still ahead of us, if any remain.
 *
 * One small function so "what's next" is answered the same way everywhere
 * it's asked — resuming a paused plan, a seller accepting a request, and a
 * delivery being marked complete all need exactly this same lookup.
 *
 * `timeSlot` is optional so existing callers that predate this fix keep
 * working (falls back to the raw midnight-anchored date, the old
 * behavior) — but passing it is what stops a delivery scheduled for later
 * *today* from being wrongly treated as already past.
 *
 * @param {Array<{status: string, date: Date}>} deliverySchedule
 * @param {string} [timeSlot]
 * @returns {Date|undefined}
 */
export const nextScheduledDeliveryDate = (deliverySchedule, timeSlot) => {
  const now = new Date();
  const next = (deliverySchedule || [])
    .filter((d) => {
      if (d.status !== 'scheduled') return false;
      const effective = timeSlot ? combineDeliveryDateAndTime(d.date, timeSlot) : null;
      return (effective || d.date) >= now;
    })
    .sort((a, b) => a.date - b.date)[0];
  return next?.date;
};

/**
 * Check the products themselves before anything is priced or scheduled.
 *
 * Subscriptions are Quick Commerce only. A month of scheduled parcels through a
 * courier is a different promise from a rider bringing rations on a fixed day,
 * and nothing downstream is built for it.
 */
export const assertSubscribable = (lines) => {
  if (!lines.length) throw httpError(400, 'Add at least one item to your subscription');

  for (const { product, qty } of lines) {
    if (!product) throw httpError(400, 'One of the items no longer exists');
    if (product.isDeleted || !product.isActive || product.status !== 'approved') {
      throw httpError(400, `"${product.name}" is no longer available`);
    }
    if (product.type !== CHANNEL.GROCERY) {
      throw httpError(400, `"${product.name}" is not a grocery item — subscriptions are Quick Commerce only`);
    }
    if (!Number.isInteger(Number(qty)) || Number(qty) < 1) {
      throw httpError(400, `Choose a whole quantity for "${product.name}"`);
    }
  }
};
