import mongoose from 'mongoose';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import SHGSubscription from '../models/SHGSubscription.js';
import Payment from '../models/Payment.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import {
  createPayment, getOrderStatus, verifyWebhookSignature, parseWebhookEvent,
  rupeesToPaise, isConfigured,
} from '../services/phonepe.service.js';
import { PAYMENT_STATUS } from '../constants/enums.js';
import { getActiveShgSubscription } from '../services/shgSubscription.service.js';

/**
 * SHG business-subscription purchase, mirroring payment.controller.js's
 * PhonePe pattern exactly (same idempotent settle-on-first-signal shape),
 * but for a domain that has no `Order` at all — a plan purchase, not a
 * marketplace order. Deliberately NOT reusing payment.controller.js's own
 * `settle()`, which is hardwired to `Order.updateMany` — that function is
 * untouched; this is its sibling for a different payment purpose.
 */

// @desc    Active plans a seller can buy
// @route   GET /api/shg-subscriptions/plans
// @access  Private (approved SHG)
export const getActivePlans = asyncHandler(async (req, res) => {
  const plans = await SubscriptionPlan.find({ isActive: true }).sort({ durationMonths: 1 });
  return ok(res, plans, 'Subscription plans');
});

// @desc    This SHG's latest subscription + effective-active flag
// @route   GET /api/shg-subscriptions/me
// @access  Private (approved SHG)
export const getMySubscription = asyncHandler(async (req, res) => {
  const store = req.shgStore;
  const latest = await SHGSubscription.findOne({ shgStoreId: store._id }).sort({ createdAt: -1 });
  const active = await getActiveShgSubscription(store._id);
  return ok(res, {
    subscription: latest,
    isActive: Boolean(active),
  }, 'Subscription status');
});

/** Move an SHGSubscription to active/failed exactly once — same idempotency shape as payment.controller.js's settle(). */
const settleShgSubscriptionPayment = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  if (payment.status === PAYMENT_STATUS.PAID) return { changed: false, status: 'paid' };

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };

  try {
    await session.withTransaction(async () => {
      const freshPayment = await Payment.findById(payment._id).session(session);
      if (!freshPayment || freshPayment.status === PAYMENT_STATUS.PAID) return;

      const sub = await SHGSubscription.findById(freshPayment.shgSubscriptionId).session(session);
      if (!sub) return;

      if (state === 'COMPLETED') {
        freshPayment.status = PAYMENT_STATUS.PAID;
        freshPayment.paidAt = new Date();
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await freshPayment.save({ session });

        // Renewing before expiry extends from the current endDate rather
        // than restarting from today, so a seller who renews early never
        // loses the days they already paid for.
        const now = new Date();
        const base = sub.endDate && sub.endDate > now ? sub.endDate : now;
        const endDate = new Date(base);
        endDate.setMonth(endDate.getMonth() + sub.durationMonths);

        sub.status = 'active';
        sub.startDate = sub.startDate || now;
        sub.endDate = endDate;
        await sub.save({ session });

        try {
          const { default: Notification } = await import('../models/Notification.js');
          const { default: SHGStore } = await import('../models/SHGStore.js');
          const store = await SHGStore.findById(sub.shgStoreId).session(session);
          if (store) {
            await Notification.create([{
              userId: store.userId,
              type: 'membership',
              title: 'Subscription activated',
              message: `Your ${sub.planName} plan is now active, valid until ${endDate.toDateString()}.`,
            }], { session });
          }
        } catch (err) {
          console.error('[SHG SUBSCRIPTION] activation notification failed:', err.message);
        }

        result = { changed: true, status: 'paid' };
      } else if (state === 'FAILED') {
        freshPayment.status = PAYMENT_STATUS.FAILED;
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, errorCode };
        await freshPayment.save({ session });
        // sub.status stays 'payment_pending' — the seller can retry the
        // same purchase without losing the plan/amount snapshot.
        result = { changed: true, status: 'failed' };
      }
    });
  } finally {
    await session.endSession();
  }

  return result;
};

