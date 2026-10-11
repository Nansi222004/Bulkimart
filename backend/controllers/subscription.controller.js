import mongoose from 'mongoose';
import Subscription from '../models/Subscription.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import {
  PLAN_TYPES,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_FREQUENCY,
  SUBSCRIPTION_DELIVERY_STATUS,
  CHANNEL,
} from '../constants/enums.js';
import { buildReturnPolicySnapshotsFor } from '../services/returnPolicy.service.js';
import {
  assertSubscribable,
  assertSingleVendor,
  assertWeightWithinLimit,
  buildSchedule,
  priceSubscription,
  nextScheduledDeliveryDate,
} from '../services/subscription.service.js';
import { assertActivePremiumMembership } from '../services/premium.service.js';
import { distanceKm } from '../utils/geo.js';
import { notifyUser, notifySeller, notifyShg, NOTIFICATION_EVENT } from '../services/notification.service.js';

/**
 * Grocery subscriptions.
 *
 * The subscription basket is its own thing. Items arrive in the request body
 * rather than being read from a Cart, because a customer assembling a month of
 * rations is not filling the same basket they use for tonight's dinner — and
 * checking out one must never empty the other. Nothing here touches
 * cart.controller.js, Same-Day, Scheduled delivery, or the ordinary checkout.
 *
 * The rules that make a plan legal — one seller, a weight a rider can carry,
 * groceries only, a start date that has not passed — live in
 * services/subscription.service.js so they can be tested as arithmetic rather
 * than through HTTP.
 */

/** How many deliveries a plan produces, from the shape the client sent. */
const deliveryCountOf = ({ frequency, duration, planDuration }) => {
  const n = Number(duration ?? planDuration);
  if (Number.isInteger(n) && n > 0) return n;
  throw httpError(400, 'Choose how long the subscription should run');
};

/** How long the seller has to accept a new subscription request. */
const acceptWindowMs = () =>
  (Number(process.env.SUBSCRIPTION_ACCEPT_WINDOW_MINUTES) || 2) * 60 * 1000;

