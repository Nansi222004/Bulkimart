import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import Payment from '../models/Payment.js';
import { httpError } from '../utils/response.js';
import {
  ORDER_STATUS, RETURN_STATUS, RETURN_QUANTITY_RELEASING_STATUSES,
  RETURN_REFUND_MACHINERY_STATUSES, RESTOCK_DECISION, RESTOCK_STATUS,
  RETURN_REFUND_STATUS, PAYMENT_METHOD, PAYMENT_STATUS,
} from '../constants/enums.js';
import * as coinService from './coin.service.js';
import * as phonepeService from './phonepe.service.js';
import { ensureReturnObligation, processRefundObligation } from './paymentRecovery.service.js';
import { refundToWallet } from './wallet.service.js';
import { WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';
import { notifyUser, notifySeller, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';
import { mutateInventory } from './inventory.service.js';

/**
 * The real, item-level Return backend (Phase 4). `order.controller.js
 * ::requestReturn` is a separate, untouched, legacy whole-order endpoint —
 * nothing here calls it or feeds it, and nothing here ever sets
 * `Order.status` to RETURN_REQUESTED/RETURNED/REFUNDED.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/* ============================================================================
 * STATUS MACHINE
 * ========================================================================== */

const RETURN_TRANSITIONS = {
  [RETURN_STATUS.RETURN_REQUESTED]: [RETURN_STATUS.UNDER_REVIEW, RETURN_STATUS.CANCELLED],
  [RETURN_STATUS.UNDER_REVIEW]:     [RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.APPROVED]:         [RETURN_STATUS.AWAITING_RETURN],
  [RETURN_STATUS.AWAITING_RETURN]:  [RETURN_STATUS.RETURN_RECEIVED],
  [RETURN_STATUS.RETURN_RECEIVED]:  [RETURN_STATUS.REFUND_PENDING],
  [RETURN_STATUS.REFUND_PENDING]:   [RETURN_STATUS.REFUNDED, RETURN_STATUS.REFUND_FAILED],
  [RETURN_STATUS.REFUND_FAILED]:    [RETURN_STATUS.REFUND_PENDING],
  [RETURN_STATUS.REFUNDED]:  [],
  [RETURN_STATUS.REJECTED]:  [],
  [RETURN_STATUS.CANCELLED]: [],
};

/** The one place a Return status transition is judged valid or not. */
export const canTransitionReturnStatus = (from, to) => (RETURN_TRANSITIONS[from] || []).includes(to);

/* ============================================================================
 * QUANTITY ACCOUNTING
 * ========================================================================== */

/**
 * `qty - returnedQty` — the item's ordered quantity minus whatever is
 * currently reserved by a non-released Return (every status except
 * REJECTED/CANCELLED; see Order.js's `returnedQty` field comment). This is
 * a read, never itself the concurrency guard — the guard is the atomic
 * `$inc` in `createReturnRequest` below, which re-checks this same
 * arithmetic at the database level at the moment of the actual write.
 */
export const remainingReturnableQuantity = (item) => Math.max(0, (item.qty || 0) - (item.returnedQty || 0));

/* ============================================================================
 * ELIGIBILITY
 * ========================================================================== */

/**
 * Everything a customer's return request must pass, evaluated fresh every
 * time — but ALWAYS against the Order item's own frozen Phase 3 snapshot,
 * never today's CategoryReturnPolicy (Section 6 of the spec).
 *
 * Ownership is checked with a 404, not 403, on mismatch — matching this
 * project's established convention (e.g. packaging.controller.js) of never
 * confirming another user's order exists.
 *
 * @returns {Promise<{ order, item, remaining: number }>} on success — throws httpError otherwise.
 */
export const getReturnEligibility = async ({ orderId, orderItemId, customerId, quantity }) => {
  if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(orderItemId)) {
    throw httpError(400, 'Invalid order or item reference', { code: 'RETURN_NOT_FOUND' });
  }

  const order = await Order.findById(orderId);
  if (!order || String(order.userId) !== String(customerId)) {
    throw httpError(404, 'Order not found', { code: 'RETURN_NOT_FOUND' });
  }

  if (order.status !== ORDER_STATUS.DELIVERED) {
    throw httpError(400, 'This order has not been delivered yet', { code: 'ORDER_NOT_DELIVERED' });
  }

  const item = order.items.id(orderItemId);
  if (!item) {
    throw httpError(404, 'That item is not part of this order', { code: 'RETURN_NOT_FOUND' });
  }

  // `returnEligible` already collapses both "no policy" (returnWindowDays:
  // null) and an admin's explicit 0-day policy into false — neither ever
  // becomes an eligible window here (Section 9).
  if (!item.returnPolicy?.returnEligible) {
    throw httpError(400, 'This product is not eligible for return', { code: 'PRODUCT_NOT_RETURNABLE' });
  }

  if (!item.returnEligibleUntil) {
    // Delivered but somehow never got a deadline stamped — treat as not
    // returnable rather than guessing one now.
    throw httpError(400, 'This item has no return window on record', { code: 'PRODUCT_NOT_RETURNABLE' });
  }

  // Strict `<` — the deadline instant itself is already expired (Section 8).
  if (!(new Date() < new Date(item.returnEligibleUntil))) {
    throw httpError(400, 'The return window for this item has expired', { code: 'RETURN_WINDOW_EXPIRED' });
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw httpError(400, 'Quantity must be a whole number greater than zero', { code: 'RETURN_QUANTITY_EXCEEDED' });
  }

  const remaining = remainingReturnableQuantity(item);
  if (qty > remaining) {
    throw httpError(400, `Only ${remaining} unit(s) of this item can still be returned`, { code: 'RETURN_QUANTITY_EXCEEDED' });
  }

  return { order, item, remaining };
};

/* ============================================================================
 * CREATE
 * ========================================================================== */

/**
 * Validates eligibility, then ATOMICALLY reserves the requested quantity on
 * the Order item and creates the Return record in one transaction. The
 * quantity guard is the same `$inc` + query-filter pattern already used for
 * stock/Coins elsewhere in this codebase: `returnedQty` is only incremented
 * when `returnedQty <= qty - quantity` still holds AT THE MOMENT OF THE
 * WRITE, so two concurrent requests for the same item can never together
 * reserve more than was ordered — the eligibility check above is a
 * best-effort pre-check, this is what actually enforces it.
 *
 * A "duplicate double-click" is handled by this same guard: if the first
 * click's transaction already reserved the quantity, an identical second
 * click either still fits (a legitimate second request the customer may
 * want) or is rejected as RETURN_QUANTITY_EXCEEDED — never silently
 * duplicated, never double-reserved.
 */
export const createReturnRequest = async ({ orderId, orderItemId, customerId, quantity, reason, customerDescription, attachments }) => {
  const { order, item } = await getReturnEligibility({ orderId, orderItemId, customerId, quantity });

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const guardResult = await Order.updateOne(
        { _id: orderId, items: { $elemMatch: { _id: orderItemId, returnedQty: { $lte: item.qty - quantity } } } },
        { $inc: { 'items.$.returnedQty': quantity } },
        { session }
      );
      if (guardResult.modifiedCount !== 1) {
        // Someone else's concurrent request consumed the remaining quantity
        // between the eligibility read above and this write.
        throw httpError(409, 'Requested quantity is no longer available for return', { code: 'RETURN_QUANTITY_EXCEEDED' });
      }

      const [doc] = await Return.create([{
        orderId,
        orderItemId,
        customerId,
        sellerId: item.sellerId,
        shgStoreId: item.shgStoreId,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.name,
        productImage: item.image,
        unitPriceSnapshot: item.price,
        quantity,
        reason,
        customerDescription,
        attachments,
        status: RETURN_STATUS.RETURN_REQUESTED,
        history: [{
          toStatus: RETURN_STATUS.RETURN_REQUESTED,
          changedBy: customerId,
          changedByModel: 'User',
          changedByRole: 'customer',
          comment: 'Return requested',
        }],
        returnWindowDaysSnapshot: item.returnPolicy?.returnWindowDays,
        returnEligibleUntilSnapshot: item.returnEligibleUntil,
        headerCategoryId: item.returnPolicy?.headerCategoryId,
        headerCategoryName: item.returnPolicy?.headerCategoryName,
      }], { session });

      created = doc;
    });
  } finally {
    await session.endSession();
  }

  notifyUser(created.customerId, {
    event: NOTIFICATION_EVENT.RETURN_REQUESTED,
    title: 'Return requested',
    message: `Your return ${created.returnNumber} for ${created.productName} has been submitted.`,
    metadata: { returnId: created._id, returnNumber: created.returnNumber },
    route: `/orders/${created.orderId}`,
  }).catch(() => {});
  notifyAllAdmins({
    event: NOTIFICATION_EVENT.RETURN_REQUESTED,
    title: 'New return request',
    message: `${created.returnNumber} — ${created.productName} × ${created.quantity}`,
    metadata: { returnId: created._id, returnNumber: created.returnNumber },
    route: `/admin/returns/${created._id}`,
  }).catch(() => {});

  return created;
};