// exported so payment.controller.js's shared webhook can branch into it
export { settleShgSubscriptionPayment };

// @desc    Start payment for a subscription plan
// @route   POST /api/shg-subscriptions/purchase
// @access  Private (approved SHG)
export const purchaseSubscription = asyncHandler(async (req, res) => {
  if (!isConfigured()) throw httpError(503, 'Online payment is not available right now');

  const { planId } = req.body;
  if (!planId) throw httpError(400, 'planId is required');

  const plan = await SubscriptionPlan.findById(planId);
  if (!plan || !plan.isActive) throw httpError(400, 'Selected plan is not available');

  const store = req.shgStore;

  // Prevent duplicate/ambiguous active subscriptions — a seller who already
  // has a live, unexpired plan must renew it (handled by the extend-from-
  // endDate logic in settleShgSubscriptionPayment), not stack a second one.
  const existingActive = await getActiveShgSubscription(store._id);
  if (existingActive) {
    throw httpError(400, `You already have an active subscription until ${existingActive.endDate.toDateString()}`);
  }

  // Amount/duration are always resolved from the plan document just loaded
  // above — never from anything the client sent beyond planId.
  const sub = await SHGSubscription.create({
    shgStoreId: store._id,
    planId: plan._id,
    planName: plan.name,
    durationMonths: plan.durationMonths,
    amount: plan.price,
    status: 'payment_pending',
  });

  const payment = await Payment.create({
    userId: req.user._id,
    shgSubscriptionId: sub._id,
    amount: plan.price,
    method: 'online',
    status: PAYMENT_STATUS.PENDING,
  });

  await SHGSubscription.updateOne({ _id: sub._id }, { $set: { paymentId: payment._id } });

  const merchantOrderId = `SHGSUB-${sub._id}-A1`;
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/shg-subscriptions/return/${merchantOrderId}`;

  const gw = await createPayment({
    merchantOrderId,
    amountPaise: rupeesToPaise(plan.price),
    redirectUrl,
    message: `Bulkimart SHG subscription — ${plan.name}`,
  });

  payment.attempts = 1;
  payment.gateway = { provider: 'phonepe', merchantOrderId, orderId: gw.orderId, initiatedAt: new Date() };
  await payment.save();

  return ok(res, {
    redirectUrl: gw.redirectUrl,
    merchantOrderId,
    expireAt: gw.expireAt,
    amount: plan.price,
  }, 'Redirecting to PhonePe');
});

// @desc    Where PhonePe sends the seller back
// @route   GET /api/shg-subscriptions/return/:merchantOrderId
// @access  Public
export const subscriptionPaymentReturn = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': merchantOrderId });

  let status = 'unknown';
  if (payment) {
    try {
      const live = await getOrderStatus(merchantOrderId);
      const settled = await settleShgSubscriptionPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  return res.redirect(`${app}/shg?subscriptionPayment=${encodeURIComponent(status)}`);
});

// @desc    Poll a subscription payment's status from the app
// @route   GET /api/shg-subscriptions/payment-status/:merchantOrderId
// @access  Private (approved SHG)
export const getSubscriptionPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': req.params.merchantOrderId });
  if (!payment) throw httpError(404, 'Payment not found');
  if (String(payment.userId) !== String(req.user._id)) throw httpError(403, 'Not your payment');

  if (payment.status === PAYMENT_STATUS.PENDING && payment.gateway?.merchantOrderId) {
    try {
      const live = await getOrderStatus(payment.gateway.merchantOrderId);
      await settleShgSubscriptionPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
    } catch { /* fall through to the stored status */ }
  }

  const fresh = await Payment.findById(payment._id);
  const sub = await SHGSubscription.findById(fresh.shgSubscriptionId);
  return ok(res, {
    status: fresh.status,
    amount: fresh.amount,
    paidAt: fresh.paidAt,
    subscriptionStatus: sub?.status,
    endDate: sub?.endDate,
  });
});