// @desc    Create a subscription and take payment for the whole plan
// @route   POST /api/subscriptions
// @access  Private
export const createSubscription = asyncHandler(async (req, res) => {
  const {
    planType = 'custom',
    frequency = SUBSCRIPTION_FREQUENCY.DAILY,
    deliveryDay,
    timeSlot,
    startDate,
    customItems = [],
    shippingAddress,
    paymentMethod = PAYMENT_METHOD.COD,
  } = req.body;

  if (!PLAN_TYPES.includes(planType)) {
    throw httpError(400, `Unknown plan "${planType}" — expected ${PLAN_TYPES.join(', ')}`);
  }
  if (!Object.values(PAYMENT_METHOD).includes(paymentMethod)) {
    throw httpError(400, 'Invalid payment method');
  }
  if (!Array.isArray(customItems) || customItems.length === 0) {
    throw httpError(400, 'Add at least one item to your subscription');
  }
  if (!shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.pincode || !shippingAddress?.phone) {
    throw httpError(400, 'A delivery address with phone, address line, city and pincode is required');
  }

  /**
   * Product Subscriptions are a Premium Membership entitlement.
   *
   * Checked here, on the server, rather than only in the UI that opens the
   * plan chooser — otherwise this endpoint is reachable directly by anyone
   * without a membership. Throws PREMIUM_MEMBERSHIP_REQUIRED, which the
   * customer app switches on to show the plans.
   *
   * Only CREATION is gated. Everything an existing subscription does —
   * its schedule, seller acceptance, prep alerts, packing, delivery — runs
   * on untouched code and keeps running after a membership expires.
   */
  await assertActivePremiumMembership(req.user._id);

  // ---- the items, read live rather than trusted from the request ----------
  const ids = customItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = customItems.map((i) => ({
    productId: i.productId,
    qty: Number(i.qty),
    product: byId.get(String(i.productId)),
  }));

  assertSubscribable(lines);
  const { sellerId, shgStoreId } = assertSingleVendor(lines.map((l) => l.product));
  const weightKg = assertWeightWithinLimit(lines);

  // ---- the calendar -------------------------------------------------------
  const count = deliveryCountOf({ frequency, duration: req.body.duration, planDuration: req.body.planDuration });
  const dates = buildSchedule({ frequency, count, startDate, deliveryDay });

  // ---- the money ----------------------------------------------------------
  const pricing = priceSubscription(lines, dates.length, req.user);

  /**
   * One payment for the whole plan, taken now.
   *
   * A real Payment document, not a reference the client made up — every other
   * money path in this codebase settles through one, and a subscription that
   * carried a string nobody could reconcile would be the one exception nobody
   * remembers when a refund is asked for.
   */
  const session = await mongoose.startSession();
  let subscription;

  try {
    await session.withTransaction(async () => {
      const [payment] = await Payment.create([{
        userId: req.user._id,
        amount: pricing.finalAmount,
        method: paymentMethod,
        status: PAYMENT_STATUS.PENDING,
      }], { session });

      const [doc] = await Subscription.create([{
        userId: req.user._id,
        planType,
        planDuration: dates.length,
        frequency,
        deliveryDay: frequency === SUBSCRIPTION_FREQUENCY.WEEKLY ? deliveryDay : undefined,
        timeSlot,
        sellerId,
        shgStoreId,
        weightKg,

        customItems: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        shippingAddress,

        pricing: {
          totalAmount: pricing.totalAmount,
          cdsDiscount: pricing.cdsDiscount,
          finalAmount: pricing.finalAmount,
          // What one delivery is actually worth, discount already spread
          // evenly across the plan. Persisted here rather than recomputed
          // later — by the time a single delivery is packed, months on,
          // product prices may have moved, and the rider must be shown the
          // figure this plan was actually bought at.
          perDeliveryAmount: Math.round((pricing.finalAmount / dates.length) * 100) / 100,
        },
        paymentId: payment._id,

        startDate: dates[0],
        endDate: dates[dates.length - 1],
        // Not yet meaningful until the seller accepts — set once acceptance
        // resolves the first scheduled date, same as updateSubscriptionStatus
        // already computes it for resume.
        nextDeliveryDate: undefined,
        status: SUBSCRIPTION_STATUS.PENDING_SELLER_ACCEPTANCE,
        sellerAcceptDeadline: new Date(Date.now() + acceptWindowMs()),

        // Every date the plan will deliver on, written once at purchase so the
        // customer can see the whole run and skip a single day of it.
        deliverySchedule: dates.map((date) => ({ date, status: 'scheduled' })),
      }], { session });

      subscription = doc;
    });
  } finally {
    await session.endSession();
  }

  // Outside the transaction, same convention used everywhere else in this
  // codebase: a failed notification must not undo a real creation.
  try {
    const { emitToSeller, emitToShg } = await import('../socket/rooms.js');
    const payload = {
      subscriptionId: subscription._id,
      planType,
      frequency,
      deliveries: dates.length,
      finalAmount: pricing.finalAmount,
      acceptBy: subscription.sellerAcceptDeadline,
    };
    if (sellerId) {
      emitToSeller(String(sellerId), 'subscription_request', payload);
      notifySeller(String(sellerId), {
        event: NOTIFICATION_EVENT.NEW_SUBSCRIPTION,
        title: 'New subscription request',
        message: `A ${planType} subscription request (${dates.length} deliveries) is awaiting your acceptance.`,
        metadata: { subscriptionId: subscription._id },
        route: '/subscriptions',
      }).catch((e) => console.error('[NOTIFICATION] notifySeller (subscription request) failed:', e.message));
    } else if (shgStoreId) {
      emitToShg(String(shgStoreId), 'subscription_request', payload);
      notifyShg(String(shgStoreId), {
        event: NOTIFICATION_EVENT.NEW_SUBSCRIPTION,
        title: 'New subscription request',
        message: `A ${planType} subscription request (${dates.length} deliveries) is awaiting your acceptance.`,
        metadata: { subscriptionId: subscription._id },
        route: '/subscriptions',
      }).catch((e) => console.error('[NOTIFICATION] notifyShg (subscription request) failed:', e.message));
    }
  } catch (e) {
    console.error('[SUBSCRIPTION] vendor notify failed:', e.message);
  }

  return created(res, {
    subscription,
    pricing,
    nextStep: 'Waiting for the store to accept your subscription request.',
  }, `Subscription request sent — awaiting store acceptance`);
});

