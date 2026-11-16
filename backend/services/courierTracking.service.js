import crypto from 'node:crypto';
import Order from '../models/Order.js';
import CourierEventLog from '../models/CourierEventLog.js';
import { ORDER_STATUS } from '../constants/enums.js';
import { httpError } from '../utils/response.js';
import { notifyUser, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Shiprocket forward-shipment tracking: webhook scans and scheduled reconciliation drive the order through its
 * existing courier transitions (dispatched → out_for_delivery → delivered), and shipment problems are flagged
 * for an admin decision. Nothing here refunds, restocks, cancels or posts finance: delivery stamps the same
 * fields a seller's manual "Delivered" always did (return window, Coins), and finance automation picks the
 * order up exactly as before. Return pickups are tracked separately (returnCourier.service.js).
 */

/** Bulkimart's own shipment-setup states; tracking must never overwrite or act through them. */
export const SETUP_LOCK_STATES = ['creating', 'assigning', 'reconciliation_required'];

/**
 * Courier COD is not settleable yet (audit H1): COD cash is verified only through a rider's code-verified
 * delivery (orderFinance.service.js::recordCodEvent), so a Shiprocket COD order could never mark its payment
 * paid, post the seller's earning, or refund a return. Until courier remittance is reconciled, new Shiprocket
 * bookings (and the Quick Shiprocket fee that precedes them) are refused for COD orders. Rider-delivered COD
 * is unaffected, a Delivered scan never marks COD paid, and existing records are not changed.
 */
export const SHIPROCKET_COD_UNAVAILABLE = 'SHIPROCKET_COD_UNAVAILABLE';
export const SHIPROCKET_COD_MESSAGE = 'Cash on Delivery orders cannot be shipped with Shiprocket yet, because courier cash collection is not reconciled in Bulkimart. Deliver this order with a Bulkimart delivery partner, or contact support.';
export const shiprocketCodBlocked = (order) => order?.paymentMethod === 'cod';
export const assertShiprocketCodAllowed = (order) => {
  if (shiprocketCodBlocked(order)) throw httpError(409, SHIPROCKET_COD_MESSAGE, { code: SHIPROCKET_COD_UNAVAILABLE });
};

const step = (key, rank, extra = {}) => ({ key, rank, ...extra });
/**
 * Shiprocket shipment_status_id → forward journey. `rank` orders scans so late or out-of-order events never
 * move a shipment backwards; `order` is the order status the scan proves; `exception` flags admin review.
 * Delivered is final. RTO delivered, destroyed and shipment-cancelled outrank delivered so a stray scan can't
 * turn a returned parcel into a delivery; lost/damaged rank below it, because a parcel found and delivered
 * later is genuinely delivered.
 */
export const FORWARD_STATUS = {
  1: step('AWB_ASSIGNED', 0),
  3: step('PICKUP_SCHEDULED', 1), 4: step('PICKUP_QUEUED', 1), 15: step('PICKUP_RESCHEDULED', 1),
  19: step('OUT_FOR_PICKUP', 1), 13: step('PICKUP_ERROR', 1), 20: step('PICKUP_EXCEPTION', 1),
  42: step('PICKED_UP', 2, { order: ORDER_STATUS.DISPATCHED }),
  6: step('SHIPPED', 3, { order: ORDER_STATUS.DISPATCHED }), 18: step('IN_TRANSIT', 3, { order: ORDER_STATUS.DISPATCHED }),
  38: step('REACHED_DESTINATION_HUB', 3, { order: ORDER_STATUS.DISPATCHED }), 22: step('DELAYED', 3),
  17: step('OUT_FOR_DELIVERY', 4, { order: ORDER_STATUS.OUT_FOR_DELIVERY }),
  21: step('UNDELIVERED', 4, { exception: 'UNDELIVERED' }),
  9: step('RTO_INITIATED', 6, { exception: 'RTO_INITIATED' }), 14: step('RTO_ACKNOWLEDGED', 6, { exception: 'RTO_INITIATED' }),
  40: step('RTO_NDR', 6, { exception: 'RTO_INITIATED' }), 41: step('RTO_OUT_FOR_DELIVERY', 6, { exception: 'RTO_INITIATED' }),
  46: step('RTO_IN_TRANSIT', 6, { exception: 'RTO_INITIATED' }),
  12: step('LOST', 9, { exception: 'LOST' }), 76: step('UNTRACEABLE', 9, { exception: 'LOST' }),
  25: step('DAMAGED', 9, { exception: 'DAMAGED' }),
  7: step('DELIVERED', 10, { order: ORDER_STATUS.DELIVERED }),
  10: step('RTO_DELIVERED', 11, { exception: 'RTO_DELIVERED' }),
  24: step('DESTROYED', 11, { exception: 'DESTROYED' }), 44: step('DISPOSED_OFF', 11, { exception: 'DESTROYED' }),
  8: step('CANCELLED', 11, { exception: 'CANCELLED' }), 45: step('CANCELLED', 11, { exception: 'CANCELLED' }),
};
const DELIVERED_ID = 7;
/** Status text → id, only when a payload carries no numeric id. */
const STATUS_TEXT = {
  'DELIVERED': 7, 'OUT FOR DELIVERY': 17, 'IN TRANSIT': 18, 'SHIPPED': 6, 'PICKED UP': 42, 'PICKUP SCHEDULED': 3,
  'OUT FOR PICKUP': 19, 'UNDELIVERED': 21, 'RTO INITIATED': 9, 'RTO ACKNOWLEDGED': 14, 'RTO NDR': 40, 'RTO OFD': 41,
  'RTO IN TRANSIT': 46, 'RTO DELIVERED': 10, 'LOST': 12, 'UNTRACEABLE': 76, 'DAMAGED': 25, 'DESTROYED': 24,
  'DISPOSED OFF': 44, 'CANCELED': 8, 'CANCELLED': 8, 'AWB ASSIGNED': 1, 'REACHED AT DESTINATION HUB': 38,
};
// Severity of exception types, so a later, worse scan upgrades an open exception (never downgrades it).
const EXCEPTION_SEVERITY = { UNDELIVERED: 1, RTO_INITIATED: 2, RTO_DELIVERED: 3, LOST: 3, DAMAGED: 3, DESTROYED: 3, CANCELLED: 3 };
/** Exceptions where the parcel's journey is over, so an admin may cancel and refund. */
export const FINAL_EXCEPTIONS = ['RTO_DELIVERED', 'LOST', 'DAMAGED', 'DESTROYED', 'CANCELLED'];
/** Exceptions where the goods are physically back with the seller, so restocking is possible. */
export const RESTOCKABLE_EXCEPTIONS = ['RTO_DELIVERED', 'CANCELLED'];

const clean = (value) => String(value ?? '').trim();
export const resolveStatusId = (statusId, status) => {
  const id = Number(statusId);
  if (Number.isInteger(id) && id > 0) return id;
  return STATUS_TEXT[clean(status).toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')] || null;
};
/** Shiprocket booked this shipment itself (as opposed to a seller typing another courier's tracking number). */
export const isShiprocketBooked = (order) => Boolean(order?.deliveryType === 'shiprocket' && order.shiprocket?.orderId && order.shiprocket?.shipmentId);

const SAFE_FIELDS = ['awb', 'awb_code', 'courier_name', 'current_status', 'current_status_id', 'shipment_status', 'shipment_status_id',
  'current_timestamp', 'etd', 'is_return', 'sr_order_id', 'order_id', 'shipment_id', 'event_id'];
/** Tracking fields only — never the customer's name, address or phone. */
export const safePayload = (body = {}) => Object.fromEntries(SAFE_FIELDS.filter((key) => body[key] != null).map((key) => [key, typeof body[key] === 'object' ? undefined : String(body[key]).slice(0, 200)]));

export const logCourierEvent = (entry) => CourierEventLog.create(entry).catch((err) => console.error('[COURIER LOG] not written:', err.message));

/**
 * The delivery stamps, shared by a seller's manual "Delivered" (non-Shiprocket couriers) and Shiprocket's
 * confirmation: delivered time, each item's return window and Coins eligibility. Unchanged from the rules the
 * seller path always applied, so return eligibility and finance timing are identical either way.
 */
export const stampDelivered = (order, deliveredAt = new Date()) => {
  order.deliveredAt = deliveredAt;
  for (const item of order.items) {
    const { returnEligible, returnWindowDays } = item.returnPolicy || {};
    const eligibleUntil = returnEligible && Number.isFinite(returnWindowDays) && returnWindowDays > 0
      ? new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000)
      : null;
    item.deliveredAt = deliveredAt;
    item.returnEligibleUntil = eligibleUntil;
    item.coinRewardStatus = 'PENDING';
    item.coinRewardEligibleAt = eligibleUntil || deliveredAt;
  }
};

const ACTIVE_ORDER_STATES = [ORDER_STATUS.PREPARING, ORDER_STATUS.DISPATCHED, ORDER_STATUS.OUT_FOR_DELIVERY];
const JOURNEY = [ORDER_STATUS.PREPARING, ORDER_STATUS.DISPATCHED, ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED];

/** Move the order forward along the existing courier transitions; returns the new status or null. */
const advanceOrder = (order, target, label, now) => {
  if (!ACTIVE_ORDER_STATES.includes(order.status)) return null;
  const from = JOURNEY.indexOf(order.status), to = JOURNEY.indexOf(target);
  if (to <= from) return null;
  // Fill skipped steps (e.g. a missed pickup scan) so the timeline keeps the same shape a seller would leave.
  for (const status of JOURNEY.slice(from + 1, to + 1)) {
    order.timeline.push({ status, timestamp: now, note: status === target ? `Shiprocket: ${label}` : `Shiprocket: ${status.replace(/_/g, ' ')} (inferred from a later scan)` });
  }
  order.status = target;
  if (target === ORDER_STATUS.DELIVERED) {
    stampDelivered(order, now);
    order.shiprocket.deliveredConfirmedAt = now;
  }
  return target;
};

/** Open or upgrade the shipment exception; returns true when admins should be told. */
const flagException = (order, type, statusId, providerStatus, now) => {
  if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status)) return false;
  const current = order.shiprocket.exception;
  const entry = { type, statusId, providerStatus, at: now };
  if (!current?.status || current.status === 'resolved') {
    order.shiprocket.exception = { status: 'open', type, statusId, providerStatus, detectedAt: now, updatedAt: now, history: [...(current?.history || []), entry] };
    return true;
  }
  if (current.type === type && current.statusId === statusId) return false; // the same scan again (e.g. a poll)
  current.history.push(entry);
  current.updatedAt = now;
  current.providerStatus = providerStatus;
  current.statusId = statusId;
  if ((EXCEPTION_SEVERITY[type] || 0) > (EXCEPTION_SEVERITY[current.type] || 0)) {
    current.type = type;
    return current.status === 'open';
  }
  return false;
};

