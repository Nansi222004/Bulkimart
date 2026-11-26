import Order from '../models/Order.js';
import { ORDER_STATUS } from '../constants/enums.js';
import { httpError } from '../utils/response.js';
import { parseExternalShipmentInput } from './deliveryMethod.service.js';
import { stampDelivered } from './courierTracking.service.js';
import { notifyUser, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Self Delivery by the seller's own courier, after hand-off: corrections, failed attempts, the customer's
 * "not received" report, admin resolution, and the confirmation hold on seller earnings.
 *
 * Nobody but the seller reports these deliveries, so a "Delivered" from the seller is not proof on its own.
 * Seller earnings (and the delivery fee, when credited to the seller) are therefore posted only after a
 * confirmation hold has passed with no open "not received" report from the customer. An admin can confirm a
 * delivery, record a failed attempt, or cancel and refund an order that never arrived — but only before any
 * earnings were posted, so no posted money ever has to be clawed back.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CORRECTIONS = 3;
const ACTIVE = [ORDER_STATUS.DISPATCHED, ORDER_STATUS.OUT_FOR_DELIVERY];

/** Days a seller-reported delivery waits for the customer before earnings post (EXTERNAL_DELIVERY_HOLD_DAYS, default 7). */
export const externalDeliveryHoldDays = () => {
  const days = Number(process.env.EXTERNAL_DELIVERY_HOLD_DAYS);
  return Number.isFinite(days) && days >= 0 && days <= 60 ? days : 7;
};

/** True while earnings for this order must not post: hold still running, or a "not received" report open. */
export const externalDeliveryHoldOpen = (order, now = new Date()) => {
  if (order?.deliveryType !== 'external') return false;
  if (order.externalShipment?.dispute?.status === 'open') return true;
  const delivered = order.deliveredAt ? new Date(order.deliveredAt).getTime() : NaN;
  if (!Number.isFinite(delivered)) return true;
  return delivered + externalDeliveryHoldDays() * DAY_MS > new Date(now).getTime();
};

/** Mongo filter for orders whose earnings may post (finance automation). */
export const externalHoldClearedFilter = (now = Date.now()) => ({ $or: [
  { deliveryType: { $ne: 'external' } },
  { 'externalShipment.dispute.status': { $ne: 'open' }, deliveredAt: { $lte: new Date(now - externalDeliveryHoldDays() * DAY_MS) } },
] });

const reasonOf = (value, label = 'a reason') => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 5 || text.length > 300) throw httpError(400, `Give ${label} (5–300 characters)`);
  return text;
};

const loadExternal = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.deliveryType !== 'external' || !order.externalShipment) throw httpError(409, 'This order is not with a seller-arranged courier');
  return order;
};

const commit = async (order, update) => {
  const saved = await Order.findOneAndUpdate({ _id: order._id, __v: order.__v, status: order.status }, { ...update, $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: true });
  if (!saved) throw httpError(409, 'The order changed. Refresh it and try again.');
  return saved;
};

const tellCustomer = (order, message) => notifyUser(order.userId, {
  event: NOTIFICATION_EVENT.ORDER_STATUS_UPDATED, title: `Update on order ${order.orderNo}`, message, metadata: { orderId: order._id }, route: '/orders',
}).catch(() => {});
const tellAdmins = (order, message) => notifyAllAdmins({
  event: NOTIFICATION_EVENT.SYSTEM, title: 'Self Delivery needs review', message, metadata: { orderId: String(order._id) }, route: '/admin/shipment-exceptions',
}).catch(() => {});

/**
 * Seller: correct the tracking details (before delivery, at most three times, with a reason), or report a
 * failed delivery attempt. Ownership is checked by the caller (fulfillment.controller.js::sellerAndOrder).
 */