/**
 * How far along a plan's own delivery calendar is — the same three counts
 * a list row and a detail screen both want, computed once from data
 * already in hand rather than a separate query.
 */
export const deliveryProgressOf = (deliverySchedule) => {
  const rows = deliverySchedule || [];
  const completed = rows.filter((d) => d.status === 'delivered').length;
  const remaining = rows.filter((d) => d.status === 'scheduled').length;
  return { total: rows.length, completed, remaining };
};

/**
 * Attaches the real Order this delivery became, to every schedule row that
 * actually has one — `packed` and `delivered` rows only, since `scheduled`/
 * `skipped`/`failed` rows never had an Order created for them.
 *
 * Not a second tracking system: `Order.subscriptionId` /
 * `subscriptionDeliveryEntryId` already exist (set by packSubscriptionDelivery)
 * specifically so this lookup works, and the customer/seller UI reuses the
 * *existing* order-tracking endpoint (`GET /api/orders/:id/track`) and
 * `DeliveryMap` once it has this id — nothing about rider location, OTP or
 * the map is duplicated here.
 */
export const attachOrderRefs = async (sub) => {
  const packedOrDelivered = (sub.deliverySchedule || []).filter(
    (d) => d.status === 'packed' || d.status === 'delivered'
  );
  if (packedOrDelivered.length === 0) return sub;

  const orders = await Order.find({
    subscriptionId: sub._id,
    subscriptionDeliveryEntryId: { $in: packedOrDelivered.map((d) => d._id) },
  })
    .select('_id status subscriptionDeliveryEntryId deliveryId')
    .populate('deliveryId', 'otp otpVerified')
    .lean();

  const byEntryId = new Map(orders.map((o) => [String(o.subscriptionDeliveryEntryId), o]));
  sub.deliverySchedule = (sub.deliverySchedule || []).map((d) => {
    const order = byEntryId.get(String(d._id));
    if (!order) return d;
    // Only surface the code while it's still live — once verified, the
    // delivery is already done and there's nothing left to confirm.
    const deliveryOtp = order.deliveryId && !order.deliveryId.otpVerified ? order.deliveryId.otp : null;
    return { ...d, orderId: order._id, orderStatus: order.status, deliveryOtp };
  });
  return sub;
};

// @desc    My subscriptions
// @route   GET /api/subscriptions
// @access  Private
export const getMySubscriptions = asyncHandler(async (req, res) => {
  const subs = await Subscription.find({ userId: req.user._id })
    .populate('customItems.productId', 'name images price unit weight')
    .sort({ createdAt: -1 })
    .lean();

  // attachOrderRefs early-returns for a subscription with no packed/delivered
  // rows, so this only does real work for the handful that are actually
  // in-flight — a customer's own list is always small enough for this.
  await Promise.all(subs.map((s) => attachOrderRefs(s)));
  const withProgress = subs.map((s) => ({ ...s, progress: deliveryProgressOf(s.deliverySchedule) }));
  return ok(res, withProgress, 'Your subscriptions');
});

// @desc    One subscription
// @route   GET /api/subscriptions/:id
// @access  Private
export const getSubscriptionById = asyncHandler(async (req, res) => {
  const sub = await Subscription.findById(req.params.id)
    .populate('customItems.productId', 'name images price unit weight')
    .lean();

  if (!sub) throw httpError(404, 'Subscription not found');
  // Read the owner off the document, never off the request.
  if (String(sub.userId) !== String(req.user._id)) throw httpError(403, 'This is not your subscription');

  await attachOrderRefs(sub);
  sub.progress = deliveryProgressOf(sub.deliverySchedule);

  return ok(res, sub, 'Subscription');
});

// @desc    Every subscription this seller fulfils
// @route   GET /api/subscriptions/seller
// @access  Private (seller)
export const getSubscriptionsForSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(403, 'You have not registered as a seller');

  const subs = await Subscription.find({ sellerId: seller._id })
    .populate('customItems.productId', 'name images price unit weight')
    .populate('userId', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  const withProgress = subs.map((s) => ({ ...s, progress: deliveryProgressOf(s.deliverySchedule) }));
  return ok(res, withProgress, 'Subscriptions');
});

