import Coupon, { DISCOUNT_TYPE } from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import Order from '../models/Order.js';

/**
 * Coupon validation and discount calculation.
 *
 * The code only triggers the offer — these rules decide whether it applies, how
 * much it is worth, and which items it is worth it on.
 *
 * Every check returns a plain reason string rather than throwing, because the
 * cart screen needs to TELL the shopper why a code did not work ("Add ₹200 more
 * to use this coupon") instead of just refusing it.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Items this coupon is allowed to discount. Empty scope arrays mean "all". */
export const eligibleItems = (coupon, items = []) => {
  const inList = (list, id) =>
    !list?.length || list.some((x) => String(x) === String(id));

  return items.filter((i) => {
    if (coupon.channel && coupon.channel !== 'all' && i.type !== coupon.channel) return false;
    if (!inList(coupon.products, i.productId)) return false;
    if (!inList(coupon.sellers, i.sellerId)) return false;
    // categoryId is only present on cart lines; order lines carry it too.
    if (coupon.categories?.length) {
      const cat = i.categoryId || i.category;
      if (!coupon.categories.some((c) => String(c) === String(cat))) return false;
    }
    return true;
  });
};

/**
 * Work out what a coupon is worth for this cart.
 *
 * @returns {{ok, reason?, discount, freeShipping, eligibleSubtotal, coupon}}
 */
export const evaluateCoupon = async (coupon, {
  items = [], subtotal = 0, user, deliveryCharge = 0,
  // Optional pre-fetched lookups. Evaluating a LIST of coupons would otherwise
  // fire two queries per coupon; the caller batches them once and passes them
  // in, turning 2N round-trips into 2.
  redemptionCounts = null,
  userOrderCount = null,
} = {}) => {
  const fail = (reason) => ({ ok: false, reason, discount: 0, freeShipping: false });

  if (!coupon) return fail('That coupon code is not valid.');
  if (!coupon.isActive) return fail('This coupon is no longer active.');

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    return fail(`This coupon starts on ${coupon.startsAt.toLocaleDateString('en-IN')}.`);
  }
  if (coupon.expiresAt && coupon.expiresAt < now) return fail('This coupon has expired.');

  if (coupon.totalUsageLimit > 0 && coupon.usedCount >= coupon.totalUsageLimit) {
    return fail('This coupon has been fully claimed.');
  }

  if (coupon.perUserLimit > 0 && user?._id) {
    const used = redemptionCounts
      ? (redemptionCounts.get(String(coupon._id)) || 0)
      : await CouponRedemption.countDocuments({ couponId: coupon._id, userId: user._id });
    if (used >= coupon.perUserLimit) {
      return fail(
        coupon.perUserLimit === 1
          ? 'You have already used this coupon.'
          : `You have already used this coupon ${coupon.perUserLimit} times.`
      );
    }
  }

  if (coupon.firstOrderOnly && user?._id) {
    const previous = userOrderCount !== null
      ? userOrderCount
      : await Order.countDocuments({ userId: user._id, status: { $nin: ['cancelled'] } });
    if (previous > 0) return fail('This coupon is only valid on your first order.');
  }

  if (subtotal < coupon.minOrderValue) {
    const short = round2(coupon.minOrderValue - subtotal);
    return fail(`Add ₹${short} more to use this coupon (minimum order ₹${coupon.minOrderValue}).`);
  }

  // ---- scope --------------------------------------------------------------
  const eligible = eligibleItems(coupon, items);
  if (eligible.length === 0) {
    return fail('This coupon does not apply to the items in your cart.');
  }
  const eligibleSubtotal = round2(
    eligible.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0)
  );

  // ---- reward -------------------------------------------------------------
  let discount = 0;
  let freeShipping = false;

  if (coupon.discountType === DISCOUNT_TYPE.FREE_SHIPPING) {
    if (deliveryCharge <= 0) {
      return fail('Your order already has free delivery.');
    }
    freeShipping = true;
  } else if (coupon.discountType === DISCOUNT_TYPE.PERCENTAGE) {
    discount = round2((eligibleSubtotal * coupon.value) / 100);
    // A cap is what stops "20% off" costing a fortune on a large cart.
    if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    // Never discount more than the items it applies to are worth.
    discount = Math.min(coupon.value, eligibleSubtotal);
  }

  discount = round2(Math.max(discount, 0));

  if (discount <= 0 && !freeShipping) {
    return fail('This coupon does not reduce the price of your cart.');
  }

  return {
    ok: true,
    discount,
    freeShipping,
    eligibleSubtotal,
    eligibleCount: eligible.length,
    coupon: {
      _id: coupon._id,
      code: coupon.code,
      title: coupon.title,
      discountType: coupon.discountType,
      value: coupon.value,
      maxDiscount: coupon.maxDiscount,
    },
  };
};

/**
 * Batch the two per-coupon lookups for a whole list in one round-trip each.
 * Without this, showing 30 offers meant 60 queries.
 */
export const buildEvaluationContext = async (userId, couponIds) => {
  const [rows, userOrderCount] = await Promise.all([
    CouponRedemption.aggregate([
      { $match: { userId, couponId: { $in: couponIds } } },
      { $group: { _id: '$couponId', n: { $sum: 1 } } },
    ]),
    Order.countDocuments({ userId, status: { $nin: ['cancelled'] } }),
  ]);

  return {
    redemptionCounts: new Map(rows.map((r) => [String(r._id), r.n])),
    userOrderCount,
  };
};

/** Look a code up and evaluate it in one step. */
export const applyCouponCode = async (code, context) => {
  if (!code) return { ok: false, reason: 'Please enter a coupon code.', discount: 0, freeShipping: false };
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() });
  return evaluateCoupon(coupon, context);
};

/**
 * Record a use. Called inside the checkout transaction so a coupon is never
 * counted against an order that failed to be created.
 */
export const redeemCoupon = async ({ coupon, userId, orderId, discountAmount, orderTotal }, session) => {
  await CouponRedemption.create([{
    couponId: coupon._id,
    code: coupon.code,
    userId,
    orderId,
    discountAmount,
    orderTotal,
  }], { session });

  await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } }, { session });
};

/** Give the count back if the order is cancelled before it was ever fulfilled. */
export const releaseCoupon = async (couponId, orderId, session) => {
  if (!couponId) return;
  const removed = await CouponRedemption.findOneAndDelete({ couponId, orderId }, { session });
  if (removed) {
    await Coupon.updateOne({ _id: couponId }, { $inc: { usedCount: -1 } }, { session });
  }
};

export default applyCouponCode;