/* ============================================================================
 * STATUS TRANSITIONS (admin)
 * ========================================================================== */

const RETURN_NOTIFICATION_BY_STATUS = {
  [RETURN_STATUS.UNDER_REVIEW]:    { event: NOTIFICATION_EVENT.RETURN_UNDER_REVIEW, title: 'Return under review', message: (r) => `Your return ${r.returnNumber} is now under review.` },
  [RETURN_STATUS.APPROVED]:        { event: NOTIFICATION_EVENT.RETURN_APPROVED,     title: 'Return approved',      message: (r) => `Your return ${r.returnNumber} has been approved.` },
  [RETURN_STATUS.REJECTED]:        { event: NOTIFICATION_EVENT.RETURN_REJECTED,     title: 'Return rejected',      message: (r) => `Your return ${r.returnNumber} was rejected: ${r.rejectionReason || ''}`.trim() },
  [RETURN_STATUS.RETURN_RECEIVED]: { event: NOTIFICATION_EVENT.RETURN_RECEIVED,     title: 'Return received',      message: (r) => `We've received your returned item for ${r.returnNumber}.` },
};

/**
 * Applies one validated status transition, releasing the reserved quantity
 * back onto the Order item when (and only when) the new status is REJECTED
 * or CANCELLED (Section 17). Every other transition keeps the quantity
 * reserved — including the terminal REFUNDED, which really was returned.
 *
 * `REFUNDED` is deliberately unreachable through this function — real
 * gateway execution (Phase 6) is the only path that may set it, so this
 * throws rather than silently flip a status no money has actually moved
 * for yet.
 */