// @desc    One subscription, as its fulfilling seller — items, customer
//          address and schedule, for the prep-alert / pack screen
// @route   GET /api/subscriptions/:id/seller-view
// @access  Private (seller)
export const getSubscriptionForSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(403, 'You have not registered as a seller');

  const sub = await Subscription.findById(req.params.id)
    .populate('customItems.productId', 'name images price unit weight')
    .populate('userId', 'name phone')
    .lean();

  if (!sub) throw httpError(404, 'Subscription not found');
  if (String(sub.sellerId) !== String(seller._id)) throw httpError(403, 'This is not your subscription');

  await attachOrderRefs(sub);
  sub.progress = deliveryProgressOf(sub.deliverySchedule);

  return ok(res, sub, 'Subscription');
});

/**
 * Pause, resume or cancel.
 *
 * Written as explicit transitions rather than "set status to whatever was sent",
 * because the illegal moves matter: resuming a cancelled plan would revive
 * deliveries the customer already stopped, and cancelling twice would look like
 * two refunds owed.
 */
const ALLOWED = {
  // A customer may still back out of a request the seller hasn't answered
  // yet, but cannot self-activate it — only the seller's own accept
  // endpoint (or the accept sweeper, on timeout) moves it to ACTIVE.
  [SUBSCRIPTION_STATUS.PENDING_SELLER_ACCEPTANCE]: [SUBSCRIPTION_STATUS.CANCELLED],
  [SUBSCRIPTION_STATUS.ACTIVE]: [SUBSCRIPTION_STATUS.PAUSED, SUBSCRIPTION_STATUS.CANCELLED],
  [SUBSCRIPTION_STATUS.PAUSED]: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.CANCELLED],
  [SUBSCRIPTION_STATUS.CANCELLED]: [],
  [SUBSCRIPTION_STATUS.EXPIRED]: [],
};

// @desc    Pause / resume / cancel
// @route   PATCH /api/subscriptions/:id/status
// @access  Private
export const updateSubscriptionStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  const sub = await Subscription.findById(req.params.id);
  if (!sub) throw httpError(404, 'Subscription not found');
  if (String(sub.userId) !== String(req.user._id)) throw httpError(403, 'This is not your subscription');

  const allowed = ALLOWED[sub.status] || [];
  if (!allowed.includes(status)) {
    throw httpError(400, allowed.length
      ? `A ${sub.status} subscription can only become ${allowed.join(' or ')}`
      : `A ${sub.status} subscription cannot be changed`);
  }

  sub.status = status;

  if (status === SUBSCRIPTION_STATUS.CANCELLED) {
    /**
     * Stop what has not happened; keep what has.
     *
     * Delivered rows stay delivered — the history of the plan is the record of
     * what the customer actually received, and any refund conversation later
     * starts from exactly that. Money is not touched here: this phase does not
     * build a refund engine.
     */
    for (const d of sub.deliverySchedule) {
      if (d.status === 'scheduled') d.status = 'skipped';
    }
    sub.nextDeliveryDate = undefined;
  }

  if (status === SUBSCRIPTION_STATUS.ACTIVE) {
    const next = nextScheduledDeliveryDate(sub.deliverySchedule, sub.timeSlot);
    sub.nextDeliveryDate = next;
    if (!next) sub.status = SUBSCRIPTION_STATUS.EXPIRED;
  }

  await sub.save();
  return ok(res, sub, `Subscription ${sub.status}`);
});

