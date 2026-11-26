import mongoose from 'mongoose';
import Order from '../models/Order.js';
import { ORDER_STATUS } from '../constants/enums.js';
import { httpError } from '../utils/response.js';
import { orderPaymentReady } from './orderPaymentEligibility.service.js';
import { warehouseStockOp } from './warehouse.service.js';
import { chargeOrderService } from './fbbCharges.service.js';
import { notifyUser, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * FBB order fulfilment at the Bulkimart warehouse (admin / warehouse staff only):
 *
 *   placed ──accept──▶ confirmed ──pick──▶ preparing ──pack──▶ (ready) ──provider──▶ dispatched ──▶ delivered
 *
 * Provider choice reuses the seller fulfilment handlers unchanged (Shiprocket booking with its operation
 * lock, or the Bulkimart rider offer/OTP flow), with the warehouse as the pickup origin
 * (fulfilmentOrigin.service.js). Packaging is charged when packed; the fulfilment charge and the stock's
 * exit from the warehouse are recorded once, at hand-off (rider pickup, courier pickup scan, or an admin
 * confirming the courier hand-off). The seller keeps ownership, earnings and invoices, and views only.
 */

const withTxn = async (work) => {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; }
  finally { await session.endSession(); }
};

const loadFbb = async (orderId, session = null) => {
  if (!mongoose.isValidObjectId(orderId)) throw httpError(400, 'Invalid order');
  const query = Order.findById(orderId);
  if (session) query.session(session);
  const order = await query;
  if (!order) throw httpError(404, 'Order not found');
  if (order.deliveryMethod !== 'fbb' || order.fulfillmentOwner !== 'bulkimart') throw httpError(409, 'This is not a Fulfilled by Bulkimart order');
  return order;
};

const tell = (order, message) => {
  import('../socket/rooms.js').then(({ emitToUser }) => emitToUser(order.userId, 'order_status_updated', { orderId: order._id, status: order.status, timeline: order.timeline })).catch(() => {});
  notifyUser(order.userId, { event: NOTIFICATION_EVENT.ORDER_STATUS_UPDATED, title: 'Order update', message, metadata: { orderId: order._id }, route: '/orders' }).catch(() => {});
};

const step = async ({ orderId, from, to, fbbFrom, fbbTo, extraSet = {}, note, adminId, charge }) => withTxn(async (session) => {
  const order = await loadFbb(orderId, session);
  if (order.status === to && (order.fbb?.status === fbbTo || !fbbTo)) return { order, alreadyDone: true };
  if (order.status !== from || (fbbFrom && !fbbFrom.includes(order.fbb?.status))) throw httpError(409, `This order is ${order.status}${order.fbb?.status ? ` (${order.fbb.status})` : ''}; refresh it`);
  const now = new Date();
  const updated = await Order.findOneAndUpdate({ _id: order._id, __v: order.__v, status: from },
    { $set: { status: to, 'fbb.status': fbbTo, ...extraSet(now) }, $push: { timeline: { status: to, timestamp: now, note } }, $inc: { __v: 1 } },
    { session, returnDocument: 'after', runValidators: true });
  if (!updated) throw httpError(409, 'The order changed. Refresh and try again.');
  if (charge) await chargeOrderService(updated, charge, session);
  return { order: updated, alreadyDone: false, adminId };
});

/** Accept a paid (or COD) FBB order. Payment must be verified, as for a seller accepting. */
export const acceptFbbOrder = async ({ orderId, adminId }) => {
  const order = await loadFbb(orderId);
  if (order.status === ORDER_STATUS.PLACED && !await orderPaymentReady(order)) throw httpError(409, 'Payment is not verified yet');
  const result = await step({ orderId, from: ORDER_STATUS.PLACED, to: ORDER_STATUS.CONFIRMED, fbbFrom: ['awaiting_acceptance', undefined], fbbTo: 'accepted', adminId,
    note: 'Accepted by the Bulkimart warehouse',
    extraSet: (now) => ({ 'fbb.acceptedAt': now, 'fbb.acceptedBy': adminId, vendorDecision: { status: 'accepted', sellerId: order.items[0]?.sellerId, decidedAt: now } }) });
  if (!result.alreadyDone) tell(result.order, `Order ${result.order.orderNo} was accepted and is being prepared at the Bulkimart warehouse.`);
  return result.order;
};

export const startFbbPicking = async ({ orderId, adminId }) => (await step({ orderId, from: ORDER_STATUS.CONFIRMED, to: ORDER_STATUS.PREPARING, fbbFrom: ['accepted'], fbbTo: 'picking', adminId,
  note: 'Warehouse is picking the items', extraSet: (now) => ({ 'fbb.pickingAt': now }) })).order;

