import { calculateProductGst, productGstLine } from './productGst.service.js';
import {
  CHANNEL,
  carrierForMode,
} from '../constants/enums.js';
import { getDeliveryChargeSetting } from './deliveryCharge.service.js';
import { riderPayout } from './riderPay.service.js';
import { httpError } from '../utils/response.js';
import { toPaise, fromPaise, sumMoney, lineMoney } from '../utils/money.js';

/**
 * One place that decides what an order costs.
 *
 * The cart preview and the checkout MUST agree — if they compute totals
 * separately they will drift, and the customer gets charged something other
 * than what the cart showed. Both call this.
 *
 * Order of operations:
 *   subtotal
 *   − coupon discount        (on the items the coupon actually covers)
 *   + delivery               (waived only by a free-shipping coupon, or an
 *                             empty cart — there is no spend threshold that
 *                             waives it on its own)
 *
 * Delivery is priced two ways, picked by whether a caller can supply a real
 * distance:
 *   - distanceKm given  → the same admin-configured Rider Pay rate (+ 1km
 *     floor) riderPayout() would pay a rider for that exact leg — see
 *     services/riderPay.service.js. This is real-time and per-trip.
 *   - distanceKm absent → the flat admin-configured fallback (see
 *     services/deliveryCharge.service.js) — used when there's no address yet,
 *     or the delivery has no rider leg to price (an external courier order).
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {Array}  items       [{ price, qty, type }]
 * @param {object} user        retained for caller compatibility
 * @param {object} applied     result of coupon.service evaluateCoupon(), optional
 * @param {object} sameDay     the Same-Day verdict, when chosen and available
 * @param {number} [distanceKm] shop → customer, when a caller has one to give —
 *                               real distance-based pricing when present, the
 *                               flat fallback otherwise (see doc comment above)
 * @param {number} [tip]        already server-validated by resolveTip()
 */