/**
 * Cancel a subscription and flag (never execute) a refund, the same shape
 * `cancelOrderAndRestore` uses in order.controller.js. There is no stock or
 * coupon to restore here — a subscription never reserves stock — so this is
 * the money/status half of that pattern only.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export const cancelSubscriptionAndRestore = async (subscriptionId, { reason }) => {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) return { ok: false, reason: 'Subscription not found' };

  const allowed = ALLOWED[sub.status] || [];
  if (!allowed.includes(SUBSCRIPTION_STATUS.CANCELLED)) {
    return { ok: false, reason: `A ${sub.status} subscription cannot be cancelled` };
  }

  sub.status = SUBSCRIPTION_STATUS.CANCELLED;
  for (const d of sub.deliverySchedule) {
    if (d.status === 'scheduled') d.status = 'skipped';
  }
  sub.nextDeliveryDate = undefined;
  await sub.save();

  if (sub.paymentId) {
    const payment = await Payment.findById(sub.paymentId);
    // Flagged, not executed — the gateway refund is a separate job. Today
    // subscriptions are COD-only and a payment here is never actually
    // PAID, so this branch is dormant until online payment exists, but the
    // same discipline as the order-cancel path is followed regardless.
    if (payment && payment.status === PAYMENT_STATUS.PAID) {
      payment.refund = { amount: payment.amount, reason, status: 'pending' };
      await payment.save();
    }
  }

  try {
    const { emitToUser } = await import('../socket/rooms.js');
    emitToUser(sub.userId, 'subscription_status_updated', {
      subscriptionId: sub._id, status: sub.status, reason,
    });
    await notifyUser(sub.userId, {
      event: NOTIFICATION_EVENT.SUBSCRIPTION_STATUS_UPDATED,
      title: 'Subscription cancelled',
      message: reason,
      metadata: { subscriptionId: sub._id },
      route: '/subscriptions',
    });
  } catch (e) {
    console.error('[SUBSCRIPTION] cancel notify failed:', e.message);
  }

  return { ok: true, subscription: sub };
};

/**
 * Load the requesting vendor (Seller or SHG store) and confirm they own
 * this subscription.
 *
 * A subscription's `sellerId`/`shgStoreId` says which kind of vendor it
 * belongs to — this checks against whichever one is set, so the exact same
 * accept/decline/pack endpoints work unmodified for either. The routes stay
 * named "seller-accept" etc. (unchanged, so nothing already deployed
 * breaks) — they just no longer assume the vendor answering them is a
 * Seller.
 */
const requireOwningVendor = async (req, subscriptionId) => {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) throw httpError(404, 'Subscription not found');

  if (sub.sellerId) {
    const seller = await Seller.findOne({ userId: req.user._id, _id: sub.sellerId });
    if (!seller) throw httpError(403, 'This is not your subscription');
    return { vendor: seller, vendorKind: 'seller', sub };
  }
  if (sub.shgStoreId) {
    const shgStore = await SHGStore.findOne({ userId: req.user._id, _id: sub.shgStoreId });
    if (!shgStore) throw httpError(403, 'This is not your subscription');
    return { vendor: shgStore, vendorKind: 'shg', sub };
  }
  throw httpError(403, 'This is not your subscription');
};

// @desc    Vendor (Seller or SHG store) accepts a pending subscription request
// @route   POST /api/subscriptions/:id/seller-accept
// @access  Private (seller or SHG)
export const sellerAcceptSubscription = asyncHandler(async (req, res) => {
  const { sub } = await requireOwningVendor(req, req.params.id);

  // The winning condition lives in the filter, not in a read-then-write —
  // same idiom used throughout the rider offer/accept/expire work: a
  // stale accept arriving after the sweeper has already auto-cancelled
  // this same request simply fails to match, rather than reviving it.
  const updated = await Subscription.findOneAndUpdate(
    { _id: sub._id, status: SUBSCRIPTION_STATUS.PENDING_SELLER_ACCEPTANCE },
    { $set: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        nextDeliveryDate: nextScheduledDeliveryDate(sub.deliverySchedule, sub.timeSlot),
      } },
    { new: true }
  );

  if (!updated) {
    const current = await Subscription.findById(sub._id).select('status');
    throw httpError(409, `This request is already ${current?.status || 'resolved'} — it can no longer be accepted`);
  }

  try {
    const { emitToUser } = await import('../socket/rooms.js');
    emitToUser(updated.userId, 'subscription_status_updated', {
      subscriptionId: updated._id, status: updated.status,
    });
    await notifyUser(updated.userId, {
      event: NOTIFICATION_EVENT.SUBSCRIPTION_STATUS_UPDATED,
      title: 'Subscription confirmed',
      message: 'The store has accepted your subscription. Your first delivery is on its way as scheduled.',
      metadata: { subscriptionId: updated._id },
      route: '/subscriptions',
    });
  } catch (e) {
    console.error('[SUBSCRIPTION] accept notify failed:', e.message);
  }

  return ok(res, updated, 'Subscription accepted');
});

