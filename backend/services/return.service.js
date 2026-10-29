import { itemGrossPaise, refundProductGst } from './productGst.service.js';
import { allocatePaise, cumulativePaise, moneyPaise } from '../utils/financeMoney.js';
import { discountAllocation } from './orderDiscounts.service.js';
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
import { ensureReturnObligation, processRefundObligation } from './paymentRecovery.service.js';
import { refundToWallet } from './wallet.service.js';
import { WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';
import { notifyUser, notifySeller, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';
import { mutateInventory } from './inventory.service.js';
import { financialTransaction } from './financeSafety.service.js';
import WalletLedger from '../models/WalletLedger.js';

/**
 * Canonical item-level Return backend. The legacy whole-order endpoint is
 * deprecated and points clients here. This workflow never sets
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
export const createReturnRequest = async ({ orderId, orderItemId, customerId, quantity, reason, customerDescription, attachments, requestKey }) => {
  if (requestKey != null && (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 100)) throw httpError(400, 'Invalid Idempotency-Key');
  const replay = requestKey && await Return.findOne({ customerId, requestKey });
  if (replay) {
    if (String(replay.orderId) !== String(orderId) || String(replay.orderItemId) !== String(orderItemId) || replay.quantity !== Number(quantity) || replay.reason !== reason || (replay.customerDescription || '') !== (customerDescription || '')) throw httpError(409, 'Return key reused with different data');
    return replay;
  }
  const { order, item } = await getReturnEligibility({ orderId, orderItemId, customerId, quantity });

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      if (requestKey) {
        const existing = await Return.findOne({ customerId, requestKey }).session(session);
        if (existing) {
          if (String(existing.orderId) !== String(orderId) || String(existing.orderItemId) !== String(orderItemId) || existing.quantity !== Number(quantity) || existing.reason !== reason || (existing.customerDescription || '') !== (customerDescription || '')) throw httpError(409, 'Return key reused with different data');
          created = existing; return;
        }
      }
      if (new Date(item.returnEligibleUntil) <= new Date()) throw httpError(409, 'Return window expired before reservation');
      if (order.financialSnapshot && item.sellerId) {
        const { default: Seller } = await import('../models/Seller.js');
        await Seller.updateOne({ _id: item.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
        if (new Date(item.returnEligibleUntil) <= new Date()) throw httpError(409, 'Return window expired before reservation');
      }
      const guardResult = await Order.updateOne(
        { _id: orderId, status: ORDER_STATUS.DELIVERED, items: { $elemMatch: { _id: orderItemId, returnEligibleUntil: { $gt: new Date() }, returnedQty: { $lte: item.qty - quantity } } } },
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
        ...(requestKey ? { requestKey } : {}),
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

  // Publish after commit, using the item owner's seller rather than every
  // seller on a mixed-store order. The shared pipeline persists, emits the
  // foreground popup event and sends the background push to that seller.
  if (created.sellerId) await notifySeller(created.sellerId, {
    event: NOTIFICATION_EVENT.RETURN_REQUESTED,
    dedupeKey: `seller-return-requested:${created._id}:${created.sellerId}`,
    title: 'New return request',
    message: `${created.returnNumber} — ${created.productName} × ${created.quantity}. Review it and approve or reject.`,
    metadata: { returnId: created._id, returnNumber: created.returnNumber, orderId: created.orderId },
    route: `/seller/item-returns?return=${created._id}`,
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

// The seller's side of the same transitions — what it means for them, not the
// customer-facing "Your return..." copy above.
const SELLER_RETURN_MESSAGE_BY_STATUS = {
  [RETURN_STATUS.APPROVED]:        (r) => `Return ${r.returnNumber} (${r.productName} × ${r.quantity}) was approved. Choose a pickup method to collect it.`,
  [RETURN_STATUS.REJECTED]:        (r) => `Return ${r.returnNumber} (${r.productName}) was rejected — no pickup is needed.`,
  [RETURN_STATUS.RETURN_RECEIVED]: (r) => `Return ${r.returnNumber} passed inspection (${r.restockDecision === RESTOCK_DECISION.RESTOCKABLE ? 'restocked' : 'not restocked'}).`,
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
      if (RETURN_QUANTITY_RELEASING_STATUSES.includes(toStatus) && (
        ret.pickupMethod && ret.pickup?.status !== 'CANCELLED' ||
        ['creating', 'booked', 'uncertain', 'cancel_pending'].includes(ret.reverseBooking?.state) ||
        ['ASSIGNED', 'PICKED_UP', 'DELIVERED_TO_SELLER'].includes(ret.pickup?.status)
      )) throw httpError(409, 'Cancel and reconcile the active pickup before closing this return');

      const fromStatus = ret.status;
      const now = new Date();

      ret.status = toStatus;
      if (toStatus === RETURN_STATUS.UNDER_REVIEW) { ret.reviewedAt = now; ret.reviewedBy = adminId; }
      if (toStatus === RETURN_STATUS.APPROVED)     ret.approvedAt = now;
      if (toStatus === RETURN_STATUS.REJECTED)     { ret.rejectedAt = now; ret.rejectionReason = rejectionReason; }
      if (toStatus === RETURN_STATUS.RETURN_RECEIVED) {
        if (ret.pickup?.status !== 'DELIVERED_TO_SELLER' || !ret.pickup?.sellerConfirmedReceivedAt) throw httpError(409, 'Seller receipt is required before inspection');
        if (![RESTOCK_DECISION.RESTOCKABLE, RESTOCK_DECISION.NON_RESTOCKABLE].includes(restockDecision)) throw httpError(400, 'An inspection/restock decision is required');
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
  }
  const sellerMessage = SELLER_RETURN_MESSAGE_BY_STATUS[toStatus];
  if (notif && sellerMessage && updated.sellerId) {
    notifySeller(updated.sellerId, {
      event: notif.event, title: notif.title, message: sellerMessage(updated),
      metadata: { returnId: updated._id, returnNumber: updated.returnNumber },
      route: `/seller/item-returns?return=${updated._id}`,
    }).catch(() => {});
  }

  return updated;
};

const adminComment = (c) => typeof c === 'string' && c.trim().length > 0;

/**
 * The seller's own approve/reject decision on a return of their item. Same
 * guards and side effects as the admin path (rejection reason, quantity
 * release on REJECTED), but scoped to the owning seller and limited to the
 * review decision — receipt/inspection and refunds stay with Admin. A request
 * still in RETURN_REQUESTED passes through UNDER_REVIEW in the history so the
 * audit trail keeps the same shape as an admin review.
 */
export const sellerDecideReturn = async ({ returnId, sellerId, sellerUserId, decision, rejectionReason, comment }) => {
  if (![RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED].includes(decision)) throw httpError(400, 'decision must be APPROVED or REJECTED');
  const reason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';
  if (decision === RETURN_STATUS.REJECTED && reason.length < 3) throw httpError(400, 'A rejection reason is required');

  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const ret = await Return.findById(returnId).session(session);
      // 404 on a mismatch — never confirms another seller's return exists.
      if (!ret || String(ret.sellerId) !== String(sellerId)) throw httpError(404, 'Return not found', { code: 'RETURN_NOT_FOUND' });
      if (![RETURN_STATUS.RETURN_REQUESTED, RETURN_STATUS.UNDER_REVIEW].includes(ret.status)) {
        throw httpError(409, `This return is already ${ret.status.replace(/_/g, ' ').toLowerCase()}`, { code: 'INVALID_RETURN_STATUS_TRANSITION' });
      }
      const now = new Date();
      const actor = { changedBy: sellerUserId, changedByModel: 'User', changedByRole: 'seller' };
      if (ret.status === RETURN_STATUS.RETURN_REQUESTED) {
        ret.history.push({ fromStatus: ret.status, toStatus: RETURN_STATUS.UNDER_REVIEW, ...actor, comment: 'Seller reviewed the request', timestamp: now });
        ret.status = RETURN_STATUS.UNDER_REVIEW;
      }
      ret.reviewedAt ||= now;
      ret.history.push({ fromStatus: ret.status, toStatus: decision, ...actor, comment: adminComment(comment) ? comment : (decision === RETURN_STATUS.REJECTED ? reason : 'Approved by seller'), timestamp: now });
      ret.status = decision;
      if (decision === RETURN_STATUS.APPROVED) ret.approvedAt = now;
      else { ret.rejectedAt = now; ret.rejectionReason = reason; }
      await ret.save({ session });

      if (RETURN_QUANTITY_RELEASING_STATUSES.includes(decision)) {
        await Order.updateOne({ _id: ret.orderId, 'items._id': ret.orderItemId }, { $inc: { 'items.$.returnedQty': -ret.quantity } }, { session });
      }
      updated = ret;
    });
  } finally {
    await session.endSession();
  }

  const notif = RETURN_NOTIFICATION_BY_STATUS[decision];
  notifyUser(updated.customerId, {
    event: notif.event, title: notif.title, message: notif.message(updated),
    metadata: { returnId: updated._id, returnNumber: updated.returnNumber },
    route: `/orders/${updated.orderId}`,
  }).catch(() => {});
  notifyAllAdmins({
    event: notif.event, title: decision === RETURN_STATUS.APPROVED ? 'Seller approved a return' : 'Seller rejected a return',
    message: `${updated.returnNumber} — ${updated.productName} × ${updated.quantity}${decision === RETURN_STATUS.REJECTED ? `: ${updated.rejectionReason}` : ''}`,
    metadata: { returnId: updated._id, returnNumber: updated.returnNumber },
    route: `/admin/returns/${updated._id}`,
  }).catch(() => {});

  return updated;
};

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
  if (order?.financialSnapshot?.version === 2 || order?.pricing?.discountRepresentation === 'components-v1') {
    const snapshot = order.financialSnapshot;
    const index = order.items.findIndex(item => String(item._id) === String(returnDoc.orderItemId));
    const item = order.items[index];
    if (!item) throw httpError(409, 'Refund item is missing');
    const gross = order.items.map(row => itemGrossPaise(row));
    const allocation = snapshot ? null : discountAllocation(order.pricing, gross);
    const taxLine = order.productTax?.lines.find(row => row.itemId === String(returnDoc.orderItemId));
    const line = taxLine ? { ...taxLine, eligiblePaise: taxLine.customerPaidPaise } : snapshot?.lines.find(row => row.itemId === String(returnDoc.orderItemId));
    if (snapshot && !line) throw httpError(409, 'Frozen refund allocation is missing');
    const discounts = line?.allocatedDiscounts || Object.fromEntries(allocation.keys.map(key => [key, allocation.discounts[key][index]]));
    const before = returnDoc.refundAllocationStartQuantity ?? 0;
    const after = before + returnDoc.quantity;
    const share = amount => cumulativePaise(amount, after, item.qty) - cumulativePaise(amount, before, item.qty);
    const grossPaise = line?.grossPaise ?? gross[index];
    const eligible = line?.eligiblePaise ?? grossPaise - Object.values(discounts).reduce((a,b) => a+b,0);
    return { productTax: taxLine ? refundProductGst(taxLine, before, returnDoc.quantity) : undefined, itemGrossAmount: share(grossPaise)/100, allocatedCouponDiscount: share(discounts.couponDiscount || 0)/100,
      allocatedPromotionDiscount: share(discounts.discount || 0)/100, allocatedCdsDiscount: share(discounts.cdsDiscount || 0)/100, allocatedLegacyDiscount: share(discounts.cdsDiscount || 0)/100,
      allocatedCoinDiscount: share(discounts.coinDiscount || 0)/100, allocatedCoinsCount: share(allocatePaise(order.pricing.coinsUsed || 0, gross)[index]),
      refundAmount: share(eligible)/100, limitations: ['Frozen conserved merchandise allocation; delivery is excluded.'] };
  }
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

  return { itemGrossAmount, allocatedCouponDiscount, allocatedLegacyDiscount, allocatedCdsDiscount: allocatedLegacyDiscount, allocatedCoinDiscount, allocatedCoinsCount, refundAmount, limitations };
};