export const transitionReturnStatus = async ({ returnId, toStatus, adminId, comment, rejectionReason, restockDecision }) => {
  if (RETURN_REFUND_MACHINERY_STATUSES.includes(toStatus)) {
    throw httpError(400, 'Refund states are managed by the refund endpoint, not a generic status change', { code: 'REFUND_NOT_AVAILABLE' });
  }

  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const ret = await Return.findById(returnId).session(session);
      if (!ret) throw httpError(404, 'Return not found', { code: 'RETURN_NOT_FOUND' });

      if (!canTransitionReturnStatus(ret.status, toStatus)) {
        throw httpError(400, `Cannot move a ${ret.status} return to ${toStatus}`, { code: 'INVALID_RETURN_STATUS_TRANSITION' });
      }

      if (toStatus === RETURN_STATUS.REJECTED && !rejectionReason) {
        throw httpError(400, 'A rejection reason is required', { code: 'INVALID_RETURN_STATUS_TRANSITION' });
      }

      const fromStatus = ret.status;
      const now = new Date();

      ret.status = toStatus;
      if (toStatus === RETURN_STATUS.UNDER_REVIEW) { ret.reviewedAt = now; ret.reviewedBy = adminId; }
      if (toStatus === RETURN_STATUS.APPROVED)     ret.approvedAt = now;
      if (toStatus === RETURN_STATUS.REJECTED)     { ret.rejectedAt = now; ret.rejectionReason = rejectionReason; }
      if (toStatus === RETURN_STATUS.RETURN_RECEIVED) {
        ret.receivedAt = now;
        ret.receivedBy = adminId;
        if (restockDecision) ret.restockDecision = restockDecision;

        // Physical stock is back the moment it's marked received — this does
        // NOT wait for the refund to be processed (Phase 6Q). Idempotent via
        // `restockStatus`: a duplicate/retried request can never restock twice.
        if (ret.restockStatus === RESTOCK_STATUS.NOT_PROCESSED) {
          if (ret.restockDecision === RESTOCK_DECISION.RESTOCKABLE) {
            await mutateInventory({ productId: ret.productId, variantId: ret.variantId, quantity: ret.quantity, session, restore: true });
            ret.restockStatus = RESTOCK_STATUS.RESTOCKED;
          } else if (ret.restockDecision === RESTOCK_DECISION.NON_RESTOCKABLE) {
            ret.restockStatus = RESTOCK_STATUS.NOT_RESTOCKED;
          }
        }
      }
      if (adminComment(comment)) ret.adminComment = comment;

      ret.history.push({
        fromStatus, toStatus, changedBy: adminId, changedByModel: 'Admin', changedByRole: 'admin', comment, timestamp: now,
      });

      await ret.save({ session });

      // Release the reservation — the quantity is available for a future
      // return request again.
      if (RETURN_QUANTITY_RELEASING_STATUSES.includes(toStatus)) {
        await Order.updateOne(
          { _id: ret.orderId, 'items._id': ret.orderItemId },
          { $inc: { 'items.$.returnedQty': -ret.quantity } },
          { session }
        );
      }

      updated = ret;
    });
  } finally {
    await session.endSession();
  }

  const notif = RETURN_NOTIFICATION_BY_STATUS[toStatus];
  if (notif) {
    notifyUser(updated.customerId, {
      event: notif.event, title: notif.title, message: notif.message(updated),
      metadata: { returnId: updated._id, returnNumber: updated.returnNumber },
      route: `/orders/${updated.orderId}`,
    }).catch(() => {});
    if (updated.sellerId && (toStatus === RETURN_STATUS.APPROVED || toStatus === RETURN_STATUS.RETURN_RECEIVED)) {
      notifySeller(updated.sellerId, {
        event: notif.event, title: notif.title, message: notif.message(updated),
        metadata: { returnId: updated._id, returnNumber: updated.returnNumber },
        route: `/seller/returns`,
      }).catch(() => {});
    }
  }

  return updated;
};