// @desc    Vendor (Seller or SHG store) declines a pending subscription request
// @route   POST /api/subscriptions/:id/seller-decline
// @access  Private (seller or SHG)
export const sellerDeclineSubscription = asyncHandler(async (req, res) => {
  const { sub } = await requireOwningVendor(req, req.params.id);
  if (sub.status !== SUBSCRIPTION_STATUS.PENDING_SELLER_ACCEPTANCE) {
    throw httpError(409, `This request is already ${sub.status} — it can no longer be declined`);
  }

  const result = await cancelSubscriptionAndRestore(sub._id, {
    reason: 'The store was unable to accept this subscription request',
  });
  if (!result.ok) throw httpError(409, result.reason);

  return ok(res, { status: 'cancelled' }, 'Subscription request declined');
});

// @desc    Vendor marks one scheduled delivery packed — creates the real
//          Order that the existing rider pipeline then dispatches
// @route   POST /api/subscriptions/:id/deliveries/:entryId/pack
// @access  Private (seller or SHG)
export const packSubscriptionDelivery = asyncHandler(async (req, res) => {
  const { vendor, vendorKind, sub } = await requireOwningVendor(req, req.params.id);
  if (sub.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw httpError(409, `This subscription is ${sub.status} — there is nothing to pack`);
  }

  // Atomically resolve the one schedule row — same arrayFilters idiom
  // declineOrder/expireOrder use on Order.offerAttempts. A row already
  // packed (a duplicate tap) or no longer scheduled simply fails to match.
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: sub._id,
      deliverySchedule: { $elemMatch: { _id: req.params.entryId, status: SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED } },
    },
    { $set: { 'deliverySchedule.$[row].status': SUBSCRIPTION_DELIVERY_STATUS.PACKED } },
    { new: true, arrayFilters: [{ 'row._id': req.params.entryId, 'row.status': SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED }] }
  );

  if (!updated) {
    const current = await Subscription.findOne(
      { _id: sub._id, 'deliverySchedule._id': req.params.entryId },
      { 'deliverySchedule.$': 1 }
    );
    const row = current?.deliverySchedule?.[0];
    throw httpError(409, row
      ? `This delivery is already ${row.status} — it can no longer be packed`
      : 'That scheduled delivery was not found');
  }

  const entry = updated.deliverySchedule.id(req.params.entryId);

  // Items resolved live, same pattern subscriptionBasket.controller.js uses
  // — never trust a months-old snapshot for name/price/stock.
  const ids = updated.customItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  // Return & Refund — Phase 3: this path builds its own Order.items
  // independently of createOrder/createOrdersFromGroups, so it needs the
  // same snapshot step. Resolved once per distinct category across the
  // whole delivery, same as the other two order-creation paths.
  const returnPolicyByCategory = await buildReturnPolicySnapshotsFor(products.map((p) => p.category));
  const nonReturnable = { headerCategoryId: null, headerCategoryName: null, returnEligible: false, returnWindowDays: null };
  // Every item on this path is CHANNEL.GROCERY (Quick) — the seller's own
  // `Product.returnable` opt-out is always folded in, same as the other two
  // order-creation paths (order.controller.js / fulfilmentOrders.service.js).
  const items = updated.customItems.map((i) => {
    const p = byId.get(String(i.productId));
    const catPolicy = p ? (returnPolicyByCategory.get(String(p.category)) || nonReturnable) : nonReturnable;
    const sellerReturnable = Boolean(p?.returnable);
    return {
      productId: i.productId,
      name: p?.name || 'Item',
      image: p?.images?.[0],
      qty: i.qty,
      price: p?.price || 0,
      sellerId: vendorKind === 'seller' ? vendor._id : undefined,
      shgStoreId: vendorKind === 'shg' ? vendor._id : undefined,
      type: CHANNEL.GROCERY,
      returnPolicy: { ...catPolicy, sellerReturnable, returnEligible: catPolicy.returnEligible && sellerReturnable },
    };
  });

  const order = await Order.create({
    userId: updated.userId,
    type: CHANNEL.GROCERY,
    deliveryType: 'internal',
    items,
    shippingAddress: updated.shippingAddress,
    pricing: {
      subtotal: updated.pricing.perDeliveryAmount,
      totalAmount: updated.pricing.perDeliveryAmount,
    },
    paymentMethod: PAYMENT_METHOD.COD,
    status: 'confirmed',
    subscriptionId: updated._id,
    subscriptionDeliveryEntryId: entry._id,
    timeline: [{ status: 'confirmed', timestamp: new Date(), note: 'Created from subscription — seller packed this delivery' }],
  });

  // Reuse the existing dispatch pipeline directly — the same call
  // cancelDelivery already makes to re-open a released order. Nothing
  // about deliveryPartner.controller.js changes for this to work.
  try {
    const { broadcastNewOrderToRiders } = await import('./deliveryPartner.controller.js');
    broadcastNewOrderToRiders(order._id).catch(console.error);
  } catch (e) {
    console.error('[SUBSCRIPTION] broadcast failed:', e.message);
  }

  return ok(res, { orderId: order._id, status: 'packed' }, 'Delivery packed — a rider is being found');
});

