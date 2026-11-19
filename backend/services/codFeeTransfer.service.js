import Order from '../models/Order.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { CANCELLABLE_STATUSES, ORDER_STATUS, PAYMENT_METHOD } from '../constants/enums.js';
import { SETUP_LOCK_STATES } from './courierTracking.service.js';
import { moneyPaise } from '../utils/financeMoney.js';

/**
 * Keeps the checkout's COD handling fee when the order carrying it is cancelled.
 *
 * The fee is charged ONCE per checkout and parked on the first physical order (codCharge.service.js
 * checkoutCodFees). If that order is cancelled while a sibling from the same checkout is still on its
 * way, the fee moves to that sibling: off the cancelled order's bill and frozen record, onto the
 * sibling's. The checkout total and the shared Payment stay exactly as they were, and the two orders'
 * frozen totals still add up to that payment.
 *
 * It is the only change the Order financial lock allows after checkout (models/Order.js, the
 * `codFeeTransfer` update option), and only while no money has moved on the receiving order:
 *   - still placed / confirmed / preparing (not dispatched)
 *   - no cash collected or reported, no courier shipment, no quick-commerce freight snapshot
 *   - nothing posted to the finance books
 * If no sibling qualifies, nothing changes and the fee is simply not collected (as before).
 * The amount moves unchanged; it is never recalculated and never added to seller earnings.
 *
 * Must run inside the cancellation's transaction (`session`), after the order is marked cancelled.
 * Returns { orderId, orderNo, amount } of the receiving order, or null when nothing moved.
 */
// Every COD fee field on the order's bill, read from the Order schema so a field added there moves too.
const CODFEE_FIELDS = Object.keys(Order.schema.paths).filter(path => path.startsWith('pricing.codFee')).map(path => path.slice('pricing.'.length));


const isLockedRecordConsistent = (snapshot) => snapshot?.version === 2 && snapshot.components
  && Number.isSafeInteger(snapshot.expectedPaise)
  && Object.values(snapshot.components).reduce((a, b) => a + b, 0) === snapshot.expectedPaise;

const noMoneyMoved = (order) => !order.financialPosting
  && !(order.codFinance?.status && order.codFinance.status !== 'expected') && !(order.codFinance?.collectedPaise > 0) && !order.codFinance?.events?.length
  && !order.shiprocket?.orderId && !SETUP_LOCK_STATES.includes(order.shiprocket?.status)
  && !order.fulfillment?.financialSnapshotId;

const rupees = paise => Math.round(paise) / 100;

export async function moveCodFeeFromCancelledOrder(orderId, session) {
  const source = await Order.findById(orderId).session(session).lean();
  const feePaise = source?.financialSnapshot?.components?.codFeePaise || 0;
  if (!source || source.status !== ORDER_STATUS.CANCELLED || source.paymentMethod !== PAYMENT_METHOD.COD || !source.groupRef || !source.paymentId) return null;
  if (!(feePaise > 0) || moneyPaise(source.pricing?.codFeeTotal || 0) !== feePaise || !isLockedRecordConsistent(source.financialSnapshot)) return null;
  // Cash already taken on the cancelled order (a courier exception after dispatch) stays where it is.
  if (!noMoneyMoved(source)) return null;

  const siblings = await Order.find({
    _id: { $ne: source._id }, groupRef: source.groupRef, paymentId: source.paymentId, userId: source.userId,
    paymentMethod: PAYMENT_METHOD.COD, status: { $in: CANCELLABLE_STATUSES },
  }).sort({ createdAt: 1, _id: 1 }).session(session).lean();

  let target = null;
  for (const sibling of siblings) {
    if (sibling.pricing?.codFeeTotal || sibling.financialSnapshot?.components?.codFeePaise) continue; // never charge it twice
    if (!sibling.items?.some(item => item.fulfillmentType !== 'digital')) continue; // no cash collection on e-books
    if (sibling.exchange?.returnId || !isLockedRecordConsistent(sibling.financialSnapshot) || !noMoneyMoved(sibling)) continue;
    if (await SellerLedgerEntry.exists({ orderId: sibling._id }).session(session)) continue;
    target = sibling;
    break;
  }
  if (!target) return null;

  const at = new Date();
  const amount = rupees(feePaise);
  const fee = Object.fromEntries(CODFEE_FIELDS.filter(key => source.pricing[key] !== undefined).map(key => [key, source.pricing[key]]));
  const record = { amount, feePaise, fromOrderId: source._id, fromOrderNo: source.orderNo, toOrderId: target._id, toOrderNo: target.orderNo, reason: 'source_order_cancelled', at };
  const options = { session, codFeeTransfer: true, overwriteImmutable: true };

  // Receiving order: guarded on the exact state checked above, so a dispatch or cash event racing
  // this transaction makes it a no-op instead of a changed bill.
  const added = await Order.updateOne({
    _id: target._id, status: { $in: CANCELLABLE_STATUSES }, 'pricing.codFeeTotal': { $exists: false },
    'financialSnapshot.components.codFeePaise': { $exists: false }, 'financialSnapshot.expectedPaise': target.financialSnapshot.expectedPaise,
    financialPosting: { $exists: false }, 'codFinance.status': { $in: [null, 'expected'] },
    'codFinance.collectedPaise': { $not: { $gt: 0 } }, 'codFinance.events.0': { $exists: false },
    'shiprocket.orderId': { $exists: false }, 'shiprocket.status': { $nin: SETUP_LOCK_STATES }, 'fulfillment.financialSnapshotId': { $exists: false },
  }, {
    $set: {
      ...Object.fromEntries(Object.entries(fee).map(([key, value]) => [`pricing.${key}`, value])),
      'pricing.totalAmount': rupees(moneyPaise(target.pricing.totalAmount) + feePaise),
      'financialSnapshot.expectedPaise': target.financialSnapshot.expectedPaise + feePaise,
      'financialSnapshot.components.codFeePaise': feePaise,
    },
    $push: {
      codFeeTransfers: { ...record, direction: 'received' },
      timeline: { status: target.status, timestamp: at, note: `₹${amount} COD handling fee moved here from cancelled order ${source.orderNo}` },
    },
  }, options);
  if (added.modifiedCount !== 1) return null;

  const removed = await Order.updateOne({
    _id: source._id, status: ORDER_STATUS.CANCELLED, 'financialSnapshot.components.codFeePaise': feePaise, 'financialSnapshot.expectedPaise': source.financialSnapshot.expectedPaise,
  }, {
    $unset: Object.fromEntries([...CODFEE_FIELDS.map(key => `pricing.${key}`), 'financialSnapshot.components.codFeePaise'].map(path => [path, 1])),
    $set: {
      'pricing.totalAmount': rupees(moneyPaise(source.pricing.totalAmount) - feePaise),
      'financialSnapshot.expectedPaise': source.financialSnapshot.expectedPaise - feePaise,
    },
    $push: {
      codFeeTransfers: { ...record, direction: 'given' },
      timeline: { status: ORDER_STATUS.CANCELLED, timestamp: at, note: `₹${amount} COD handling fee moved to order ${target.orderNo}` },
    },
  }, options);
  // Both halves or neither: throwing aborts the surrounding cancellation transaction.
  if (removed.modifiedCount !== 1) throw new Error(`COD fee transfer from ${source.orderNo} could not be completed`);

  return { orderId: target._id, orderNo: target.orderNo, amount };
}