const adminComment = (c) => typeof c === 'string' && c.trim().length > 0;

/* ============================================================================
 * REFUND CALCULATION (Phase 6 — the single source of truth)
 * ========================================================================== */

/**
 * Deterministic refund breakdown for one Return, computed from the
 * AUTHORITATIVE Order (never anything the frontend sends).
 *
 * Allocation rule (Phase 6B): this codebase has no per-item discount
 * allocation anywhere (confirmed by inspection — `Order.pricing` records
 * coupon/Coins discount at the ORDER level only). Per the phase's own
 * "establish a deterministic proportional allocation rule based on actual
 * eligible item values" instruction, each returned line's share of every
 * order-level discount is proportional to its own gross value against the
 * order's full item subtotal:
 *
 *   shareOfOrder = (unitPrice × returnedQty) / sum(unitPrice × qty for every item)
 *   allocatedX   = round2(shareOfOrder × order.pricing.X)
 *
 * Historical CDS discounts are retained as a legacy order discount so old
 * returns preserve the paid amount. Coins are additionally
 * translated back into a whole-Coin count (`allocatedCoinsCount`) for
 * `coin.service.js::refundRedeemedCoins`, since Coins are an integer
 * currency, not a rupee figure.
 *
 * Deliberately NOT refunded, and not fabricated:
 *   - Delivery charge — this codebase has no partial/per-item delivery
 *     refund concept, and delivery is a rendered service regardless of
 *     which item is later returned (standard practice); refunding it would
 *     be an invented rule, not a discovered one.
 *   - Tax/GST — no tax field exists anywhere in this pricing architecture.
 *   - `pricing.discount` — a flat, always-0 v2 placeholder (see
 *     pricing.service.js), never populated by any real order.
 *
 * Both are named explicitly in `limitations`, not silently dropped.
 */
