import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import {
  createPayment as createPhonePePayment,
  getOrderStatus as getPhonePeOrderStatus,
  verifyWebhookSignature as verifyPhonePeWebhookSignature,
  parseWebhookEvent as parsePhonePeWebhookEvent,
  rupeesToPaise, isConfigured as isPhonePeConfigured, setMockPaymentState,
} from '../services/phonepe.service.js';
import {
  createRazorpayOrder,
  getRazorpayPaymentStatus,
  parseRazorpayWebhookEvent,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from '../services/razorpay.service.js';
import { getPaymentGateway } from '../config/runtime.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../constants/enums.js';
import { settleSellerPromotionPayment } from './sellerPromotion.controller.js';
import { settlePackagingOrderPayment } from './packaging.controller.js';
import { settleWalletTopupPayment } from './wallet.controller.js';
import { settleRazorpayRefundWebhook } from '../services/return.service.js';
import { redeemReservedCoins, releaseReservedCoins } from '../services/coin.service.js';
import { COIN_REFERENCE_TYPE } from '../constants/enums.js';

/**
 * PhonePe payments.
 *
 * The browser's return trip is only a UX cue — it is never what marks an order
 * paid. A shopper can close the tab before being redirected, or hit the return
 * URL by hand. Money is confirmed by exactly two things:
 *   - the signed webhook PhonePe posts to us, or
 *   - a server-to-server status check we make ourselves.
 */

/** Move an order to paid/failed exactly once, whichever signal arrives first. */
export const settle = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  /**
   * Idempotent: the webhook and the status poll routinely both arrive, for
   * either outcome. A payment only ever leaves PENDING once — PAID and
   * FAILED are both terminal — so "already left PENDING" (not just
   * "already PAID") is what actually makes every side effect below safe to
   * skip on a repeat. This used to check PAID only; re-running the FAILED
   * branch a second time was harmless back when it just re-wrote the same
   * status, but the Coins release added below (Section 12/13/14) is not
   * naturally idempotent the same way — releasing an already-released
   * reservation legitimately has nothing left to release, so it must never
   * be attempted twice.
   */
  if (payment.status !== PAYMENT_STATUS.PENDING) return { changed: false, status: payment.status };

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };

  try {
    await session.withTransaction(async () => {
      const fresh = await Payment.findById(payment._id).session(session);
      if (!fresh || fresh.status !== PAYMENT_STATUS.PENDING) return;

      if (state === 'COMPLETED') {
        fresh.status = PAYMENT_STATUS.PAID;
        fresh.paidAt = new Date();
        fresh.gateway = { ...(fresh.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await fresh.save({ session });

        /**
         * Confirm everything this payment covers, not just the first order.
         *
         * A unified checkout takes one payment for several fulfilment orders.
         * This confirmed `fresh.orderId` alone, so the other orders would have
         * sat at `placed` after the customer had already paid — unpaid-looking,
         * never dispatched, and eventually swept away by the acceptance timer.
         *
         * `updateMany` over the group when there is one; the identical
         * single-order update when there is not, which is every payment taken
         * so far. The `status: PLACED` guard is unchanged and still makes this
         * idempotent — the webhook and the status poll routinely both arrive.
         */
        const target = fresh.groupRef
          ? { groupRef: fresh.groupRef, status: ORDER_STATUS.PLACED }
          : (fresh.orderId ? { _id: fresh.orderId, status: ORDER_STATUS.PLACED } : null);

        if (target) {
          await Order.updateMany(
            target,
            {
              $set: { status: ORDER_STATUS.CONFIRMED },
              $push: { timeline: { status: ORDER_STATUS.CONFIRMED, note: 'Payment received', timestamp: new Date() } },
            },
            { session }
          );
        }

        /**
         * NHCONE Coins — RESERVED -> REDEEMED, exactly once, in the same
         * transaction as the order confirmation above. `fresh.coinsUsed` is
         * 0 on every payment that never used Coins (every payment before
         * this field existed, included), so this is a no-op for them.
         * Guarded by the same outer `payment.status !== PENDING` idempotency
         * this function already relies on — a repeated webhook/status-poll
         * never reaches this a second time for the same payment.
         */
        if (fresh.coinsUsed > 0 && fresh.orderId) {
          await redeemReservedCoins({
            userId: fresh.userId, amount: fresh.coinsUsed,
            referenceType: COIN_REFERENCE_TYPE.ORDER, referenceId: String(fresh.orderId),
            idempotencyKey: `REDEEM:${fresh.orderId}`,
            description: `Coins used on order ${fresh.orderId}`,
            session,
          });
        }

        const targetOrder = fresh.groupRef
          ? await Order.findOne({ groupRef: fresh.groupRef }).sort({ createdAt: 1 }).session(session)
          : (fresh.orderId ? await Order.findById(fresh.orderId).session(session) : null);

        result = { changed: true, status: 'paid' };
      } else if (state === 'FAILED') {
        fresh.status = PAYMENT_STATUS.FAILED;
        fresh.gateway = { ...(fresh.gateway || {}), orderId: gatewayOrderId, errorCode };
        await fresh.save({ session });
        // The order is left as `placed` on purpose — the shopper can retry
        // without rebuilding the cart. Cancelling it would return the stock.

        // NHCONE Coins — RESERVED -> AVAILABLE. The customer gets their
        // Coins back; nothing about the cash/order retry logic above changes.
        if (fresh.coinsUsed > 0 && fresh.orderId) {
          await releaseReservedCoins({
            userId: fresh.userId, amount: fresh.coinsUsed,
            referenceType: COIN_REFERENCE_TYPE.ORDER, referenceId: String(fresh.orderId),
            idempotencyKey: `RELEASE:${fresh.orderId}`,
            description: `Payment failed for order ${fresh.orderId} — Coins released`,
            session,
          });
        }
        result = { changed: true, status: 'failed' };
      }
    });
  } finally {
    await session.endSession();
  }

  return result;
};

// @desc    Start an online payment for an existing order
// @route   POST /api/payments/initiate
// @access  Private
export const initiatePayment = asyncHandler(async (req, res) => {
  const provider = getPaymentGateway();
  if (provider === 'phonepe' && !isPhonePeConfigured()) {
    throw httpError(503, 'Online payment is not available right now');
  }

  const { orderId } = req.body;
  if (!orderId) throw httpError(400, 'orderId is required');

  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (String(order.userId) !== String(req.user._id)) {
    throw httpError(403, 'This is not your order');
  }
  if (order.status !== ORDER_STATUS.PLACED) {
    throw httpError(400, `This order is already ${order.status}`);
  }

  const payment = await Payment.findById(order.paymentId);
  if (!payment) throw httpError(404, 'Payment record not found for this order');
  if (payment.status === PAYMENT_STATUS.PAID) throw httpError(400, 'This order is already paid');
  if (payment.method === 'cod') throw httpError(400, 'This is a cash-on-delivery order');

  /**
   * Charge for everything this payment covers.
   *
   * On an ordinary order that is the order's own total, exactly as before. On a
   * unified checkout the payment spans several fulfilment orders, and taking
   * only this one's total would undercharge by the rest of the basket — the
   * customer would pay for one delivery and receive three.
   *
   * The stored `payment.amount` is what checkout worked out across the group, so
   * it is the figure to charge; the sum is recomputed here only to catch a
   * disagreement rather than to replace it.
   */
  let amountRupees = order.pricing.totalAmount;
  if (payment.groupRef) {
    const group = await Order.find({ groupRef: payment.groupRef }).select('pricing.totalAmount').lean();
    const summed = group.reduce((t, o) => t + (o.pricing?.totalAmount || 0), 0);
    if (Math.abs(summed - payment.amount) > 0.5) {
      console.warn(`[payment] group ${payment.groupRef}: orders sum to ${summed}, payment says ${payment.amount}`);
    }
    amountRupees = payment.amount;
  }

  // A fresh attempt id per try: PhonePe rejects a reused merchantOrderId, and a
  // shopper who abandons the page must be able to start again. Derived from this
  // order's number even for a group — it is already unique and traceable, and
  // inventing a second id scheme would be one more thing to keep unique.
  const attempt = (payment.attempts || 0) + 1;
  const merchantOrderId = `${order.orderNo}-A${attempt}`;

  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/payments/return/${merchantOrderId}`;

  const amountPaise = rupeesToPaise(amountRupees);
  const gw = provider === 'razorpay'
    ? await createRazorpayOrder({
        merchantOrderId,
        amountPaise,
        notes: { bulkimartOrderId: String(order._id), orderNo: order.orderNo },
      })
    : await createPhonePePayment({
        merchantOrderId,
        amountPaise,
        redirectUrl,
        message: `Bulkimart order ${order.orderNo}`,
      });

  payment.attempts = attempt;
  payment.gateway = {
    provider,
    merchantOrderId,
    orderId: gw.orderId,
    initiatedAt: new Date(),
  };
  payment.status = PAYMENT_STATUS.PENDING;
  await payment.save();

  return ok(res, provider === 'razorpay' ? {
    provider,
    keyId: gw.keyId,
    razorpayOrderId: gw.orderId,
    merchantOrderId,
    orderId: String(order._id),
    amountPaise: gw.amountPaise,
    currency: gw.currency,
    name: 'Bulkimart',
    description: `Bulkimart order ${order.orderNo}`,
  } : {
    provider,
    redirectUrl: gw.redirectUrl,
    merchantOrderId,
    expireAt: gw.expireAt,
    amount: order.pricing.totalAmount,
  }, provider === 'razorpay' ? 'Razorpay checkout ready' : 'Redirecting to PhonePe');
});

// @desc    PhonePe server-to-server callback — the source of truth
// @route   POST /api/payments/webhook
// @access  Public (verified by signature, NOT by session)
export const phonepeWebhook = asyncHandler(async (req, res) => {
  if (getPaymentGateway() !== 'phonepe') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  const check = verifyPhonePeWebhookSignature(req.headers.authorization);
  if (!check.ok) {
    // Do not leak which part failed, and never act on an unverified event.
    console.warn('[phonepe webhook] rejected:', check.reason);
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const evt = parsePhonePeWebhookEvent(req.body);
  if (!evt.merchantOrderId) {
    return res.status(200).json({ success: true, message: 'Ignored — no merchantOrderId' });
  }

  const payment = await Payment.findOne({ 'gateway.merchantOrderId': evt.merchantOrderId });
  if (!payment) {
    // 200 on purpose: a non-2xx makes PhonePe retry an event we can never match.
    console.warn('[phonepe webhook] unknown merchantOrderId', evt.merchantOrderId);
    return res.status(200).json({ success: true, message: 'Unknown order' });
  }

  if (evt.kind === 'payment_completed' || evt.kind === 'payment_failed') {
    const state = evt.kind === 'payment_completed' ? 'COMPLETED' : 'FAILED';
    // Several active payment purposes share this webhook endpoint because
    // PhonePe only calls back to a single configured URL.
    if (payment.sellerPromotionId) {
      await settleSellerPromotionPayment({
        payment, state, gatewayOrderId: evt.orderId, paymentDetails: evt.paymentDetails, errorCode: evt.errorCode,
      });
    } else if (payment.packagingOrderId) {
      await settlePackagingOrderPayment({
        payment, state, gatewayOrderId: evt.orderId, paymentDetails: evt.paymentDetails, errorCode: evt.errorCode,
      });
    } else if (payment.isWalletTopup) {
      await settleWalletTopupPayment({
        payment, state, gatewayOrderId: evt.orderId, paymentDetails: evt.paymentDetails, errorCode: evt.errorCode,
      });
    } else {
      await settle({
        payment,
        state,
        gatewayOrderId: evt.orderId,
        paymentDetails: evt.paymentDetails,
        errorCode: evt.errorCode,
      });
    }
  }

  // Always acknowledge a verified event, or PhonePe keeps redelivering it.
  return res.status(200).json({ success: true });
});

// @desc    Razorpay server-to-server webhook; raw-body signature is mandatory
// @route   POST /api/payments/razorpay/webhook
// @access  Public (verified cryptographically, never by browser state)
export const razorpayWebhook = asyncHandler(async (req, res) => {
  if (getPaymentGateway() !== 'razorpay') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  const signature = req.get('x-razorpay-signature');
  if (!verifyRazorpayWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const evt = parseRazorpayWebhookEvent(req.body);
  if (['refund_completed', 'refund_failed'].includes(evt.kind)) {
    await settleRazorpayRefundWebhook({
      refundId: evt.refundId,
      state: evt.kind === 'refund_completed' ? 'COMPLETED' : 'FAILED',
      errorCode: evt.errorCode,
    });
    return res.status(200).json({ success: true });
  }
  if (!evt.gatewayOrderId || !['payment_completed', 'payment_failed'].includes(evt.kind)) {
    return res.status(200).json({ success: true, message: 'Ignored event' });
  }

  const payment = await Payment.findOne({
    'gateway.provider': 'razorpay',
    'gateway.orderId': evt.gatewayOrderId,
  });
  if (!payment) return res.status(200).json({ success: true, message: 'Unknown order' });

  if (evt.amountPaise && evt.amountPaise !== rupeesToPaise(payment.amount)) {
    return res.status(400).json({ success: false, message: 'Payment amount mismatch' });
  }

  await settle({
    payment,
    state: evt.kind === 'payment_completed' ? 'COMPLETED' : 'FAILED',
    gatewayOrderId: evt.gatewayOrderId,
    paymentDetails: evt.paymentDetails,
    errorCode: evt.errorCode,
  });

  if (evt.paymentId) {
    await Payment.updateOne(
      { _id: payment._id, 'gateway.paymentId': { $ne: evt.paymentId } },
      { $set: { 'gateway.paymentId': evt.paymentId } },
    );
  }
  return res.status(200).json({ success: true });
});

// @desc    Verify Razorpay Checkout result and reconcile against Razorpay
// @route   POST /api/payments/razorpay/verify
// @access  Private
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  if (getPaymentGateway() !== 'razorpay') throw httpError(404, 'Not found');
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw httpError(400, 'Incomplete Razorpay verification payload');
  }

  const order = await Order.findById(orderId);
  if (!order || String(order.userId) !== String(req.user._id)) throw httpError(404, 'Order not found');
  const payment = await Payment.findById(order.paymentId);
  if (!payment || payment.gateway?.provider !== 'razorpay') throw httpError(404, 'Payment not found');
  if (payment.gateway?.orderId !== razorpay_order_id) throw httpError(400, 'Razorpay order mismatch');

  const signatureValid = verifyRazorpayPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!signatureValid) throw httpError(401, 'Payment verification failed');

  const live = await getRazorpayPaymentStatus({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  if (live.orderId !== razorpay_order_id
      || live.amountPaise !== rupeesToPaise(payment.amount)
      || live.currency !== 'INR') {
    throw httpError(400, 'Razorpay payment details do not match the order');
  }

  const settled = await settle({
    payment,
    state: live.state,
    gatewayOrderId: razorpay_order_id,
    paymentDetails: live.paymentDetails,
    errorCode: live.errorCode,
  });
  await Payment.updateOne(
    { _id: payment._id },
    { $set: { 'gateway.paymentId': razorpay_payment_id, 'gateway.signatureVerifiedAt': new Date() } },
  );

  return ok(res, { status: settled.status },
    live.state === 'COMPLETED' ? 'Payment verified' : 'Payment is not completed');
});

// @desc    Where PhonePe sends the shopper back
// @route   GET /api/payments/return/:merchantOrderId
// @access  Public
export const paymentReturn = asyncHandler(async (req, res) => {
  if (getPaymentGateway() !== 'phonepe') throw httpError(404, 'Not found');
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': merchantOrderId });

  let status = 'unknown';

  if (payment) {
    // The webhook may not have landed yet, so ask PhonePe directly rather than
    // trusting anything in this request.
    try {
      const live = await getPhonePeOrderStatus(merchantOrderId);
      const settled = await settle({
        payment,
        state: live.state,
        gatewayOrderId: live.orderId,
        paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  const order = payment?.orderId ? await Order.findById(payment.orderId, 'orderNo') : null;

  return res.redirect(
    `${app}/orders?payment=${encodeURIComponent(status)}` +
    (order ? `&order=${encodeURIComponent(order.orderNo)}` : '')
  );
});

// @desc    Poll a payment's status from the app
// @route   GET /api/payments/:orderId/status
// @access  Private
export const getPaymentStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (String(order.userId) !== String(req.user._id)) throw httpError(403, 'This is not your order');

  const payment = await Payment.findById(order.paymentId);
  if (!payment) throw httpError(404, 'Payment not found');

  // Reconcile a stuck pending payment against the gateway.
  if (payment.status === PAYMENT_STATUS.PENDING && payment.gateway?.merchantOrderId) {
    try {
      const live = payment.gateway?.provider === 'razorpay'
        ? await getRazorpayPaymentStatus({
            orderId: payment.gateway.orderId,
            paymentId: payment.gateway.paymentId,
          })
        : await getPhonePeOrderStatus(payment.gateway.merchantOrderId);
      await settle({ payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails });
      await payment.reload?.();
    } catch { /* fall through to the stored status */ }
  }

  const fresh = await Payment.findById(payment._id);
  return ok(res, {
    orderNo: order.orderNo,
    method: fresh.method,
    status: fresh.status,
    amount: fresh.amount,
    paidAt: fresh.paidAt,
    orderStatus: (await Order.findById(order._id, 'status')).status,
  });
});

// @desc    Set mock payment state for sandbox testing
// @route   POST /api/payments/mock-set-state
// @access  Public
export const mockSetState = asyncHandler(async (req, res) => {
  const { merchantOrderId, state } = req.body;
  if (!merchantOrderId || !state) {
    throw httpError(400, 'merchantOrderId and state are required');
  }
  setMockPaymentState(merchantOrderId, state);
  return ok(res, { merchantOrderId, state }, 'Mock payment state updated');
});
