import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import Seller from '../models/Seller.js';
import { orderPaymentReady } from './orderPaymentEligibility.service.js';
import { notifySeller, NOTIFICATION_EVENT } from './notification.service.js';
import { emitToSeller } from '../socket/rooms.js';

let indexReady;
export const ensureSellerNotificationIndex = () => indexReady ||= Notification.collection.createIndex(
  { dedupeKey: 1 }, { name: 'notification_dedupe_key_unique', unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
).catch(error => { indexReady = null; throw error; });

export async function publishEligibleSellerOrder(orderId) {
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'placed' || order.items.every(i => i.fulfillmentType === 'digital') || !await orderPaymentReady(order)) return;
  await ensureSellerNotificationIndex();
  const sellers = [...new Set(order.items.map(i => i.sellerId && String(i.sellerId)).filter(Boolean))];
  for (const sellerId of sellers) {
    const seller = await Seller.findOne({ _id: sellerId, status: 'approved' }).populate('userId', 'isActive roles');
    if (!seller?.userId?.isActive || !seller.userId.roles?.includes('seller')) continue;
    const dedupeKey = `seller-order-ready:${order._id}:${sellerId}`;
    if (await Notification.exists({ dedupeKey })) continue;
    const record = await notifySeller(sellerId, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      dedupeKey,
      title: 'New order received', message: `Order ${order.orderNo} is ready for your review.`,
      metadata: { orderId: order._id }, route: `/seller/orders/${order._id}`,
    });
    if (record) emitToSeller(sellerId, 'new_order', { orderId: order._id, orderNo: order.orderNo, channel: order.type, placedAt: order.createdAt });
  }
}

export async function publishPaymentSellerOrders(payment) {
  const orders = await Order.find(payment.groupRef ? { groupRef: payment.groupRef } : { _id: payment.orderId }).select('_id');
  for (const order of orders) await publishEligibleSellerOrder(order._id);
}

// Recover a process stopping after commit but before publishing. Paginated
// round-robin scans do not let already-notified older orders starve later ones.
let cursor, running = false;
export async function sweepEligibleSellerOrders() {
  if (running) return;
  running = true;
  try {
    const rows = await Order.find({ status: 'placed', ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).select('_id').limit(100);
    let failures = 0;
    for (const row of rows) {
      try { await publishEligibleSellerOrder(row._id); }
      catch { failures++; }
    }
    if (failures) console.warn('[NOTIFICATION] Some eligible order notifications will retry on the next scan.');
    cursor = rows.length === 100 ? rows.at(-1)._id : null;
  } finally { running = false; }
}