export const calculateReturnRefund = (returnDoc, order) => {
  const itemGrossAmount = round2(returnDoc.unitPriceSnapshot * returnDoc.quantity);
  const pricing = order?.pricing || {};
  const orderSubtotal = (order?.items || []).reduce((sum, it) => sum + (it.price || 0) * (it.qty || 0), 0);
  const shareOfOrder = orderSubtotal > 0 ? itemGrossAmount / orderSubtotal : 0;

  const allocatedCouponDiscount = round2(shareOfOrder * (pricing.couponDiscount || 0));
  const allocatedLegacyDiscount = round2(shareOfOrder * (pricing.cdsDiscount || 0));
  const allocatedCoinDiscount   = round2(shareOfOrder * (pricing.coinDiscount || 0));
  const allocatedCoinsCount     = Math.round(shareOfOrder * (pricing.coinsUsed || 0));

  const refundAmount = Math.max(0, round2(itemGrossAmount - allocatedCouponDiscount - allocatedLegacyDiscount - allocatedCoinDiscount));

  const limitations = [
    'Delivery charge is not refunded — treated as a rendered service, independent of which item is later returned; no partial-delivery-refund rule exists in this codebase.',
    'No tax/GST field exists in this pricing architecture, so none is calculated.',
  ];
  if (orderSubtotal <= 0) limitations.push('Order subtotal could not be computed from item data — discount allocation defaulted to 0.');

  return { itemGrossAmount, allocatedCouponDiscount, allocatedLegacyDiscount, allocatedCoinDiscount, allocatedCoinsCount, refundAmount, limitations };
};

/* ============================================================================
 * REFUND EXECUTION (Phase 6)
 * ========================================================================== */

const REFUND_LOCK_STALE_MS = 5 * 60 * 1000;
const refundIdempotencyKey = (returnId) => `RETURN_REFUND:${returnId}`;
const merchantRefundId = (returnId) => `RETRF-${returnId}`;

/** Acquire the per-return refund-processing lock, or throw if one is already active. */
const acquireRefundLock = async (returnId) => {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - REFUND_LOCK_STALE_MS);
  const claimed = await Return.findOneAndUpdate(
    {
      _id: returnId,
      status: { $in: [RETURN_STATUS.RETURN_RECEIVED, RETURN_STATUS.REFUND_PENDING, RETURN_STATUS.REFUND_FAILED] },
      $or: [{ refundLockedAt: null }, { refundLockedAt: { $exists: false } }, { refundLockedAt: { $lt: staleCutoff } }],
    },
    { $set: { refundLockedAt: now } },
    { returnDocument: 'after' }
  );
  return claimed;
};

const releaseRefundLock = async (returnId) => {
  await Return.updateOne({ _id: returnId }, { $unset: { refundLockedAt: 1 } }).catch(() => {});
};

/**
 * Processes (or safely retries) one return's refund. Callable from
 * RETURN_RECEIVED, REFUND_PENDING (a stuck/in-flight retry) or REFUND_FAILED.
 * Idempotent: a second concurrent/duplicate call either finds the lock held
 * (409) or — if it already reached REFUNDED — returns the existing result
 * without doing anything again (Phase 6I/6J).
 */