/**
 * Apply one forward tracking event (webhook or reconciliation poll). Validates the AWB/shipment pair against the
 * order, ignores duplicates and stale scans, never acts while shipment setup holds its lock, and moves the order
 * only along existing transitions. Every outcome is audit-logged. Concurrent scans for one order are serialized
 * by the order version and retried.
 */
export async function applyForwardTracking({ awb, shipmentId, statusId, status, eventId, environment, source = 'webhook', payload }) {
  awb = clean(awb); shipmentId = clean(shipmentId); status = clean(status);
  const resolvedId = resolveStatusId(statusId, status);
  const mapped = resolvedId ? FORWARD_STATUS[resolvedId] : null;
  const key = clean(eventId) || crypto.createHash('sha256')
    .update(JSON.stringify({ awb, shipmentId, resolvedId, status, at: payload?.current_timestamp || '' })).digest('hex');
  const base = { kind: source, direction: 'forward', environment, awb, shipmentId, statusId: resolvedId || undefined, status, eventId: key, payload };
  if (!awb && !shipmentId) { await logCourierEvent({ ...base, outcome: 'rejected', detail: 'missing shipment identity' }); throw httpError(400, 'Webhook is missing shipment identity'); }

  const filter = {
    ...(awb ? { 'shiprocket.awb': awb } : { 'shiprocket.shipmentId': shipmentId }),
    ...(environment === 'sandbox' ? { 'shiprocket.environment': 'sandbox' }
      : { $or: [{ 'shiprocket.environment': environment }, { 'shiprocket.environment': { $exists: false } }] }),
    ...(environment === 'live' ? { $nor: ['orderId', 'shipmentId', 'awb'].map((field) => ({ ['shiprocket.' + field]: /MOCK/i })) } : {}),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const order = await Order.findOne(filter);
    if (!order) { await logCourierEvent({ ...base, outcome: 'unmatched' }); return { matched: false, applied: false, outcome: 'unmatched' }; }
    const sr = order.shiprocket;
    if ((awb && sr.awb && sr.awb !== awb) || (shipmentId && sr.shipmentId && sr.shipmentId !== shipmentId)) {
      await logCourierEvent({ ...base, orderId: order._id, outcome: 'identity_mismatch', detail: 'AWB and shipment id belong to different shipments' });
      return { matched: true, applied: false, outcome: 'identity_mismatch' };
    }
    if ((sr.webhookEvents || []).some((event) => event.eventId === key)) {
      await logCourierEvent({ ...base, orderId: order._id, outcome: 'duplicate' });
      return { matched: true, applied: false, outcome: 'duplicate' };
    }

    const now = new Date();
    const locked = SETUP_LOCK_STATES.includes(sr.status);
    let outcome;
    if (!mapped) outcome = 'tracking_only';
    else if (sr.trackingStatusId === DELIVERED_ID || mapped.rank < (sr.trackingRank ?? -1)) outcome = 'stale';
    else if (locked) outcome = 'setup_locked';
    else if (!isShiprocketBooked(order)) outcome = 'tracking_only';
    else outcome = 'applied';

    sr.webhookEvents.push({ eventId: key, status: status || mapped?.key, receivedAt: now, statusId: resolvedId || undefined, source, outcome });
    let statusChanged = null, exceptionOpened = false, exceptionClosed = false;
    if (outcome !== 'stale') {
      sr.trackingStatus = status || mapped?.key;
      sr.trackingUpdatedAt = now;
      // The setup lock keeps its own state; existing screens read the courier scan from `status` afterwards.
      if (!locked) sr.status = status || mapped?.key;
    }
    if (outcome === 'applied') {
      sr.trackingStatusId = resolvedId;
      sr.trackingRank = mapped.rank;
      if (mapped.order) statusChanged = advanceOrder(order, mapped.order, status || mapped.key, now);
      if (mapped.exception) exceptionOpened = flagException(order, mapped.exception, resolvedId, status || mapped.key, now);
      // An exception an admin is deciding right now ('resolving') is left to that decision.
      if (statusChanged === ORDER_STATUS.DELIVERED && sr.exception?.status === 'open') {
        // Delivered after a failed attempt or a lost scan: the problem resolved itself.
        sr.exception.status = 'resolved';
        sr.exception.resolution = { decision: 'DELIVERED', note: 'Shiprocket confirmed delivery', at: now, outcome: 'delivered' };
        exceptionClosed = true;
      }
      if (exceptionOpened) order.timeline.push({ status: order.status, timestamp: now, note: `Shipment problem flagged for admin review: ${sr.exception.type.replace(/_/g, ' ').toLowerCase()} (${status || mapped.key})` });
    }

    order.$where = { __v: order.__v };
    order.increment();
    try {
      await order.save();
    } catch (error) {
      if (['DocumentNotFoundError', 'VersionError'].includes(error.name)) continue; // another scan won; re-read
      throw error;
    }
    await logCourierEvent({ ...base, orderId: order._id, outcome, detail: [statusChanged && `order → ${statusChanged}`, exceptionOpened && `exception ${sr.exception.type}`, exceptionClosed && 'exception closed by delivery'].filter(Boolean).join('; ') || undefined });

    if (statusChanged) {
      import('../socket/rooms.js').then(({ emitToUser }) => emitToUser(order.userId, 'order_status_updated', { orderId: order._id, status: order.status, timeline: order.timeline })).catch(() => {});
      notifyUser(order.userId, {
        event: NOTIFICATION_EVENT.ORDER_STATUS_UPDATED, title: 'Order update',
        message: `Order ${order.orderNo} is now ${order.status.replace(/_/g, ' ')}.`,
        metadata: { orderId: order._id }, route: '/orders',
      }).catch(() => {});
    }
    if (exceptionOpened) {
      notifyAllAdmins({
        event: NOTIFICATION_EVENT.SYSTEM, title: 'Shipment needs review',
        message: `Order ${order.orderNo}: Shiprocket reports ${sr.exception.type.replace(/_/g, ' ').toLowerCase()} (${status || mapped.key}). Decide refund, stock and customer message in Shipment Exceptions.`,
        metadata: { orderId: String(order._id) }, route: '/admin/shipment-exceptions',
      }).catch(() => {});
    }
    return { matched: true, applied: outcome === 'applied', outcome, orderId: order._id, statusChanged, exceptionOpened };
  }
  await logCourierEvent({ ...base, outcome: 'error', detail: 'concurrent updates did not settle' });
  throw httpError(409, 'Tracking update conflicted with concurrent changes; it will be retried');
}

