import Notification from '../models/Notification.js';
import { notifyAllAdmins, notifySeller, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Bell + push alerts for the Bulkimart warehouse team (FBB). Each alert has a dedupe key, so a retry or the
 * order sweep never sends it twice. The route opens the matching section of Admin → FBB Warehouse & Orders.
 * Alerts are best effort: a failure is logged and never fails the seller's or customer's action.
 */
const route = (section) => `/admin/fbb?section=${section}`;
const logFailure = (what) => (error) => console.error(`[NOTIFICATION] FBB ${what} alert failed:`, error.message);

/** A seller listed a new FBB product, or moved an existing one to FBB: their stock is on its way to the warehouse. */
export const alertAdminsNewFbbProduct = (product, { sellerName, converted = false } = {}) => notifyAllAdmins({
  event: NOTIFICATION_EVENT.SYSTEM,
  dedupeKey: `fbb-product:${product._id}`,
  title: converted ? 'Product moved to FBB' : 'New FBB product',
  message: `${sellerName || product.sellerName || 'A seller'} ${converted ? 'moved' : 'listed'} "${product.name}" for Fulfilled by Bulkimart. When their stock arrives, count it under Receiving.`,
  metadata: { productId: product._id, sellerId: product.sellerId },
  route: route('products'),
}).catch(logFailure('product'));

/** An FBB order is placed (and paid, if online): the warehouse must accept, pick and pack it. */
export const alertAdminsNewFbbOrder = async (order) => {
  if (order?.fbb?.status !== 'awaiting_acceptance') return;
  const dedupeKey = `fbb-order:${order._id}`;
  // notifyAllAdmins stores one row per admin as `<key>:<adminId>`; skip the work once any exists (the sweep re-runs).
  if (await Notification.exists({ dedupeKey: { $regex: `^${dedupeKey}:` } })) return;
  await notifyAllAdmins({
    event: NOTIFICATION_EVENT.SYSTEM,
    dedupeKey,
    title: 'New FBB order to fulfil',
    message: `Order ${order.orderNo} must ship from the Bulkimart warehouse. Accept it, then pick and pack.`,
    metadata: { orderId: order._id },
    route: route('orders'),
  }).catch(logFailure('order'));
};

/* ------------------------------------------------------------------ seller side ---------------------------------- */
const sellerRoute = '/seller/fbb';
const units = (receipt, k) => (receipt.lines || []).reduce((sum, l) => sum + (Number(l[k]) || 0), 0);

/** The warehouse counted the seller's delivery (draft receipt): tell the seller it arrived and is being checked. */
export const alertSellerStockArrived = (receipt) => notifySeller(receipt.sellerId, {
  event: NOTIFICATION_EVENT.SYSTEM,
  dedupeKey: `fbb-receipt-arrived:${receipt._id}`,
  title: 'Your stock reached the warehouse',
  message: `Delivery ${receipt.receiptNo}: ${units(receipt, 'receivedQty')} units received and being checked. They go on sale once verified.`,
  route: sellerRoute,
}).catch(logFailure('seller arrival'));

/** The receipt is posted: accepted units are on sale. Mentions damaged / rejected / missing units, if any. */
export const alertSellerStockPosted = (receipt) => {
  const problems = [['damagedQty', 'damaged'], ['rejectedQty', 'rejected'], ['missingQty', 'missing']]
    .map(([k, label]) => [units(receipt, k), label]).filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return notifySeller(receipt.sellerId, {
    event: NOTIFICATION_EVENT.SYSTEM,
    dedupeKey: `fbb-receipt-posted:${receipt._id}`,
    title: 'Your FBB stock is on sale',
    message: `Delivery ${receipt.receiptNo}: ${units(receipt, 'acceptedQty')} units accepted and now on sale${problems.length ? ` (${problems.join(', ')})` : ''}.`,
    route: sellerRoute,
  }).catch(logFailure('seller posted'));
};