export const priceOrder = (items = [], user = {}, applied = null, sameDay = null, distanceKm = null, tip = 0) => {
  // Admin-configurable (services/deliveryCharge.service.js), cached — never a
  // DB read on this hot path. Falls back to the pre-configuration default
  // when nothing has been set.
  const { flatFee: DEFAULT_DELIVERY_CHARGE, distanceRates } = getDeliveryChargeSetting();

  const subtotal = fromPaise(items.map(productGstLine).reduce((sum, line) => sum + line.grossPaise, 0));

  // ---- coupon --------------------------------------------------------------
  const couponOk = Boolean(applied?.ok);
  const couponDiscount = couponOk ? round2(Math.min(applied.discount || 0, subtotal)) : 0;
  const couponFreeShipping = Boolean(couponOk && applied.freeShipping);

  // Product-level promotions are a v2 feature; the field exists so the shape of
  // a priced order never has to change when they arrive.
  const discount = 0;

  // Retain a zero-valued legacy field for older cart/order readers.
  const cdsDiscount = 0;

  // ---- delivery ------------------------------------------------------------
  // No spend threshold waives this — every order pays a real charge. The
  // only waivers are an empty cart (nothing to deliver) and a coupon that
  // explicitly promises free shipping.
  let deliveryCharge;
  if (subtotal === 0) {
    deliveryCharge = 0;
  } else if (Number.isFinite(distanceKm)) {
    // Real-time: exactly the distance-pay component riderPayout() would pay
    // a rider for this leg, under whichever Rider Pay Rate an admin has
    // live right now — same-day mode when the customer chose Same-Day,
    // Quick otherwise. Never a second, independently-set number.
    const mode = sameDay ? 'same_day' : 'quick';
    const legacyDistanceQuote = riderPayout(distanceKm, { mode });
    if (!distanceRates && legacyDistanceQuote.requiresIndependentCustomerTariff) throw httpError(503, 'Approved customer delivery tariff is unavailable; retry checkout later');
    deliveryCharge = Number.isFinite(distanceRates?.[mode])
      ? Math.round(Math.max(1, distanceKm) * distanceRates[mode])
      : legacyDistanceQuote.distancePay;
  } else {
    // No distance to price against — no address chosen yet, or this
    // delivery has no rider leg at all (an external-courier order).
    deliveryCharge = DEFAULT_DELIVERY_CHARGE;
  }
  if (couponFreeShipping) deliveryCharge = 0;

  /**
   * Same-Day is charged ON TOP of the ordinary delivery charge, not instead of it.
   *
   * The rule above is untouched and still decides what carrying the parcel
   * costs — including the spend threshold and a free-shipping coupon, both of
   * which have already been applied by the time we get here. Same-Day is a
   * separate thing the customer opted into: getting it today. So it is added,
   * and neither waiver reaches it. A ₹600 basket earns free shipping; it does
   * not earn a rider's trip within the hour, and a coupon promising free
   * shipping is not promising free same-day.
   *
   * `deliveryCharge` remains the one customer-facing figure — what the total is
   * built from and what the payment is taken against. `standardFee` is captured
   * before the premium is added so the three parts still reconcile to it
   * exactly:
   *
   *     standardFee + sameDayFee + sameDayIncentive === deliveryCharge
   *
   * Without that first number the sum stopped adding up the moment the charge
   * became additive, and a delivery line worth ₹80 would have had only ₹40 of
   * explanation behind it.
   */
  const standardFee = deliveryCharge;

  let sameDayFee = 0;
  let sameDayIncentive = 0;
  if (sameDay) {
    sameDayFee = Math.max(0, Number(sameDay.deliveryFee) || 0);
    sameDayIncentive = Math.max(0, Number(sameDay.sellerIncentive) || 0);
    deliveryCharge = sumMoney(standardFee, sameDayFee, sameDayIncentive);
  }

  // ---- rider tip ------------------------------------------------------------
  // Server-validated against the fixed ladder by tip.service.js's resolveTip
  // before it reaches here. Additive: it is charged on top, and no coupon
  // or free-shipping waiver touches it. It is NOT part of deliveryCharge — the delivery
  // charge is what the platform bills for carrying the parcel, the tip is the customer's own
  // money for the rider.
  const tipAmount = Math.max(0, Math.round(Number(tip) || 0));

  const totalAmount = fromPaise(Math.max(toPaise(subtotal) - toPaise(discount) - toPaise(couponDiscount) - toPaise(cdsDiscount) + toPaise(deliveryCharge) + toPaise(tipAmount), 0));

  const productTax = calculateProductGst(items, { subtotal, discountRepresentation: 'components-v1', discount, couponDiscount, cdsDiscount, deliveryCharge, tipAmount, totalAmount });
  return {
    productTax,
    subtotal,
    discount,
    couponDiscount,
    couponCode: couponOk ? applied.coupon?.code : null,
    couponTitle: couponOk ? applied.coupon?.title : null,
    couponFreeShipping,
    cdsDiscount,
    deliveryCharge,
    tipAmount,
    totalAmount,

    /**
     * The breakdown behind deliveryCharge, so the order can snapshot the parts
     * without recomputing them from a different rule.
     *
     * `standardFee` is reported whether or not Same-Day was chosen — on an
     * ordinary order it simply equals `deliveryCharge`, which keeps the
     * reconciliation the same shape for every order rather than only for
     * Same-Day ones.
     */
    standardFee,
    sameDayFee,
    sameDayIncentive,

    // surfaced so the UI can explain the numbers instead of hardcoding them
    totalSavings: round2(couponDiscount + discount),
  };
};

/**
 * Who carries this order.
 *
 * Grocery and SHG are always our own riders, and a mixed list counts as internal
 * because a local rider can carry a courier-able item but not the other way
 * round. That part is unchanged.
 *
 * Ordinary e-commerce has no carrier at placement. Its seller chooses one
 * after acceptance and preparation. Explicit Same-Day still requires an
 * internal rider and its eligibility must be checked by the caller.
 */
export const resolveDeliveryType = (items = [], mode = null) => {
  const allEcom = items.length > 0 && items.every((i) => i.type === CHANNEL.ECOM);
  if (!allEcom) return 'internal';
  // Regular e-commerce is accepted by its seller before a carrier is selected.
  // Same-Day remains an explicit local-rider promise, not a courier fallback.
  return carrierForMode(mode);
};

export default priceOrder;