/** Packed and ready for a provider: packaging is charged now (rate frozen at placement), once. */
export const markFbbPacked = async ({ orderId, adminId }) => withTxn(async (session) => {
  const order = await loadFbb(orderId, session);
  if (order.fbb?.status === 'packed' || order.fbb?.packedAt) return order;
  if (order.status !== ORDER_STATUS.PREPARING || order.fbb?.status !== 'picking') throw httpError(409, 'Pick the items before packing');
  const now = new Date();
  const updated = await Order.findOneAndUpdate({ _id: order._id, __v: order.__v, status: ORDER_STATUS.PREPARING, 'fbb.status': 'picking' }, {
    $set: { 'fbb.status': 'packed', 'fbb.packedAt': now, 'fbb.packedBy': adminId, 'fulfillment.readyAt': now },
    $push: { timeline: { status: ORDER_STATUS.PREPARING, timestamp: now, note: 'Packed at the Bulkimart warehouse; ready for the delivery partner' } }, $inc: { __v: 1 },
  }, { session, returnDocument: 'after' });
  if (!updated) throw httpError(409, 'The order changed. Refresh and try again.');
  await chargeOrderService(updated, 'packaging', session);
  return updated;
});

/**
 * The parcel left the warehouse with its provider — recorded once, whichever signal comes first.
 * Reserved stock leaves the warehouse and the fulfilment charge is booked (rate frozen at placement).
 */
export const recordFbbHandoff = async (orderId, source) => withTxn(async (session) => {
  const order = await loadFbb(orderId, session);
  if (order.fbb?.handedOverAt) return { order, alreadyRecorded: true };
  if (![ORDER_STATUS.DISPATCHED, ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED].includes(order.status)) throw httpError(409, 'The parcel has not been handed to a delivery partner yet');
  const now = new Date();
  const claimed = await Order.findOneAndUpdate({ _id: order._id, 'fbb.handedOverAt': null }, {
    $set: { 'fbb.handedOverAt': now, 'fbb.status': 'handed_over', 'fbb.handoffSource': source },
    $push: { timeline: { status: order.status, timestamp: now, note: 'Left the Bulkimart warehouse with the delivery partner' } },
  }, { session, returnDocument: 'after' });
  if (!claimed) return { order, alreadyRecorded: true };
  for (const item of claimed.items) {
    await warehouseStockOp({ op: 'dispatch', productId: item.productId, variantId: item.variantId, qty: item.qty, warehouseId: claimed.origin?.warehouseId, session,
      actorType: 'system', reference: { referenceType: 'order', referenceId: claimed._id }, note: `${claimed.orderNo} handed over (${source})` });
  }
  await chargeOrderService(claimed, 'fulfillment', session);
  return { order: claimed, alreadyRecorded: false };
});

/** Admin confirms the courier collected a Shiprocket-booked FBB parcel (the seller's "courier hand-off"). */
export const confirmFbbCourierHandoff = async ({ orderId, adminId }) => {
  const order = await loadFbb(orderId);
  if (order.status === ORDER_STATUS.PREPARING) {
    if (order.deliveryType !== 'shiprocket' || !order.shiprocket?.awb || !order.shiprocket?.courier) throw httpError(409, 'Book the Shiprocket shipment before confirming the hand-off');
    const now = new Date();
    const updated = await Order.findOneAndUpdate({ _id: order._id, __v: order.__v, status: ORDER_STATUS.PREPARING, 'shiprocket.status': { $nin: ['creating', 'assigning', 'reconciliation_required'] } }, {
      $set: { status: ORDER_STATUS.DISPATCHED }, $push: { timeline: { status: ORDER_STATUS.DISPATCHED, timestamp: now, note: `Handed to ${order.shiprocket.courier} · ${order.shiprocket.awb}` } }, $inc: { __v: 1 },
    }, { returnDocument: 'after' });
    if (!updated) throw httpError(409, 'The order changed. Refresh and try again.');
    tell(updated, `Order ${updated.orderNo} is on its way with ${order.shiprocket.courier} (${order.shiprocket.awb}).`);
  }
  return (await recordFbbHandoff(orderId, `admin:${adminId}`)).order;
};

/** Cancel before the parcel leaves (customer, seller-side reasons, stock issue). Packaging already charged is kept. */
export const cancelFbbOrder = async ({ orderId, adminId, reason }) => {
  const text = String(reason || '').trim();
  if (text.length < 5) throw httpError(400, 'Give a reason (at least 5 characters); the customer is shown it');
  const order = await loadFbb(orderId);
  if (order.fbb?.handedOverAt) throw httpError(409, 'The parcel already left the warehouse; handle it as a return or shipment exception');
  const { cancelOrderAndRestore } = await import('../controllers/order.controller.js');
  const result = await cancelOrderAndRestore(order._id, { reason: `Cancelled by Bulkimart: ${text}`, allowedFrom: [ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING], cancelledBy: 'admin' });
  if (!result.ok) throw httpError(409, result.reason || 'The order could not be cancelled');
  return Order.findById(order._id);
};