export const processReturnRefund = async ({ returnId, adminId }) => {
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw httpError(400, 'Invalid return id');

  const locked = await acquireRefundLock(returnId);
  if (!locked) {
    const existing = await Return.findById(returnId).lean();
    if (!existing) throw httpError(404, 'Return not found');
    if (existing.status === RETURN_STATUS.REFUNDED) return existing; // already done — idempotent no-op
    throw httpError(409, 'This return\'s refund is already being processed', { code: 'REFUND_IN_PROGRESS' });
  }

  try {
    const ret = await Return.findById(returnId);
    if (!ret) throw httpError(404, 'Return not found');
    if (ret.status === RETURN_STATUS.REFUNDED) return ret; // raced with a prior success between lock read and here

    const order = await Order.findById(ret.orderId);
    if (!order) throw httpError(404, 'Order not found for this return');

    // Freeze the breakdown once, on first entry — never silently recomputed
    // on a retry, so the audited figure can never drift.
    let breakdown = ret.refundBreakdown?.refundAmount != null
      ? ret.refundBreakdown.toObject?.() || ret.refundBreakdown
      : calculateReturnRefund(ret, order);

    const now = new Date();
    if (ret.status === RETURN_STATUS.RETURN_RECEIVED || ret.status === RETURN_STATUS.REFUND_FAILED) {
      const fromStatus = ret.status;
      ret.refundBreakdown = breakdown;
      ret.refundAmount = breakdown.refundAmount;
      ret.status = RETURN_STATUS.REFUND_PENDING;
      ret.refundStatus = RETURN_REFUND_STATUS.PROCESSING;
      ret.refundFailureReason = undefined;
      ret.refundAttemptedAt = now;
      ret.history.push({ fromStatus, toStatus: RETURN_STATUS.REFUND_PENDING, changedBy: adminId, changedByModel: 'Admin', changedByRole: 'admin', comment: fromStatus === RETURN_STATUS.REFUND_FAILED ? 'Refund retried' : 'Refund process started', timestamp: now });
      await ret.save();
      if (fromStatus === RETURN_STATUS.RETURN_RECEIVED) {
        notifyUser(ret.customerId, {
          event: NOTIFICATION_EVENT.REFUND_PENDING, title: 'Refund initiated',
          message: `Your refund of ₹${breakdown.refundAmount} for ${ret.returnNumber} is being processed.`,
          metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/orders/${ret.orderId}`,
        }).catch(() => {});
      }
    }

    // ---- Zero-value refund: no gateway call is valid for ₹0 (Phase 6L) ----
    if (breakdown.refundAmount === 0) {
      return await completeRefund(ret, { refundReference: null, refundStatus: RETURN_REFUND_STATUS.COMPLETED, adminId, note: 'Zero-value refund — fully covered by discounts, no gateway transfer needed.' });
    }

    const payment = await Payment.findById(order.paymentId);
    if (!payment) throw httpError(400, 'No payment record found for this order — cannot refund');

    // ---- COD: no automatic money-movement mechanism exists (Phase 6M) ----
    if (payment.method === PAYMENT_METHOD.COD) {
      ret.refundStatus = RETURN_REFUND_STATUS.MANUAL_PENDING;
      await ret.save();
      return ret; // stays REFUND_PENDING until an admin manually settles it
    }

    // A provider-verified obligation may already be processed if Return
    // finalization was interrupted. Recover it before the legacy paid-state
    // guard, which would otherwise reject the now-refunded Payment.
    if (payment.gateway?.provider === 'razorpay' && payment.method === PAYMENT_METHOD.ONLINE) {
      const key = await ensureReturnObligation(String(payment._id), ret, Math.round(breakdown.refundAmount * 100));
      const existingDebt = (await Payment.findById(payment._id)).refundObligations.find(row => row.key === key);
      const outcome = await processRefundObligation({ paymentId: String(payment._id), key, actor: adminId, reconcile: ['processing', 'reconciliation_required'].includes(existingDebt.status) });
      if (outcome.providerRefundId) ret.refundReference = outcome.providerRefundId;
      if (outcome.status === 'processed') return await completeRefund(ret, { refundReference: outcome.providerRefundId, refundStatus: RETURN_REFUND_STATUS.COMPLETED, adminId, note: 'Razorpay refund verified through shared obligation recovery' });
      if (outcome.status === 'failed') return await failRefund(ret, 'Provider confirmed refund failure/rejection; reconcile before retry');
      ret.refundStatus = RETURN_REFUND_STATUS.PROCESSING;
      await ret.save();
      return ret;
    }

    if (![PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIAL_REFUND].includes(payment.status)) {
      return await failRefund(ret, `Payment for this order is not in a refundable state (${payment.status})`);
    }

    const alreadyRefunded = payment.refund?.totalRefundedAmount || 0;
    if (alreadyRefunded + breakdown.refundAmount > payment.amount + 0.01) {
      return await failRefund(ret, 'Refund would exceed the amount actually paid on this payment');
    }

    // ---- WALLET payment: credit refund directly back to customer NHCONE Wallet ----
    if (payment.method === PAYMENT_METHOD.WALLET) {
      const walletRes = await refundToWallet({
        userId: ret.customerId,
        amount: breakdown.refundAmount,
        reason: `Refund for item return ${ret.returnNumber}`,
        referenceType: WALLET_REFERENCE_TYPE.RETURN,
        referenceId: String(ret._id),
        idempotencyKey: `RETURN_REFUND:${ret._id}`,
      });

      payment.refund = {
        ...payment.refund?.toObject?.() || payment.refund || {},
        amount: breakdown.refundAmount,
        reason: 'Item return',
        status: 'processed',
        processedAt: now,
        merchantRefundId: `RETRF-${ret._id}`,
        totalRefundedAmount: round2(alreadyRefunded + breakdown.refundAmount),
      };
      payment.status = payment.refund.totalRefundedAmount >= payment.amount - 0.01
        ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIAL_REFUND;
      await payment.save();

      return await completeRefund(ret, {
        refundReference: walletRes.transaction?.transactionId || `WAL-RETRF-${ret._id}`,
        refundStatus: RETURN_REFUND_STATUS.COMPLETED,
        adminId,
        note: 'Refund credited to Bulkimart Wallet',
      });
    }

    // ---- Verified gateway refund. Never fall back from one provider to another. ----
    let gatewayResult;
    const gatewayProvider = payment.gateway?.provider || 'phonepe';
    try {
      gatewayResult = await phonepeService.createRefund({
            merchantRefundId: merchantRefundId(ret._id),
            originalMerchantOrderId: payment.gateway?.merchantOrderId,
            amountPaise: phonepeService.rupeesToPaise(breakdown.refundAmount),
          });
    } catch (err) {
      return await failRefund(ret, err.message || 'Payment gateway refund request failed');
    }

    const state = String(gatewayResult.state || '').toUpperCase();
    if (state === 'FAILED') {
      return await failRefund(ret, `Payment gateway reported the refund as failed (${gatewayResult.raw?.errorCode || 'no code'})`);
    }

    // COMPLETED or a pending/async state (e.g. PENDING) — PhonePe's own
    // webhook (pg.refund.completed / pg.refund.failed) is the safety net for
    // an async outcome, same convention as payment settlement; we only mark
    // REFUNDED here when the synchronous response already says so.
    payment.refund = {
      ...payment.refund?.toObject?.() || payment.refund || {},
      amount: breakdown.refundAmount,
      reason: 'Item return',
      status: state === 'COMPLETED' ? 'processed' : 'pending',
      ...(state === 'COMPLETED' ? { processedAt: now } : {}),
      merchantRefundId: merchantRefundId(ret._id),
      ...(gatewayProvider === 'razorpay'
        ? { razorpayRefId: gatewayResult.refundId }
        : { phonepeRefundId: gatewayResult.refundId }),
      gatewayState: gatewayResult.state,
      totalRefundedAmount: state === 'COMPLETED'
        ? round2(alreadyRefunded + breakdown.refundAmount)
        : alreadyRefunded,
    };
    if (state === 'COMPLETED') {
      payment.status = payment.refund.totalRefundedAmount >= payment.amount - 0.01
        ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIAL_REFUND;
    }
    await payment.save();

    if (state === 'COMPLETED') {
      return await completeRefund(ret, { refundReference: gatewayResult.refundId, refundStatus: RETURN_REFUND_STATUS.COMPLETED, adminId, note: `${gatewayProvider} refund completed` });
    }

    // Async/pending gateway state — leave the Return in REFUND_PENDING with
    // the reference recorded; the webhook or a later retry/status-check
    // resolves it, never guessed as success here.
    ret.refundReference = gatewayResult.refundId;
    ret.refundStatus = RETURN_REFUND_STATUS.PROCESSING;
    await ret.save();
    return ret;
  } finally {
    await releaseRefundLock(returnId);
  }
};

/** Resolve an asynchronous Razorpay refund webhook exactly once. */
export const settleRazorpayRefundWebhook = async ({ refundId, state, errorCode }) => {
  if (!refundId || !['COMPLETED', 'FAILED'].includes(state)) return { changed: false };
  const ret = await Return.findOne({ refundReference: refundId });
  if (!ret || [RETURN_STATUS.REFUNDED, RETURN_STATUS.REFUND_FAILED].includes(ret.status)) {
    return { changed: false };
  }
  const payment = await Payment.findOne({ 'refund.razorpayRefId': refundId });

  if (state === 'FAILED') {
    if (payment) {
      payment.refund.status = 'failed';
      payment.refund.gatewayState = 'FAILED';
      await payment.save();
    }
    await failRefund(ret, `Razorpay reported the refund as failed (${errorCode || 'no code'})`);
    return { changed: true, status: 'failed' };
  }

  if (payment && payment.refund?.status !== 'processed') {
    const prior = payment.refund?.totalRefundedAmount || 0;
    payment.refund.status = 'processed';
    payment.refund.processedAt = new Date();
    payment.refund.gatewayState = 'COMPLETED';
    payment.refund.totalRefundedAmount = round2(prior + (payment.refund.amount || 0));
    payment.status = payment.refund.totalRefundedAmount >= payment.amount - 0.01
      ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIAL_REFUND;
    await payment.save();
  }
  await completeRefund(ret, {
    refundReference: refundId,
    refundStatus: RETURN_REFUND_STATUS.COMPLETED,
    note: 'Razorpay refund completed',
  });
  return { changed: true, status: 'completed' };
};

/** Shared terminal-success path: restores allocated Coins, marks REFUNDED. */
const completeRefund = async (ret, { refundReference, refundStatus, adminId, note }) => {
  const breakdown = ret.refundBreakdown || {};
  if (breakdown.allocatedCoinsCount > 0) {
    await coinService.refundRedeemedCoins({
      userId: ret.customerId,
      amount: breakdown.allocatedCoinsCount,
      referenceType: 'RETURN',
      referenceId: ret._id,
      idempotencyKey: `${refundIdempotencyKey(ret._id)}:COINS`,
      description: `Coins restored for return ${ret.returnNumber}`,
    }).catch((err) => console.error('[RETURN REFUND] Coin restore failed:', err.message));
  }

  const now = new Date();
  ret.status = RETURN_STATUS.REFUNDED;
  ret.refundStatus = refundStatus;
  ret.refundReference = refundReference;
  ret.refundedAt = now;
  ret.history.push({ fromStatus: RETURN_STATUS.REFUND_PENDING, toStatus: RETURN_STATUS.REFUNDED, changedBy: adminId, changedByModel: 'Admin', changedByRole: 'admin', comment: note, timestamp: now });
  await ret.save();

  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.REFUND_COMPLETED, title: 'Refund completed',
    message: `₹${ret.refundAmount} has been refunded for ${ret.returnNumber}.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber, refundAmount: ret.refundAmount },
    route: `/orders/${ret.orderId}`,
  }).catch(() => {});

  return ret;
};

/** Shared failure path: REFUND_FAILED, safely retryable, never claims success. */
const failRefund = async (ret, reason) => {
  const now = new Date();
  ret.status = RETURN_STATUS.REFUND_FAILED;
  ret.refundStatus = RETURN_REFUND_STATUS.FAILED;
  ret.refundFailureReason = reason;
  ret.history.push({ fromStatus: RETURN_STATUS.REFUND_PENDING, toStatus: RETURN_STATUS.REFUND_FAILED, comment: reason, timestamp: now });
  await ret.save();

  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.REFUND_FAILED, title: 'Refund failed',
    message: `We couldn't process your refund for ${ret.returnNumber}. Our team will retry.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});
  notifyAllAdmins({
    event: NOTIFICATION_EVENT.REFUND_FAILED, title: 'Refund failed',
    message: `${ret.returnNumber}: ${reason}`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/admin/returns/${ret._id}`,
  }).catch(() => {});

  return ret;
};