export const sellerUpdateExternalShipment = async ({ order, body = {} }) => {
  if (order.deliveryType !== 'external' || !order.externalShipment) throw httpError(409, 'This order is not with your own courier');
  if (!ACTIVE.includes(order.status)) throw httpError(409, 'The delivery is already finished and can no longer be changed');
  const now = new Date();
  if (body.action === 'correct_tracking') {
    const reason = reasonOf(body.reason, 'the reason for the correction');
    const ext = order.externalShipment;
    if ((ext.corrections?.length || 0) >= MAX_CORRECTIONS) throw httpError(409, 'Tracking was already corrected three times. Contact support to change it again.');
    const next = parseExternalShipmentInput({
      courierName: body.courierName ?? ext.courierName, awb: body.awb ?? ext.awb,
      trackingUrl: body.trackingUrl ?? ext.trackingUrl, dispatchDate: body.dispatchDate ?? ext.dispatchedAt,
    }, { orderPlacedAt: order.createdAt });
    if (['courierName', 'awb', 'trackingUrl'].every(key => next[key] === ext[key]) && +next.dispatchedAt === +new Date(ext.dispatchedAt)) throw httpError(400, 'Nothing was changed');
    const reused = await Order.find({ _id: { $ne: order._id }, 'externalShipment.awb': next.awb }).select('externalShipment.courierName').lean();
    if (reused.some(row => row.externalShipment?.courierName?.toLowerCase() === next.courierName.toLowerCase())) throw httpError(409, 'This tracking ID is already used on another order.');
    const saved = await commit(order, {
      $set: { 'externalShipment.courierName': next.courierName, 'externalShipment.awb': next.awb, 'externalShipment.trackingUrl': next.trackingUrl, 'externalShipment.dispatchedAt': next.dispatchedAt },
      $push: { 'externalShipment.corrections': { at: now, by: 'seller', reason, previous: { courierName: ext.courierName, awb: ext.awb, trackingUrl: ext.trackingUrl, dispatchedAt: ext.dispatchedAt } },
        timeline: { status: order.status, timestamp: now, note: `Seller corrected the tracking details: ${reason}` } },
    });
    tellCustomer(saved, `The tracking details for order ${saved.orderNo} were updated: ${next.courierName} · ${next.awb}.`);
    return saved;
  }
  if (body.action === 'delivery_failed') {
    const reason = reasonOf(body.reason, 'what happened');
    const saved = await commit(order, {
      $set: { 'externalShipment.status': 'delivery_failed', 'externalShipment.failure': { reason, at: now, by: 'seller' } },
      $push: { 'externalShipment.events': { status: 'delivery_failed', at: now, by: 'seller', note: reason },
        timeline: { status: order.status, timestamp: now, note: `Delivery attempt failed: ${reason}` } },
    });
    tellCustomer(saved, `The courier could not deliver order ${saved.orderNo}: ${reason}. The seller will try again or contact you.`);
    tellAdmins(saved, `Order ${saved.orderNo}: the seller reported a failed delivery (${reason}).`);
    return saved;
  }
  throw httpError(400, 'Choose correct_tracking or delivery_failed');
};

/** Customer: report that a seller-reported delivery never arrived, while the confirmation hold is running. */
export const reportExternalNotReceived = async ({ orderId, userId, reason }) => {
  const note = reasonOf(reason, 'a short description');
  const order = await loadExternal(orderId);
  if (String(order.userId) !== String(userId)) throw httpError(403, 'This is not your order');
  if (order.status !== ORDER_STATUS.DELIVERED) throw httpError(409, 'Only a delivered order can be reported as not received');
  if (order.externalShipment.dispute?.status) throw httpError(409, 'This order was already reported');
  if (order.financialPosting || !externalDeliveryHoldOpen(order)) throw httpError(409, 'The time to report this delivery has passed. Contact support.');
  const now = new Date();
  const saved = await commit(order, {
    $set: { 'externalShipment.dispute': { status: 'open', reason: note, openedAt: now } },
    $push: { 'externalShipment.events': { status: 'not_received_reported', at: now, by: 'customer', note } },
  });
  tellAdmins(saved, `Order ${saved.orderNo}: the customer says the seller-delivered parcel did not arrive (${note}).`);
  return saved;
};

/**
 * Admin (finance permission): resolve a seller-arranged delivery.
 *   mark_out_for_delivery / mark_delivered / mark_delivery_failed — record what the courier confirms
 *   confirm_delivered — close a customer's "not received" report as delivered
 *   cancel_refund — the parcel never arrived: cancel, refund through the usual cancellation path, optional restock
 * Cancel is allowed only before any earnings were posted for the order.
 */