/**
 * Scheduled reconciliation for shipments whose webhooks were missed: poll Shiprocket for Shiprocket-booked
 * orders still on their way that have not been checked recently, and apply the latest status through the same
 * path as a webhook. A repeated poll of an unchanged status is a duplicate and does nothing.
 */
export async function reconcileForwardTracking({ limit = 10, staleMs = 2 * 60 * 60 * 1000, provider, environment } = {}) {
  const now = new Date();
  const orders = await Order.find({
    deliveryType: 'shiprocket', 'shiprocket.orderId': { $nin: [null, ''] }, 'shiprocket.shipmentId': { $nin: [null, ''] },
    ...(environment ? { 'shiprocket.environment': environment } : {}),
    'shiprocket.status': { $nin: SETUP_LOCK_STATES },
    status: { $in: ACTIVE_ORDER_STATES },
    createdAt: { $gte: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000) },
    $or: [{ 'shiprocket.trackingCheckedAt': { $exists: false } }, { 'shiprocket.trackingCheckedAt': null }, { 'shiprocket.trackingCheckedAt': { $lte: new Date(now.getTime() - staleMs) } }],
  }).sort({ 'shiprocket.trackingCheckedAt': 1 }).limit(limit).select('_id shiprocket.shipmentId shiprocket.awb shiprocket.environment');
  const summary = { checked: 0, applied: 0, failed: 0 };
  for (const order of orders) {
    summary.checked += 1;
    await Order.updateOne({ _id: order._id }, { $set: { 'shiprocket.trackingCheckedAt': now } });
    try {
      const data = await provider.trackForwardShipment(order.shiprocket.shipmentId);
      const tracking = data?.tracking_data;
      const track = (tracking?.shipment_track || []).find((row) => String(row.shipment_id) === String(order.shiprocket.shipmentId)) || tracking?.shipment_track?.[0];
      const statusId = tracking?.shipment_status ?? track?.current_status_id;
      if (!track && !statusId) continue;
      const result = await applyForwardTracking({
        awb: track?.awb_code || order.shiprocket.awb, shipmentId: order.shiprocket.shipmentId, statusId, status: track?.current_status,
        eventId: `RECON:${order.shiprocket.shipmentId}:${resolveStatusId(statusId, track?.current_status) || clean(track?.current_status)}`,
        environment: order.shiprocket.environment || environment, source: 'reconciliation',
        payload: { shipment_status: String(statusId ?? ''), current_status: clean(track?.current_status).slice(0, 200) },
      });
      if (result.applied) summary.applied += 1;
    } catch (err) {
      summary.failed += 1;
      console.warn(`[COURIER TRACKING] reconciliation for shipment ${order.shiprocket.shipmentId} failed: ${err.message}`);
    }
  }
  return summary;
}