/**
 * The ONLY way a COD return's refund ever reaches a terminal state — there
 * is no automatic COD money-movement mechanism anywhere in this codebase
 * (Phase 6M audit finding). An admin manually confirms the cash was
 * actually handed/transferred back to the customer.
 */
export const markCodRefundSettled = async ({ returnId, adminId, note }) => {
  if (!note || !note.trim()) throw httpError(400, 'A settlement note is required (how/when the cash was returned)');

  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (ret.refundStatus !== RETURN_REFUND_STATUS.MANUAL_PENDING) {
    throw httpError(400, 'This return is not awaiting manual COD settlement', { code: 'INVALID_RETURN_STATUS_TRANSITION' });
  }

  const now = new Date();
  ret.status = RETURN_STATUS.REFUNDED;
  ret.refundStatus = RETURN_REFUND_STATUS.COMPLETED;
  ret.refundReference = 'MANUAL-COD';
  ret.refundedAt = now;
  ret.codSettledBy = adminId;
  ret.codSettledAt = now;
  ret.codSettlementNote = note;
  ret.history.push({ fromStatus: RETURN_STATUS.REFUND_PENDING, toStatus: RETURN_STATUS.REFUNDED, changedBy: adminId, changedByModel: 'Admin', changedByRole: 'admin', comment: `Manual COD settlement: ${note}`, timestamp: now });
  await ret.save();

  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.REFUND_COMPLETED, title: 'Refund completed',
    message: `₹${ret.refundAmount} has been refunded (cash/manual) for ${ret.returnNumber}.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});

  return ret;
};
