import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { toPaise } from '../utils/money.js';
import { razorpayAttempt, addRefundObligation } from '../services/paymentObligations.service.js';
import { reconcileRefundEvent, recoverCreationFromWebhook, verifyLegacyRefundEvent } from '../services/paymentRecovery.service.js';
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
import { settleRazorpayWalletTopup } from '../services/walletTopup.service.js';
import { settleRazorpayRefundWebhook } from '../services/return.service.js';
import { redeemReservedCoins, releaseReservedCoins } from '../services/coin.service.js';
import { COIN_REFERENCE_TYPE } from '../constants/enums.js';
import { activateDigitalEntitlements } from '../services/digitalEntitlement.service.js';
import { publishPaymentSellerOrders } from '../services/sellerOrderNotification.service.js';
import { settleQuickShiprocketCollection } from '../services/quickShiprocketCollection.service.js';

const publishSellerPaymentResult = async payment => {
  try { await publishPaymentSellerOrders(payment); }
  catch { console.warn('[NOTIFICATION] Payment is durable; seller notification reconciliation will retry.'); }
};

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
export const settle = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode, gatewayPaymentId, amountPaise, currency }) => {
  if (payment.gstAssistanceRequestId) { const { settleGstPayment } = await import('../services/gstPayment.service.js'); return { status: await settleGstPayment(payment._id, { state, orderId: gatewayOrderId, paymentId: gatewayPaymentId, amountPaise, currency }) }; }
  if(payment.advertising)throw httpError(409,'Advertising requires its dedicated settlement handler');
  if (payment.quickFeeSnapshotId) return settleQuickShiprocketCollection({ payment, state, gatewayOrderId, gatewayPaymentId, amountPaise, currency });
  // Exact Razorpay capture replay is a no-op; distinct successes still need
  // financial reconciliation after settlement/failure. Other provider signals
  // retain their pending-only transition and one-time Coins effects.
  const capturedRazorpay = state === 'COMPLETED' && (payment.gateway?.provider === 'razorpay' || payment.gatewayAttempts?.some(row => row.provider === 'razorpay' && row.gatewayOrderId === gatewayOrderId));
  const knownCaptureId = gatewayPaymentId || paymentDetails?.[0]?.id;
  if (capturedRazorpay && payment.captures?.some(row => row.gatewayPaymentId === knownCaptureId && row.gatewayOrderId === gatewayOrderId && row.amountPaise === amountPaise && currency === 'INR')) {
    await publishSellerPaymentResult(payment);
    return { changed: false, status: payment.status };
  }
  if (payment.status !== PAYMENT_STATUS.PENDING && !capturedRazorpay) {
    if (payment.status === PAYMENT_STATUS.PAID) await publishSellerPaymentResult(payment);
    return { changed: false, status: payment.status };
  }

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };
  let notifyBuyer = false;

  try {
    await session.withTransaction(async () => {
      notifyBuyer = false;
      const fresh = await Payment.findById(payment._id).session(session);
      if (!fresh) return;
      if (capturedRazorpay) {
        const attempt = razorpayAttempt(fresh, gatewayOrderId);
        const captureId = gatewayPaymentId || paymentDetails?.[0]?.id;
        if (!captureId || !Number.isSafeInteger(amountPaise) || amountPaise !== attempt.amountPaise || amountPaise !== rupeesToPaise(fresh.amount) || currency !== 'INR') throw httpError(400, 'Razorpay capture does not match its attempt');
        const previous = fresh.captures?.find(row => row.gatewayPaymentId === captureId);
        if (previous) {
          if (previous.gatewayOrderId !== gatewayOrderId) throw httpError(400, 'Razorpay payment association mismatch');
          result = { changed: false, status: fresh.status }; return;
        }
        // Backward compatibility: old paid records have no capture journal.
        // A replay for their known winning gateway order is not a second debt.
        if (!fresh.captures?.length && !fresh.gatewayAttempts?.length && ['paid', 'partial_refund', 'refunded'].includes(fresh.status) && fresh.gateway.orderId === gatewayOrderId && (!fresh.gateway.paymentId || fresh.gateway.paymentId === captureId)) {
          fresh.captures = [{ gatewayOrderId, gatewayPaymentId: captureId, amountPaise: attempt.amountPaise, currency: 'INR', disposition: 'settled', receivedAt: fresh.paidAt || new Date() }];
          await fresh.save({ session }); result = { changed: false, status: fresh.status }; return;
        }
        const extra = Boolean(fresh.checkoutAbandonedAt) || ['paid', 'partial_refund', 'refunded'].includes(fresh.status) || attempt.status === 'failed' || (fresh.status === 'failed' && fresh.coinsUsed > 0);
        fresh.captures ||= [];
        fresh.captures.push({ gatewayOrderId, gatewayPaymentId: captureId, amountPaise: attempt.amountPaise, currency: 'INR', disposition: extra ? 'refund_required' : 'settled', receivedAt: new Date() });
        const recorded = fresh.gatewayAttempts?.find(row => row.gatewayOrderId === gatewayOrderId);
        if (recorded) recorded.status = 'captured';
        if (extra) {
          addRefundObligation(fresh, { key: `CAPTURE:${captureId}`, gatewayOrderId, gatewayPaymentId: captureId, amountPaise: attempt.amountPaise, reason: 'Additional or late failed-attempt capture; do not fulfil twice' });
          await fresh.save({ session }); result = { changed: true, status: fresh.status }; return;
        }
        const cancelled = await Order.find(fresh.groupRef ? { groupRef: fresh.groupRef, status: ORDER_STATUS.CANCELLED } : { _id: fresh.orderId, status: ORDER_STATUS.CANCELLED }).session(session);
        for (const order of cancelled) {
          const amountPaise = Math.round((fresh.groupRef ? order.pricing.totalAmount : fresh.amount) * 100);
          addRefundObligation(fresh, { key: `CANCEL:${order._id}`, orderId: order._id, gatewayOrderId, gatewayPaymentId: captureId, amountPaise, reason: 'Capture received for cancelled order' });
          await Order.updateOne({ _id: order._id, status: ORDER_STATUS.CANCELLED }, { $set: { refundPending: { amount: amountPaise / 100, reason: 'Capture received for cancelled order', markedAt: new Date() } } }, { session });
        }
        // Capture can arrive after the journal is stored but before initiation
        // writes the current gateway projection. Settlement owns that projection.
        fresh.gateway.provider = 'razorpay';
        if (attempt.merchantOrderId) fresh.gateway.merchantOrderId = attempt.merchantOrderId;
        fresh.gateway.paymentId = captureId;
      } else if (fresh.status !== PAYMENT_STATUS.PENDING) return;

      if (state === 'COMPLETED') {
        fresh.status = PAYMENT_STATUS.PAID;
        fresh.paidAt = new Date();
        fresh.gateway = { ...(fresh.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await fresh.save({ session });

        /**
         * Payment and vendor acceptance are independent facts. Earlier code
         * changed an order to CONFIRMED here, so a successful gateway webhook
         * looked exactly like the seller had accepted the order. Keep the
         * order PLACED and add a timeline event instead; the seller transition
         * is the only operation that may move it to CONFIRMED.
         */
        const target = fresh.groupRef
          ? { groupRef: fresh.groupRef, status: ORDER_STATUS.PLACED }
          : (fresh.orderId ? { _id: fresh.orderId, status: ORDER_STATUS.PLACED } : null);

        if (target) {
          await Order.updateMany(target, {
            $push: { timeline: { status: ORDER_STATUS.PLACED, note: 'Online payment verified', timestamp: new Date() } },
          }, { session });
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

        // A signed/captured server-side payment is the sole entitlement
        // boundary. The unique purchase index makes webhook/browser races safe.
        await activateDigitalEntitlements({ payment: fresh, session });

        result = { changed: true, status: 'paid' };
        notifyBuyer = true;
      } else if (state === 'FAILED') {
        const attempt = fresh.gatewayAttempts?.find(row => row.gatewayOrderId === gatewayOrderId);
        if (attempt) attempt.status = 'failed';
        if (fresh.gateway?.provider === 'razorpay' && fresh.gateway.orderId !== gatewayOrderId) { await fresh.save({ session }); return; }
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

  if (result.status === PAYMENT_STATUS.PAID) {
    await publishSellerPaymentResult(payment);
    if (notifyBuyer) {
      try {
        const { notifyUser, NOTIFICATION_EVENT } = await import('../services/notification.service.js');
        const targetOrder = payment.groupRef
          ? await Order.findOne({ groupRef: payment.groupRef }).sort({ createdAt: 1 })
          : (payment.orderId ? await Order.findById(payment.orderId) : null);
        if (targetOrder && targetOrder.status !== ORDER_STATUS.CANCELLED) {
          notifyUser(payment.userId, {
            event: NOTIFICATION_EVENT.ORDER_CREATED,
            title: 'Order Placed Successfully!',
            message: `Order #${targetOrder.orderNo} has been placed.`,
            metadata: { orderId: targetOrder._id },
            route: '/orders',
          }).catch((e) => console.error('[NOTIFICATION] notifyUser (paid order) failed:', e.message));
        }
      } catch { /* buyer notification failure is non-fatal */ }
    }
  }
  return result;
};

// @desc    Start an online payment for an existing order
// @route   POST /api/payments/initiate
// @access  Private
export const initiatePayment = asyncHandler(async (req, res) => {
  const provider = getPaymentGateway();
  if (provider !== 'razorpay') throw httpError(503, 'Razorpay is not configured for customer payments');

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
  const attemptId = crypto.randomUUID();
  const amountPaise = toPaise(amountRupees);
  // Preserve a pre-journal pending reference before replacing the legacy
  // projection. The conditional push also handles two simultaneous retries.
  if (payment.gateway?.provider === 'razorpay' && payment.gateway.orderId && !payment.gatewayAttempts?.some(row => row.gatewayOrderId === payment.gateway.orderId)) {
    await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.gatewayOrderId': { $ne: payment.gateway.orderId } }, { $push: { gatewayAttempts: {
      attemptId: `legacy:${payment.gateway.orderId}`, provider: 'razorpay', gatewayOrderId: payment.gateway.orderId,
      merchantOrderId: payment.gateway.merchantOrderId, orderId: payment.orderId || order._id,
      amountPaise: Math.round(payment.amount * 100), currency: 'INR', status: payment.status === 'failed' ? 'failed' : 'issued', createdAt: payment.gateway.initiatedAt,
    } } });
  }
  const reserved = await Payment.findOneAndUpdate({ _id: payment._id, checkoutAbandonedAt: { $exists: false }, status: { $in: ['pending', 'failed'] }, 'gatewayAttempts.19': { $exists: false }, gatewayAttempts: { $not: { $elemMatch: { status: { $in: ['initializing', 'creation_unknown'] } } } } }, {
    $inc: { attempts: 1 }, $push: { gatewayAttempts: { attemptId, provider, orderId: order._id, amountPaise, currency: 'INR', status: 'initializing', createdAt: new Date() } },
  }, { returnDocument: 'after' });
  if (!reserved) throw httpError(409, 'Payment changed, an attempt requires reconciliation, or its attempt limit was reached. Review payment status before retrying.', { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  const attempt = reserved.attempts;
  const merchantOrderId = `${order.orderNo}-A${attempt}`;
  // Persist the provider receipt before the external boundary so a timeout or
  // process interruption leaves an operator-reconcilable originating attempt.
  await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.attemptId': attemptId }, { $set: { 'gatewayAttempts.$.merchantOrderId': merchantOrderId } });

  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/payments/return/${merchantOrderId}`;

  let gw;
  try { gw = await createRazorpayOrder({
    merchantOrderId,
    amountPaise,
    notes: { bulkimartOrderId: String(order._id), orderNo: order.orderNo },
  }); } catch (error) {
    // Only an explicit provider validation rejection establishes no creation.
    // Timeouts, 5xx, malformed replies and connection errors stay unresolved.
    const rejected = error.statusCode === 400 && error.error?.code === 'BAD_REQUEST_ERROR';
    await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.attemptId': attemptId }, { $set: { 'gatewayAttempts.$.status': rejected ? 'creation_rejected' : 'creation_unknown' }, $push: { 'gatewayAttempts.$.history': { status: rejected ? 'creation_rejected' : 'creation_unknown', at: new Date(), result: rejected ? 'Provider confirmed request rejection; no order created' : 'Provider creation outcome uncertain' } } });
    if (rejected) throw httpError(400, 'Provider rejected payment initialization. Review the order before retrying.');
    throw httpError(503, 'Payment initialization is unconfirmed. Check payment status before retrying.');
  }

  if (gw.amountPaise !== amountPaise || gw.currency !== 'INR') throw httpError(502, 'Razorpay returned mismatched order details');
  await Payment.updateOne({ _id: payment._id, 'gatewayAttempts.attemptId': attemptId }, { $set: {
    'gatewayAttempts.$.gatewayOrderId': gw.orderId, 'gatewayAttempts.$.merchantOrderId': merchantOrderId, 'gatewayAttempts.$.status': 'issued',
  } });
  const gateway = {
    provider,
    merchantOrderId,
    orderId: gw.orderId,
    initiatedAt: new Date(),
  };
  await Payment.updateOne({ _id: payment._id, status: { $in: ['pending', 'failed'] } }, { $set: { gateway, status: PAYMENT_STATUS.PENDING } });

  return ok(res, {
    provider,
    keyId: gw.keyId,
    razorpayOrderId: gw.orderId,
    merchantOrderId,
    orderId: String(order._id),
    amountPaise: gw.amountPaise,
    currency: gw.currency,
    name: 'Bulkimart',
    description: `Bulkimart order ${order.orderNo}`,
  }, 'Razorpay checkout ready');
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
  if (String(req.body.event || '').startsWith('payment.dispute.')) {
    const { recordMerchandiseDispute } = await import('../services/merchandiseDispute.service.js');
    if (await recordMerchandiseDispute(req.body)) return res.status(200).json({ success: true, message: 'Merchandise dispute held for reconciliation' });
  }
  // Dispatch by stored purpose before importing the advertising domain. Other
  // payment purposes retain their own handlers and dependencies.
  const entity=req.body.payload?.payment?.entity||req.body.payload?.order?.entity;
  const advertisingReference=entity?.notes?.advertisingPaymentId;
  const adPayment=await Payment.findOne({'advertising.campaignId':{$exists:true},$or:[
    {'gateway.orderId':evt.gatewayOrderId||'__missing__'},
    {'captures.gatewayPaymentId':evt.refundPaymentId||'__missing__'},
    ...(/^[a-f\d]{24}$/i.test(advertisingReference||'')?[{_id:advertisingReference}]:[]),
  ]});
  if(adPayment?.advertising||entity?.notes?.purpose==='ADVERTISING_V2'){
    const { handleAdvertisingWebhook } = await import('../services/advertisingBilling.service.js');
    if(await handleAdvertisingWebhook(req.body,evt,req.get('x-razorpay-event-id')))return res.status(200).json({success:true});
  }
  const { handleParcelWebhook } = await import('../services/parcelPayment.service.js');
  if (await handleParcelWebhook(req.body, evt)) return res.status(200).json({ success: true });
  const { handleServiceWebhook } = await import('../services/servicePayment.service.js');
  if (await handleServiceWebhook(req.body, evt)) return res.status(200).json({ success: true });
  const { handleLegalWebhook } = await import('../services/legalPayment.service.js');
  if (await handleLegalWebhook(req.body, evt)) return res.status(200).json({ success: true });
  const { handleGstWebhook } = await import('../services/gstPayment.service.js');
  if (await handleGstWebhook(req.body, evt)) return res.status(200).json({ success: true });
  if (['refund_completed', 'refund_failed'].includes(evt.kind)) {
    const recovery = await reconcileRefundEvent(evt);
    if (recovery.handled) {
      if (['processed', 'failed'].includes(recovery.outcome.status)) await settleRazorpayRefundWebhook({ refundId: evt.refundId, state: recovery.outcome.status === 'processed' ? 'COMPLETED' : 'FAILED', errorCode: evt.errorCode });
      return res.status(200).json({ success: true });
    }
    const verified = await verifyLegacyRefundEvent(evt);
    if (['processed', 'failed'].includes(verified)) await settleRazorpayRefundWebhook({ refundId: evt.refundId, state: verified === 'processed' ? 'COMPLETED' : 'FAILED', errorCode: evt.errorCode });
    return res.status(200).json({ success: true });
  }
  if (!evt.gatewayOrderId || !['payment_completed', 'payment_failed'].includes(evt.kind)) {
    return res.status(200).json({ success: true, message: 'Ignored event' });
  }

  let payment = await Payment.findOne({ $or: [
    { 'gateway.provider': 'razorpay', 'gateway.orderId': evt.gatewayOrderId },
    { gatewayAttempts: { $elemMatch: { provider: 'razorpay', gatewayOrderId: evt.gatewayOrderId } } },
  ] });
  if (!payment) payment = await recoverCreationFromWebhook(evt);
  if (!payment) return res.status(200).json({ success: true, message: 'Unknown order' });
  if (payment.isWalletTopup) {
    await settleRazorpayWalletTopup({ payment,
      state: evt.kind === 'payment_completed' ? 'COMPLETED' : 'FAILED',
      gatewayOrderId: evt.gatewayOrderId, gatewayPaymentId: evt.paymentId,
      amountPaise: evt.amountPaise, currency: evt.currency, paymentDetails: evt.paymentDetails });
    return res.status(200).json({ success: true });
  }
  if (payment.parcelDeliveryId) {
    await handleParcelWebhook(req.body, evt);
    return res.status(200).json({ success: true });
  }
  if (payment.serviceApplicationId) {
    if (payment.servicePaymentKind === 'vendor_service') await handleServiceWebhook(req.body, evt);
    else await handleLegalWebhook(req.body, evt);
    return res.status(200).json({ success: true });
  }
  if (payment.gstAssistanceRequestId) { await handleGstWebhook(req.body, evt); return res.status(200).json({ success: true }); }

  const attempt = razorpayAttempt(payment, evt.gatewayOrderId);
  if (!Number.isSafeInteger(evt.amountPaise) || evt.amountPaise !== attempt.amountPaise || evt.amountPaise !== rupeesToPaise(payment.amount) || !evt.paymentId) {
    return res.status(400).json({ success: false, message: 'Payment amount mismatch' });
  }
  if (evt.currency !== 'INR') {
    return res.status(400).json({ success: false, message: 'Payment currency mismatch' });
  }

  await settle({
    payment,
    state: evt.kind === 'payment_completed' ? 'COMPLETED' : 'FAILED',
    gatewayOrderId: evt.gatewayOrderId,
    gatewayPaymentId: evt.paymentId, amountPaise: evt.amountPaise, currency: evt.currency,
    paymentDetails: evt.paymentDetails,
    errorCode: evt.errorCode,
  });

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
  const attempt = razorpayAttempt(payment, razorpay_order_id);
  if (String(attempt.orderId) !== String(order._id)) throw httpError(400, 'Razorpay order mismatch');

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
    gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: live.currency,
    paymentDetails: live.paymentDetails,
    errorCode: live.errorCode,
  });
  await Payment.updateOne(
    { _id: payment._id, 'gateway.paymentId': razorpay_payment_id },
    { $set: { 'gateway.signatureVerifiedAt': new Date() } },
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
      await settle({ payment, state: live.state, gatewayOrderId: live.orderId, gatewayPaymentId: live.paymentId, amountPaise: live.amountPaise, currency: live.currency, paymentDetails: live.paymentDetails });
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
    refundObligations: (fresh.refundObligations || []).map(row => ({ amount: row.amountPaise / 100, currency: row.currency, status: row.status, reason: row.reason })),
    reconciliationRequired: fresh.gatewayAttempts?.some(row => ['initializing', 'creation_unknown'].includes(row.status)) || false,
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