const DECISIONS = ['CANCEL_AND_REFUND', 'CLOSE_WITHOUT_REFUND'];
const SETTLEMENTS = ['NO_EARNING', 'FINANCE_REVIEW'];

/**
 * An admin's decision on a shipment exception. The exception is claimed first (open → resolving, with a token)
 * so a double submit runs once. CANCEL_AND_REFUND reuses the order cancellation path, so refunds follow the
 * existing rules (online refund obligation, wallet credit, grouped payments, exchange → refund) and the order can
 * only be cancelled once; restocking is the admin's choice and only for parcels physically back with the seller.
 * Seller earnings are never touched here: undelivered orders have no posted earnings, and the settlement choice
 * is recorded for the finance team.
 */
export async function resolveShipmentException({ orderId, adminId, decision, restock = false, sellerSettlement = 'NO_EARNING', customerMessage = '', note }) {
  if (!DECISIONS.includes(decision)) throw httpError(400, 'Choose to cancel and refund, or close without a refund');
  if (!SETTLEMENTS.includes(sellerSettlement)) throw httpError(400, 'Invalid seller settlement choice');
  const reason = typeof note === 'string' ? note.trim() : '';
  if (reason.length < 5 || reason.length > 500) throw httpError(400, 'Add a note of 5–500 characters explaining the decision');
  const message = typeof customerMessage === 'string' ? customerMessage.trim() : '';
  if (message.length > 500) throw httpError(400, 'The customer message must be 500 characters or fewer');
  if (typeof restock !== 'boolean') throw httpError(400, 'Restock must be yes or no');

  const order = await Order.findById(orderId).select('orderNo userId status shiprocket.exception');
  if (!order?.shiprocket?.exception?.status) throw httpError(404, 'No shipment exception on this order');
  const type = order.shiprocket.exception.type;
  if (decision === 'CANCEL_AND_REFUND' && !FINAL_EXCEPTIONS.includes(type)) {
    throw httpError(409, 'The parcel is still with the courier. Wait for it to be returned, lost or delivered before cancelling and refunding.');
  }
  if (restock && (decision !== 'CANCEL_AND_REFUND' || !RESTOCKABLE_EXCEPTIONS.includes(type))) {
    throw httpError(409, 'Stock can be restored only when the cancelled parcel is back with the seller (RTO delivered or cancelled before pickup).');
  }

  const token = crypto.randomUUID();
  const now = new Date();
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, 'shiprocket.exception.status': 'open' },
    { $set: { 'shiprocket.exception.status': 'resolving', 'shiprocket.exception.resolution': { decision, restock, sellerSettlement, customerMessage: message || undefined, note: reason, by: adminId, at: now, token } } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw httpError(409, 'This shipment exception is already resolved or being resolved. Refresh it.');

  let outcome = 'closed';
  if (decision === 'CANCEL_AND_REFUND') {
    const { cancelOrderAndRestore } = await import('../controllers/order.controller.js');
    const result = await cancelOrderAndRestore(orderId, {
      reason: `Shipment ${type.replace(/_/g, ' ').toLowerCase()}: ${reason}`, cancelledBy: 'admin',
      courierException: { token, restock }, suppressNotification: Boolean(message),
    });
    if (!result.ok) {
      await Order.updateOne({ _id: orderId, 'shiprocket.exception.resolution.token': token }, { $set: { 'shiprocket.exception.status': 'open' }, $unset: { 'shiprocket.exception.resolution': 1 } });
      throw httpError(409, result.reason || 'The order could not be cancelled');
    }
    outcome = restock ? 'cancelled_refunded_restocked' : 'cancelled_refunded';
  }
  await Order.updateOne({ _id: orderId, 'shiprocket.exception.resolution.token': token }, {
    $set: { 'shiprocket.exception.status': 'resolved', 'shiprocket.exception.resolution.outcome': outcome, 'shiprocket.exception.updatedAt': new Date() },
    $push: { timeline: { status: decision === 'CANCEL_AND_REFUND' ? ORDER_STATUS.CANCELLED : order.status, timestamp: new Date(), note: `Admin resolved shipment ${type.replace(/_/g, ' ').toLowerCase()}: ${decision === 'CANCEL_AND_REFUND' ? `cancelled and refunded${restock ? ', stock restored' : ', stock not restored'}` : 'closed without a refund'}. ${reason}` } },
  });
  await logCourierEvent({ kind: 'admin_action', direction: 'forward', orderId, adminId, outcome: `${decision}${restock ? '+RESTOCK' : ''}`, detail: `${type}; seller settlement ${sellerSettlement}; ${reason}`.slice(0, 1000) });
  if (message) {
    notifyUser(order.userId, {
      event: NOTIFICATION_EVENT.ORDER_STATUS_UPDATED, title: `Update on order ${order.orderNo}`, message,
      metadata: { orderId: order._id }, route: '/orders',
    }).catch(() => {});
  }
  return Order.findById(orderId).select('orderNo status shiprocket timeline pricing paymentMethod');
}

/** Admin list of shipment exceptions (open first). */
export async function listShipmentExceptions({ status = 'open', page = 1, limit = 20 } = {}) {
  const filter = status === 'all' ? { 'shiprocket.exception.status': { $exists: true } }
    : status === 'resolved' ? { 'shiprocket.exception.status': 'resolved' }
      : { 'shiprocket.exception.status': { $in: ['open', 'resolving'] } };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ 'shiprocket.exception.updatedAt': -1 }).skip((page - 1) * limit).limit(limit)
      .select('orderNo status userId paymentMethod pricing.totalAmount items.name items.qty items.sellerId exchange shiprocket.awb shiprocket.courier shiprocket.trackingStatus shiprocket.exception createdAt')
      .populate('userId', 'name').lean(),
    Order.countDocuments(filter),
  ]);
  return { rows, total, page, limit };
}