/* ============================================================================
 * REFUND EXECUTION (Phase 6)
 * ========================================================================== */

const REFUND_LOCK_STALE_MS = 5 * 60 * 1000;
const refundIdempotencyKey = (returnId) => `RETURN_REFUND:${returnId}`;

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

const releaseRefundLock = async (returnId, lockedAt) => {
  await Return.updateOne({ _id: returnId, refundLockedAt: lockedAt }, { $unset: { refundLockedAt: 1 } });
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
    if (!ret.receivedAt || ![RESTOCK_STATUS.RESTOCKED, RESTOCK_STATUS.NOT_RESTOCKED].includes(ret.restockStatus)) throw httpError(409, 'Receipt and completed inspection are required before refund');

    // Freeze the breakdown once, on first entry — never silently recomputed
    // on a retry, so the audited figure can never drift.
    if ((order.financialSnapshot?.version === 2 || order.pricing?.discountRepresentation === 'components-v1') && ret.refundAllocationStartQuantity == null) {
      const { financialTransaction } = await import('./financeSafety.service.js');
      const start = await financialTransaction(async session => {
        await Order.updateOne({ _id: order._id }, { $inc: { financialRevision: 1 } }, { session });
        const fresh = await Return.findById(ret._id).session(session);
        if (fresh.refundAllocationStartQuantity != null) return fresh.refundAllocationStartQuantity;
        const earlier = await Return.find({ orderId: order._id, orderItemId: ret.orderItemId, _id: { $ne: ret._id }, refundAllocationStartQuantity: { $exists: true } }).session(session);
        const next = earlier.reduce((sum, row) => sum + row.quantity, 0);
        const item = order.items.find(row => String(row._id) === String(ret.orderItemId));
        if (!item || next + ret.quantity > item.qty) throw httpError(409, 'Refund allocation quantity conflict');
        await Return.updateOne({ _id: ret._id }, { $set: { refundAllocationStartQuantity: next } }, { session });
        return next;
      });
      ret.refundAllocationStartQuantity = start;
    }
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

    if ([PAYMENT_METHOD.COD, PAYMENT_METHOD.WALLET].includes(payment.method)) {
      const credit = await creditReturnWallet(ret, order);
      ret.refundDestination = 'wallet';
      return await completeRefund(ret, { refundReference: credit.transactionId, refundStatus: RETURN_REFUND_STATUS.COMPLETED, adminId, note: 'Refund credited to Bulkimart Wallet' });
    }

    // A provider-verified obligation may already be processed if Return
    // finalization was interrupted. Recover it before the legacy paid-state
    // guard, which would otherwise reject the now-refunded Payment.
    if (payment.gateway?.provider === 'razorpay' && payment.method === PAYMENT_METHOD.ONLINE) {
      ret.refundDestination = 'original_source';
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

    // Legacy PhonePe evidence remains readable, but new requests cannot use
    // the retired branch, which has no obligation/reconciliation contract.
    throw httpError(409, 'This payment provider requires historical refund reconciliation; new refunds are disabled');

  } finally {
    await releaseRefundLock(returnId, locked.refundLockedAt);
  }
};