const wholeQty = (value, label) => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) throw httpError(400, `${label} must be a whole number of 0 or more`);
  return n;
};

/**
 * Inspect an RTO parcel back at the warehouse, once: each quarantined line is split into sellable (back on sale)
 * and damaged units, which must add up to the line's quantity. The order claim (pending → done) and every stock
 * move run in one transaction, so a double submit or a concurrent inspection cannot move the same units twice.
 * Not gated by the warehouse switch: turning it off must not strand returned stock.
 * @param {{ orderId, adminId, lines: Array<{ productId, variantId, sellableQty, damagedQty }>, note?: string }} input
 */
export const inspectFbbReturnedOrder = async ({ orderId, adminId, lines, note }) => withTxn(async (session) => {
  const order = await loadFbb(orderId, session);
  const inspection = order.fbb?.returnInspection;
  if (!inspection) throw httpError(409, 'Nothing from this order is waiting for inspection');
  if (inspection.status !== 'pending') throw httpError(409, 'This return was already inspected');
  if (!Array.isArray(lines)) throw httpError(400, 'Give the inspection result for each item');
  const text = typeof note === 'string' ? note.trim().slice(0, 300) : '';
  const decided = inspection.lines.map((line) => {
    const input = lines.find((l) => String(l?.productId) === String(line.productId) && String(l?.variantId) === String(line.variantId));
    if (!input) throw httpError(400, 'Give the inspection result for every returned item');
    const sellableQty = wholeQty(input.sellableQty, 'Sellable quantity');
    const damagedQty = wholeQty(input.damagedQty, 'Damaged quantity');
    if (sellableQty + damagedQty !== line.qty) throw httpError(400, `Sellable + damaged must equal the ${line.qty} unit(s) returned`);
    return { productId: line.productId, variantId: line.variantId, sellerId: line.sellerId, qty: line.qty, sellableQty, damagedQty };
  });
  const now = new Date();
  const claimed = await Order.findOneAndUpdate({ _id: order._id, 'fbb.returnInspection.status': 'pending' }, {
    $set: { 'fbb.returnInspection.status': 'done', 'fbb.returnInspection.lines': decided, 'fbb.returnInspection.inspectedAt': now,
      'fbb.returnInspection.inspectedBy': adminId, ...(text ? { 'fbb.returnInspection.note': text } : {}) },
    $push: { timeline: { status: order.status, timestamp: now, note: `Returned parcel inspected at the warehouse: ${decided.reduce((s, l) => s + l.sellableQty, 0)} back on sale, ${decided.reduce((s, l) => s + l.damagedQty, 0)} damaged` } },
  }, { session, returnDocument: 'after' });
  if (!claimed) throw httpError(409, 'This return was already inspected');
  const reference = { referenceType: 'order', referenceId: order._id };
  for (const line of decided) {
    for (const [bucket, qty] of [['sellable', line.sellableQty], ['damaged', line.damagedQty]]) {
      if (!qty) continue;
      await warehouseStockOp({ op: 'inspect', bucket, productId: line.productId, variantId: line.variantId, qty, warehouseId: order.origin?.warehouseId,
        session, actorType: 'admin', actorId: adminId, reference, note: `${order.orderNo}: inspected as ${bucket}${text ? ` — ${text}` : ''}` });
    }
  }
  return claimed;
});

/** Warehouse work queue. */
export const listFbbOrders = async ({ stage = 'open', page = 1, limit = 30 } = {}) => {
  const stages = {
    open: { status: { $in: [ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING] } },
    inspection: { 'fbb.returnInspection.status': 'pending' },
    in_transit: { status: { $in: [ORDER_STATUS.DISPATCHED, ORDER_STATUS.OUT_FOR_DELIVERY] } },
    done: { status: { $in: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, 'returned', 'refunded'] } },
  };
  const filter = { deliveryMethod: 'fbb', ...(Object.hasOwn(stages, stage) ? stages[stage] : stages.open) };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit)
      .select('orderNo status paymentMethod pricing.totalAmount items.name items.qty items.variantName items.sellerId items.productId items.variantId shippingAddress.city shippingAddress.pincode fbb deliveryType shiprocket.awb shiprocket.status shiprocket.courier deliveryPartnerId needsManualAssignment origin createdAt')
      .populate('items.sellerId', 'businessName storeDetails.name').lean(),
    Order.countDocuments(filter),
  ]);
  return { rows, total, page, limit };
};

/** Alert admins when a hand-off could not be recorded automatically (they can confirm it by hand). */
export const reportHandoffFailure = (order, error) => notifyAllAdmins({ event: NOTIFICATION_EVENT.SYSTEM, title: 'FBB hand-off needs confirmation',
  message: `Order ${order.orderNo}: ${error.message}`, metadata: { orderId: String(order._id) }, route: '/admin/fbb/orders' }).catch(() => {});