export const adminResolveExternalShipment = async ({ orderId, adminId, action, reason, restock = false }) => {
  const note = reasonOf(reason, 'a note explaining the decision');
  const order = await loadExternal(orderId);
  const now = new Date();
  const by = 'admin';
  if (action === 'mark_out_for_delivery' || action === 'mark_delivery_failed') {
    if (!ACTIVE.includes(order.status)) throw httpError(409, 'The delivery is already finished');
    const failed = action === 'mark_delivery_failed';
    if (!failed && order.status !== ORDER_STATUS.DISPATCHED && order.externalShipment.status !== 'delivery_failed') throw httpError(409, 'The order is already out for delivery');
    return commit(order, {
      $set: failed ? { 'externalShipment.status': 'delivery_failed', 'externalShipment.failure': { reason: note, at: now, by } }
        : { status: ORDER_STATUS.OUT_FOR_DELIVERY, 'externalShipment.status': 'out_for_delivery' },
      $push: { 'externalShipment.events': { status: failed ? 'delivery_failed' : 'out_for_delivery', at: now, by, note },
        timeline: { status: failed ? order.status : ORDER_STATUS.OUT_FOR_DELIVERY, timestamp: now, note: `Admin: ${note}` } },
    });
  }
  if (action === 'mark_delivered') {
    if (!ACTIVE.includes(order.status)) throw httpError(409, 'The delivery is already finished');
    stampDelivered(order, now);
    return commit(order, {
      $set: { status: ORDER_STATUS.DELIVERED, deliveredAt: now, items: order.items, 'externalShipment.status': 'delivered', 'externalShipment.deliveredAt': now },
      $push: { 'externalShipment.events': { status: 'delivered', at: now, by, note }, timeline: { status: ORDER_STATUS.DELIVERED, timestamp: now, note: `Admin confirmed delivery: ${note}` } },
    });
  }
  if (action === 'confirm_delivered') {
    if (order.externalShipment.dispute?.status !== 'open') throw httpError(409, 'There is no open "not received" report on this order');
    const saved = await commit(order, {
      $set: { 'externalShipment.dispute.status': 'resolved', 'externalShipment.dispute.resolution': 'confirmed_delivered',
        'externalShipment.dispute.resolvedAt': now, 'externalShipment.dispute.resolvedBy': adminId, 'externalShipment.dispute.note': note },
      $push: { 'externalShipment.events': { status: 'dispute_resolved_delivered', at: now, by, note } },
    });
    tellCustomer(saved, `We checked order ${saved.orderNo} with the seller's courier: it was delivered. ${note}`);
    return saved;
  }
  if (action === 'cancel_refund') {
    if (typeof restock !== 'boolean') throw httpError(400, 'Restock must be yes or no');
    if (order.financialPosting) throw httpError(409, 'Earnings for this order were already posted. Use the return and refund process instead.');
    const disputed = order.externalShipment.dispute?.status === 'open';
    if (order.status === ORDER_STATUS.DELIVERED && !disputed) throw httpError(409, 'A delivered order can be cancelled here only when the customer reported it as not received');
    if (![...ACTIVE, ORDER_STATUS.DELIVERED].includes(order.status)) throw httpError(409, `An order that is ${order.status} cannot be cancelled here`);
    const { cancelOrderAndRestore } = await import('../controllers/order.controller.js');
    const result = await cancelOrderAndRestore(order._id, {
      reason: `Seller-arranged delivery did not arrive: ${note}`, cancelledBy: 'admin',
      externalCourier: { allowedStatuses: [order.status], restock, version: order.__v },
    });
    if (!result.ok) throw httpError(409, result.reason || 'The order could not be cancelled');
    return Order.findOneAndUpdate({ _id: order._id }, {
      $set: disputed ? { 'externalShipment.dispute.status': 'resolved', 'externalShipment.dispute.resolution': 'cancelled_refunded',
        'externalShipment.dispute.resolvedAt': now, 'externalShipment.dispute.resolvedBy': adminId, 'externalShipment.dispute.note': note } : {},
      $push: { 'externalShipment.events': { status: 'cancelled_refunded', at: now, by, note: `${note}${restock ? ' (stock restored)' : ''}` } },
    }, { returnDocument: 'after' });
  }
  throw httpError(400, 'Unknown action');
};

/** Admin list: seller-arranged deliveries that failed or were reported as not received. */
export const listExternalShipmentIssues = async ({ page = 1, limit = 20 } = {}) => {
  const filter = { deliveryType: 'external', $or: [{ 'externalShipment.dispute.status': 'open' }, { 'externalShipment.status': 'delivery_failed', status: { $in: ACTIVE } }] };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select('orderNo status userId paymentMethod pricing.totalAmount items.name items.qty items.sellerId externalShipment deliveredAt financialPosting createdAt').lean(),
    Order.countDocuments(filter),
  ]);
  return { rows, total, page, limit };
};
