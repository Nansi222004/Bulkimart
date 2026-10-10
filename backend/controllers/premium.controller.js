import mongoose from 'mongoose';
import PremiumPlan from '../models/PremiumPlan.js';
import PremiumMembership from '../models/PremiumMembership.js';
import Payment from '../models/Payment.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import {
  createPayment, getOrderStatus, rupeesToPaise, isConfigured,
} from '../services/phonepe.service.js';
import { PAYMENT_STATUS } from '../constants/enums.js';
import { getActivePremiumMembership, expiryFrom } from '../services/premium.service.js';

/**
 * Premium Membership — the entitlement that lets a customer create Product
 * Subscriptions.
 *
 * Mirrors shgSubscription.controller.js exactly, because it is the same
 * problem for a different audience: a time-limited plan bought through the
 * existing PhonePe integration, activated only by an idempotent settle that
 * runs inside a transaction and only ever moves a payment forward once.
 * Nothing here creates a second payment mechanism, a second scheduler, or a
 * second subscription system — the recurring-delivery flow in
 * subscription.controller.js is untouched and simply gated on this.
 */

// @desc    Plans a customer can buy
// @route   GET /api/premium/plans
// @access  Private
export const getActivePremiumPlans = asyncHandler(async (req, res) => {
  const plans = await PremiumPlan.find({ isActive: true }).sort({ durationMonths: 1 });
  return ok(res, plans, 'Premium plans');
});

// @desc    This customer's membership + effective-active flag
// @route   GET /api/premium/me
// @access  Private
export const getMyPremiumMembership = asyncHandler(async (req, res) => {
  const latest = await PremiumMembership.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
  const active = await getActivePremiumMembership(req.user._id);

  return ok(res, {
    // The frontend must never decide this for itself — it renders what this says.
    isPremium: Boolean(active),
    membership: active
      ? {
          _id: active._id,
          planName: active.planName,
          durationMonths: active.durationMonths,
          amount: active.amount,
          startsAt: active.startsAt,
          expiresAt: active.expiresAt,
          status: active.status,
        }
      // No active membership: the latest attempt is still worth reporting, so
      // an expired one can be shown as "Premium Expired" rather than as
      // "never had it".
      : (latest
          ? {
              _id: latest._id,
              planName: latest.planName,
              durationMonths: latest.durationMonths,
              amount: latest.amount,
              startsAt: latest.startsAt,
              expiresAt: latest.expiresAt,
              status: latest.expiresAt && latest.expiresAt < new Date() && latest.status === 'active'
                ? 'expired'
                : latest.status,
            }
          : null),
  }, 'Premium status');
});

/**
 * Move a PremiumMembership to active/failed exactly once.
 *
 * Idempotency lives in two places on purpose: the early return for an
 * already-PAID payment, and the re-read inside the transaction — so a
 * webhook redelivered while the first one is still committing cannot
 * activate a second time or extend an expiry twice.
 */
const settlePremiumPayment = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  if (payment.status === PAYMENT_STATUS.PAID) return { changed: false, status: 'paid' };

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };

  try {
    await session.withTransaction(async () => {
      const freshPayment = await Payment.findById(payment._id).session(session);
      if (!freshPayment || freshPayment.status === PAYMENT_STATUS.PAID) return;

      const membership = await PremiumMembership.findById(freshPayment.premiumMembershipId).session(session);
      if (!membership) return;

      if (state === 'COMPLETED') {
        freshPayment.status = PAYMENT_STATUS.PAID;
        freshPayment.paidAt = new Date();
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await freshPayment.save({ session });

        // Membership starts when the money is confirmed, not when the
        // customer opened the plan chooser.
        const startsAt = new Date();
        membership.status = 'active';
        membership.startsAt = startsAt;
        membership.expiresAt = expiryFrom(startsAt, membership.durationMonths);
        await membership.save({ session });

        try {
          const { default: Notification } = await import('../models/Notification.js');
          await Notification.create([{
            userId: membership.userId,
            type: 'membership',
            title: 'Premium activated',
            message: `Your ${membership.planName} Premium Membership is active until ${membership.expiresAt.toDateString()}.`,
          }], { session });
        } catch (err) {
          console.error('[PREMIUM] activation notification failed:', err.message);
        }

        result = { changed: true, status: 'paid' };
      } else if (state === 'FAILED') {
        freshPayment.status = PAYMENT_STATUS.FAILED;
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, errorCode };
        await freshPayment.save({ session });
        // membership.status stays 'payment_pending' — never active — so a
        // failed or abandoned payment grants nothing, and the customer can
        // retry without losing the plan/amount snapshot.
        result = { changed: true, status: 'failed' };
      }
    });
  } finally {
    await session.endSession();
  }

  return result;
};

// exported so payment.controller.js's shared webhook can branch into it
export { settlePremiumPayment };