// @desc    Calculate subscription basket preview (schedule, pricing, weight, delivery fee)
// @route   POST /api/subscriptions/basket
// @access  Private
export const calculateSubscriptionBasket = asyncHandler(async (req, res) => {
  const {
    frequency = SUBSCRIPTION_FREQUENCY.DAILY,
    deliveryDay,
    deliveryMonthDate,
    timeSlot,
    startDate,
    customItems = [],
    shippingAddress,
  } = req.body;

  if (!Array.isArray(customItems) || customItems.length === 0) {
    throw httpError(400, 'Add at least one item to your subscription');
  }

  // ---- the items, read live rather than trusted from the request ----------
  const ids = customItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } })
    .populate('sellerId')
    .populate('shgStoreId')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = customItems.map((i) => ({
    productId: i.productId,
    qty: Number(i.qty),
    product: byId.get(String(i.productId)),
  }));

  assertSubscribable(lines);
  assertSingleVendor(lines.map((l) => l.product));
  const weightKg = assertWeightWithinLimit(lines);

  // ---- the calendar -------------------------------------------------------
  const duration = Number(req.body.duration || req.body.planDuration || 10);
  const dates = buildSchedule({ frequency, count: duration, startDate, deliveryDay });

  // ---- the money ----------------------------------------------------------
  const pricing = priceSubscription(lines, dates.length, req.user);

  // ---- distance-based delivery fee calculation -----------------------------
  // An SHGStore has no pinned location today (unlike Seller.storeDetails),
  // so `sellerPoint` simply stays null for an SHG-fulfilled basket and the
  // flat fallback below applies — same as a Seller with no location pinned.
  const firstProduct = products[0];
  const seller = firstProduct?.sellerId;
  const sellerPoint = seller?.storeDetails?.lat != null && seller?.storeDetails?.lng != null
    ? { lat: Number(seller.storeDetails.lat), lng: Number(seller.storeDetails.lng) }
    : null;

  const customerPoint = shippingAddress?.lat != null && shippingAddress?.lng != null
    ? { lat: Number(shippingAddress.lat), lng: Number(shippingAddress.lng) }
    : null;

  const distKm = distanceKm(sellerPoint, customerPoint);

  // Delivery fee calculation matching frontend TIERS:
  let deliveryFeePerDelivery = 40; // Default flat rate
  if (distKm != null) {
    if (distKm <= 3) {
      deliveryFeePerDelivery = 20;
    } else if (distKm <= 7) {
      deliveryFeePerDelivery = 35;
    } else if (distKm <= 12) {
      deliveryFeePerDelivery = 50;
    } else {
      deliveryFeePerDelivery = 70;
    }
  }

  const deliveryFeeTotal = deliveryFeePerDelivery * dates.length;
  const totalAmount = pricing.finalAmount + deliveryFeeTotal;

  return ok(res, {
    weightKg,
    schedule: dates,
    pricing: {
      perDelivery: pricing.perDelivery,
      deliveries: dates.length,
      productsSubtotal: pricing.totalAmount,
      cdsDiscount: pricing.cdsDiscount,
      cdsPercent: pricing.cdsPercent,
      deliveryDistanceKm: distKm,
      deliveryFeePerDelivery,
      deliveryFeeTotal,
      totalAmount,
    }
  }, 'Subscription calculation preview');
});