/** Resolve an asynchronous Razorpay refund webhook exactly once. */
export const settleRazorpayRefundWebhook = async ({ refundId, state, errorCode }) => {
  if (!refundId || !['COMPLETED', 'FAILED'].includes(state)) return { changed: false };
  const ret = await Return.findOne({ refundReference: refundId });
  if (!ret || ret.status === RETURN_STATUS.REFUNDED) {
    return { changed: false };
  }
  const payment = await Payment.findOne({ 'refund.razorpayRefId': refundId });

  if (state === 'FAILED') {
    if (payment) {
      await Payment.updateOne({ _id: payment._id, 'refund.razorpayRefId': refundId, 'refund.status': { $ne: 'processed' } }, { $set: { 'refund.status': 'failed', 'refund.gatewayState': 'FAILED' } });
    }
    await failRefund(ret, `Razorpay reported the refund as failed (${errorCode || 'no code'})`);
    return { changed: true, status: 'failed' };
  }

  if (payment) await financialTransaction(async session => {
    const current = await Payment.findOneAndUpdate({ _id: payment._id, 'refund.razorpayRefId': refundId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
    if (!current || current.refund.status === 'processed') return;
    const total = moneyPaise(current.refund.totalRefundedAmount || 0) + moneyPaise(current.refund.amount || 0);
    if (total > moneyPaise(current.amount)) throw httpError(409, 'Legacy refund totals require reconciliation');
    current.refund.status = 'processed'; current.refund.processedAt = new Date(); current.refund.gatewayState = 'COMPLETED';
    current.refund.totalRefundedAmount = total / 100;
    current.status = total === moneyPaise(current.amount) ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIAL_REFUND;
    await current.save({ session });
  });
  await completeRefund(ret, {
    refundReference: refundId,
    refundStatus: RETURN_REFUND_STATUS.COMPLETED,
    note: 'Razorpay refund completed',
  });
  return { changed: true, status: 'completed' };
};

// Credit and payment projection share one commit. A crash before Return
// finalization is recovered from this exact ledger reference on the next call.
const creditReturnWallet = async (ret, order) => financialTransaction(async session => {
  const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
  if (!payment || String(payment.userId) !== String(ret.customerId) || !(payment.groupRef && payment.groupRef === order.groupRef || String(payment.orderId) === String(order._id))) throw httpError(409, 'Refund payment ownership mismatch');
  const fresh = await Return.findById(ret._id).session(session);
  if (fresh.codSettledAt || fresh.refundReference === 'MANUAL-COD' || fresh.refundStatus === 'manual_pending') throw httpError(409, 'Historical offline refund requires reconciliation before wallet credit');
  const key = refundIdempotencyKey(ret._id);
  const prior = await WalletLedger.findOne({ idempotencyKey: key }).session(session);
  if (prior) {
    if (String(prior.userId) !== String(ret.customerId) || prior.amount !== ret.refundAmount || prior.direction !== 'credit' || prior.status !== 'completed') throw httpError(409, 'Wallet refund evidence mismatch');
    return prior;
  }
  if (payment.method === PAYMENT_METHOD.WALLET && ![PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIAL_REFUND].includes(payment.status)) throw httpError(409, 'Wallet payment is not refundable');
  // The customer has paid once the rider records collecting their cash; the
  // rider's later handover to Bulkimart is an internal step and must not hold
  // the customer's refund. Until that cash is confirmed the payment stays
  // pending (its refund is still recorded), so it is never shown as paid early.
  const cashConfirmed = payment.method !== PAYMENT_METHOD.COD || ['paid', 'partial_refund'].includes(payment.status);
  if (!cashConfirmed) {
    const cash = (await Order.findById(order._id).select('codFinance').session(session).lean())?.codFinance;
    const collected = ['collected', 'remittance_reported', 'verified', 'allocated', 'discrepancy', 'disputed'].includes(cash?.status) ? cash.collectedPaise || 0 : 0;
    if (!collected) throw httpError(409, 'The rider has not recorded collecting this COD payment yet. Record the cash collection (Finance Center → COD cash) before refunding.');
    if (moneyPaise(ret.refundAmount) > collected) throw httpError(409, 'Refund exceeds the cash the customer paid');
  }
  const refunded = moneyPaise(payment.refund?.totalRefundedAmount || 0) + moneyPaise(ret.refundAmount);
  if (refunded > moneyPaise(payment.amount)) throw httpError(409, 'Refund exceeds original payment');
  const result = await refundToWallet({ userId: ret.customerId, amount: ret.refundAmount, reason: `Refund for ${ret.returnNumber}`, referenceType: WALLET_REFERENCE_TYPE.RETURN, referenceId: String(ret._id), idempotencyKey: key, session });
  payment.refund ||= {};
  payment.refund.totalRefundedAmount = refunded / 100;
  payment.refund.amount = ret.refundAmount;
  payment.refund.status = 'processed';
  payment.refund.processedAt = new Date();
  if (cashConfirmed) payment.status = refunded === moneyPaise(payment.amount) ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIAL_REFUND;
  await payment.save({ session });
  await Return.updateOne({ _id: ret._id }, { $set: { refundDestination: 'wallet', refundReference: result.transaction.transactionId } }, { session });
  return result.transaction;
});

/** Shared terminal-success path: coin evidence and Return commit together. */
const completeRefund = async (original, { refundReference, refundStatus, adminId, note }) => {
  const ret = await financialTransaction(async session => {
  const ret = await Return.findById(original._id).session(session);
  if (ret.status === RETURN_STATUS.REFUNDED) return ret;
  if (!['REFUND_PENDING', 'REFUND_FAILED'].includes(ret.status) || !ret.receivedAt || !['RESTOCKED', 'NOT_RESTOCKED'].includes(ret.restockStatus)) throw httpError(409, 'Refund finalization requires received and inspected return');
  ret.refundDestination = original.refundDestination || (ret.refundAmount === 0 ? 'none' : ret.refundDestination);
  const breakdown = ret.refundBreakdown || {};
  if (breakdown.allocatedCoinsCount > 0) {
    await coinService.refundRedeemedCoins({
      userId: ret.customerId,
      amount: breakdown.allocatedCoinsCount,
      referenceType: 'RETURN',
      referenceId: ret._id,
      idempotencyKey: `${refundIdempotencyKey(ret._id)}:COINS`,
      description: `Coins restored for return ${ret.returnNumber}`,
      session,
    });
  }

  const now = new Date();
  ret.status = RETURN_STATUS.REFUNDED;
  ret.refundStatus = refundStatus;
  ret.refundReference = refundReference;
  ret.refundedAt = now;
  if (ret.refundAmount === 0) {
    if (!adminId || refundReference) throw httpError(409, 'Zero refund requires internal actor evidence only');
    ret.zeroRefundEvidence = { key: `ZERO_RETURN:${ret._id}`, actorId: adminId, reason: note, completedAt: now };
  }
  ret.history.push({ fromStatus: RETURN_STATUS.REFUND_PENDING, toStatus: RETURN_STATUS.REFUNDED, changedBy: adminId, changedByModel: 'Admin', changedByRole: 'admin', comment: note, timestamp: now });
  await ret.save({ session });
  return ret;
  });
  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.REFUND_COMPLETED, title: 'Refund completed',
    message: `₹${ret.refundAmount} has been refunded for ${ret.returnNumber}.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber, refundAmount: ret.refundAmount },
    route: `/orders/${ret.orderId}`,
  }).catch(() => {});
  // The refund reduces the seller's earning for this item, so they hear about it.
  if (ret.sellerId) notifySeller(ret.sellerId, {
    event: NOTIFICATION_EVENT.REFUND_COMPLETED, title: 'Return refunded', dedupeKey: `seller-return-refunded:${ret._id}`,
    message: `The customer was refunded ₹${ret.refundAmount} for ${ret.returnNumber}. Your earning for this item is adjusted in Earnings.`,
    metadata: { returnId: ret._id, returnNumber: ret.returnNumber },
    route: `/seller/item-returns?return=${ret._id}`,
  }).catch(() => {});

  return ret;
};

/** Shared failure path: REFUND_FAILED, safely retryable, never claims success. */
const failRefund = async (ret, reason) => {
  const now = new Date();
  const changed = await Return.findOneAndUpdate({ _id: ret._id, status: { $in: [RETURN_STATUS.REFUND_PENDING, RETURN_STATUS.REFUND_FAILED] } }, {
    $set: { status: RETURN_STATUS.REFUND_FAILED, refundStatus: RETURN_REFUND_STATUS.FAILED, refundFailureReason: reason },
    $push: { history: { fromStatus: RETURN_STATUS.REFUND_PENDING, toStatus: RETURN_STATUS.REFUND_FAILED, comment: reason, timestamp: now } },
  }, { returnDocument: 'after' });
  if (!changed) return Return.findById(ret._id); // Late failure cannot undo terminal success.
  ret = changed;

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

/** Read-only compatibility for historical offline COD settlements. */
export const markCodRefundSettled = async ({ returnId }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (ret.status === 'REFUNDED' && ret.refundReference === 'MANUAL-COD' && ret.codSettledAt) return ret;
  throw httpError(409, 'Offline COD refunds are retired. Use the refund endpoint to credit Bulkimart Wallet; reconcile historical cash payments separately.');
};