// @desc    Start payment for a Premium plan
// @route   POST /api/premium/purchase
// @access  Private
export const purchasePremium = asyncHandler(async (req, res) => {
  if (!isConfigured()) throw httpError(503, 'Online payment is not available right now');

  const { planId } = req.body;
  if (!planId) throw httpError(400, 'planId is required');

  // The plan is loaded from the database and the amount taken from it — the
  // client sends an id and nothing else that touches money.
  const plan = await PremiumPlan.findById(planId);
  if (!plan || !plan.isActive) throw httpError(400, 'Selected plan is not available');

  // An active membership already entitles them to create as many Product
  // Subscriptions as they like, so there is nothing to sell here.
  const existingActive = await getActivePremiumMembership(req.user._id);
  if (existingActive) {
    throw httpError(400, `You already have Premium until ${existingActive.expiresAt.toDateString()}`);
  }

  const membership = await PremiumMembership.create({
    userId: req.user._id,
    planId: plan._id,
    planName: plan.name,
    durationMonths: plan.durationMonths,
    amount: plan.price,
    status: 'payment_pending',
  });

  const payment = await Payment.create({
    userId: req.user._id,
    premiumMembershipId: membership._id,
    amount: plan.price,
    method: 'online',
    status: PAYMENT_STATUS.PENDING,
  });

  await PremiumMembership.updateOne({ _id: membership._id }, { $set: { paymentId: payment._id } });

  const merchantOrderId = `PREMIUM-${membership._id}-A1`;
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/premium/return/${merchantOrderId}`;

  const gw = await createPayment({
    merchantOrderId,
    amountPaise: rupeesToPaise(plan.price),
    redirectUrl,
    message: `Bulkimart Premium Membership — ${plan.name}`,
  });

  payment.attempts = 1;
  payment.gateway = { provider: 'phonepe', merchantOrderId, orderId: gw.orderId, initiatedAt: new Date() };
  await payment.save();

  return created(res, {
    redirectUrl: gw.redirectUrl,
    merchantOrderId,
    expireAt: gw.expireAt,
    amount: plan.price,
  }, 'Redirecting to PhonePe');
});

// @desc    Where PhonePe sends the customer back
// @route   GET /api/premium/return/:merchantOrderId
// @access  Public
export const premiumPaymentReturn = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': merchantOrderId });

  let status = 'unknown';
  if (payment) {
    try {
      // The browser coming back is not evidence of payment — ask PhonePe.
      const live = await getOrderStatus(merchantOrderId);
      const settled = await settlePremiumPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  // Straight back to the basket they left, which is still on the server —
  // no step is repeated and nothing has to be rebuilt.
  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  return res.redirect(`${app}/basket?premiumPayment=${encodeURIComponent(status)}`);
});

// @desc    Poll a premium payment's status from the app
// @route   GET /api/premium/payment-status/:merchantOrderId
// @access  Private
export const getPremiumPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': req.params.merchantOrderId });
  if (!payment) throw httpError(404, 'Payment not found');
  if (String(payment.userId) !== String(req.user._id)) throw httpError(403, 'Not your payment');

  if (payment.status === PAYMENT_STATUS.PENDING && payment.gateway?.merchantOrderId) {
    try {
      const live = await getOrderStatus(payment.gateway.merchantOrderId);
      await settlePremiumPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
    } catch { /* fall through to the stored status */ }
  }

  const fresh = await Payment.findById(payment._id);
  const membership = await PremiumMembership.findById(fresh.premiumMembershipId);
  return ok(res, {
    status: fresh.status,
    amount: fresh.amount,
    paidAt: fresh.paidAt,
    membershipStatus: membership?.status,
    expiresAt: membership?.expiresAt,
  });
});

/* ============================================================================
 * ADMIN — plan catalog management
 *
 * Handlers live here for domain cohesion; they are registered in
 * admin.routes.js behind `protect, requireAdmin`, the same way coupon
 * handlers live in coupon.controller.js and are wired through the admin
 * router. A customer route never reaches these.
 * ========================================================================== */

// @desc    Every plan, active or not
// @route   GET /api/admin/premium-plans
// @access  Private/Admin
export const listPremiumPlansForAdmin = asyncHandler(async (req, res) => {
  const plans = await PremiumPlan.find({}).sort({ durationMonths: 1 });
  return ok(res, plans, 'Premium plans');
});

// @desc    Add a plan to the catalog
// @route   POST /api/admin/premium-plans
// @access  Private/Admin
export const createPremiumPlan = asyncHandler(async (req, res) => {
  const { name, durationMonths, price, isActive } = req.body;
  if (!name || durationMonths === undefined || price === undefined) {
    throw httpError(400, 'name, durationMonths and price are required');
  }
  if (Number(durationMonths) < 1) throw httpError(400, 'durationMonths must be at least 1');
  if (Number(price) < 0) throw httpError(400, 'price cannot be negative');

  const plan = await PremiumPlan.create({
    name,
    durationMonths: Number(durationMonths),
    price: Number(price),
    isActive: isActive === undefined ? true : Boolean(isActive),
  });

  return created(res, plan, 'Plan created');
});

/**
 * @desc    Edit a plan — price, name, duration or availability
 * @route   PATCH /api/admin/premium-plans/:id
 * @access  Private/Admin
 *
 * Only ever changes what future purchases will cost. Memberships already
 * bought carry their own snapshot (see PremiumMembership.js) and are not
 * touched here — no query in this handler reaches them.
 */
export const updatePremiumPlan = asyncHandler(async (req, res) => {
  const plan = await PremiumPlan.findById(req.params.id);
  if (!plan) throw httpError(404, 'Plan not found');

  const { name, durationMonths, price, isActive } = req.body;
  if (name !== undefined) plan.name = name;
  if (durationMonths !== undefined) {
    if (Number(durationMonths) < 1) throw httpError(400, 'durationMonths must be at least 1');
    plan.durationMonths = Number(durationMonths);
  }
  if (price !== undefined) {
    if (Number(price) < 0) throw httpError(400, 'price cannot be negative');
    plan.price = Number(price);
  }
  if (isActive !== undefined) plan.isActive = Boolean(isActive);

  await plan.save();
  return ok(res, plan, 'Plan updated');
});
