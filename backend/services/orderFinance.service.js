import { verifyReturnCashEvidence, verifyRefundedFunding } from './refundFunding.service.js';
import { cumulativePaise, codCashDuePaise, codSettlementTargetPaise } from '../utils/financeMoney.js';
import CourierCodRemittance from '../models/CourierCodRemittance.js';
import CourierCharge from '../models/CourierCharge.js';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { notifyRider, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';
import Seller from '../models/Seller.js';
import Return from '../models/Return.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { financialTransaction, requireFinanceOperation } from './financeSafety.service.js';
import { moneyPaise, sameDayIncentiveOf } from './vendorCommission.service.js';
import { httpError } from '../utils/response.js';
import { returnHoldOpen } from './returnHold.service.js';
import { externalDeliveryHoldOpen } from './externalCourier.service.js';

const evidence = (input) => {
  const reference = String(input.reference || '').trim();
  const reason = String(input.reason || '').trim();
  if (reference.length < 4 || reference.length > 200 || reason.length < 5 || reason.length > 1000) throw httpError(400, 'Evidence reference and a reason of at least five characters are required');
  return { reference, reason };
};
const snapshotOf = order => {
  const snapshot = order.financialSnapshot;
  if (snapshot?.version !== 2) throw httpError(409, 'Order has no versioned financial snapshot; historical backfill is not permitted');
  return snapshot;
};
// Snapshots frozen before the platform-funded discount policy keep their
// original seller-funded arithmetic; nothing already frozen is reinterpreted.
const platformFunded = snapshot => snapshot.discountFunding === 'platform';
// What a refunded quantity takes back from each account. Under platform-funded
// discounts the seller returns exactly the net they were credited for those
// units; older snapshots keep the original eligible-minus-commission rule.
export const refundCompensation = (snapshot, line, proportional) => {
  const commissionPaise = proportional(line.commissionPaise), taxPaise = proportional(line.taxPaise);
  if (!platformFunded(snapshot)) return { sellerPaise: proportional(line.eligiblePaise) - commissionPaise - taxPaise, commissionPaise, taxPaise, tcsPaise: 0, tdsPaise: 0, platformDiscountPaise: 0 };
  return { sellerPaise: proportional(line.netPaise), commissionPaise, taxPaise, tcsPaise: proportional(line.tcsPaise || 0),
    tdsPaise: proportional(line.tdsPaise || 0), platformDiscountPaise: proportional(line.platformDiscountPaise || 0) };
};
/**
 * The customer delivery charge split into platform delivery income and the
 * Same-Day seller incentive. New snapshots freeze the split; older ones kept
 * the incentive inside deliveryPaise, and the order's own frozen delivery
 * record says how much of it belonged to the seller.
 */
export const deliverySplit = (order, snapshot) => {
  const components = snapshot.components;
  if (components.sellerIncentivePaise !== undefined) return { deliveryPaise: components.deliveryPaise, incentivePaise: components.sellerIncentivePaise };
  const incentivePaise = sameDayIncentiveOf(order, components.deliveryPaise);
  return { deliveryPaise: components.deliveryPaise - incentivePaise, incentivePaise };
};
const incentiveSeller = snapshot => {
  const sellers = [...new Set(snapshot.lines.map(line => String(line.sellerId)))];
  if (sellers.length !== 1) throw httpError(409, 'A Same-Day seller incentive requires exactly one seller on the order');
  return sellers[0];
};
// The incentive is paid for fulfilment and is never refunded with an item, so
// it leaves the hold with the order rather than with any one line.
const releaseSameDayIncentive = async (order, actorId, session, type = 'same_day_incentive', label = 'Same-day incentive') => {
  const entry = await SellerLedgerEntry.findOne({ orderId: order._id, account: 'seller_payable', type, bucket: 'held', direction: 'credit' }).session(session);
  if (!entry || await SellerLedgerEntry.exists({ idempotencyKey: `FINANCE:${entry._id}:RELEASE:eligible` }).session(session)) return false;
  await Seller.updateOne({ _id: entry.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
  for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({
    idempotencyKey: `FINANCE:${entry._id}:RELEASE:${bucket}`, sellerId: entry.sellerId, orderId: order._id, account: 'seller_payable',
    type: 'adjustment', direction, bucket, amount: entry.amount, description: `${label} released ${order.orderNo}`,
    postedBy: actorId, postedByRole: actorId ? 'admin' : 'system', metadata: { source: 'order-finance-v2', originalEntryId: String(entry._id), kind: type },
  }, { session });
  return true;
};
// Cash Bulkimart accepts as settled: what was verified plus any shortage the
// platform has written off under the approved "platform absorbs" policy.
/** COD handling fee from the frozen snapshot, split into platform income and its GST. */
export const codFeeSplit = (order, snapshot) => {
  const totalPaise = snapshot?.components?.codFeePaise || 0;
  const taxPaise = Math.min(totalPaise, Math.round((order.pricing?.codFeeTaxAmount || 0) * 100));
  return { codFeeTotalPaise: totalPaise, codFeeNetPaise: totalPaise - taxPaise, codFeeTaxPaise: taxPaise };
};

export const codSettledPaise = cash => (cash?.verifiedPaise || 0) + (cash?.writtenOffPaise || 0);
// Settled means the rounded cash due was received (or its shortage written off).
const codCashSettled = (cash, expectedPaise) => ['verified', 'allocated'].includes(cash?.status) && codSettledPaise(cash) === codSettlementTargetPaise(cash, expectedPaise);
const lockOrder = async (id, session, review) => {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid order reference');
  const order = await Order.findOneAndUpdate({ _id: id }, { $inc: { financialRevision: 1 } }, { session, returnDocument: 'after' });
  if (!order) throw httpError(404, 'Order not found');
  snapshotOf(order);
  if (review) {
    const proof = evidence(review);
    const priorRevision = (order.financialRevision || 1) - 1;
    if (!Number.isSafeInteger(review.expectedRevision) || review.expectedRevision !== priorRevision) throw httpError(409, 'Financial record changed; refresh the preview');
    const prior = order.financialOperationLog?.find(row => row.reference === proof.reference);
    if (prior && (prior.reason !== proof.reason || prior.action !== review.action || String(prior.actorId) !== String(review.actorId))) throw httpError(409, 'Operation reference reused with conflicting review');
    if (!prior) await Order.updateOne({ _id: order._id }, { $push: { financialOperationLog: { ...proof, actorId: review.actorId, action: review.action, at: new Date(), revision: priorRevision } } }, { session });
  }
  return order;
};
const cashLedger = async (order, direction, suffix, actor, session, amountPaise = order.financialSnapshot.expectedPaise, account = 'cod_custody', reference) => postLedgerEntry({
  idempotencyKey: `COD:${order._id}:${suffix}`, orderId: order._id, partnerId: order.deliveryPartnerId,
  paymentId: order.paymentId,
  deliveryId: order.deliveryId, account, type: 'cod_cash', direction, bucket: 'held',
  amount: amountPaise / 100, description: `COD ${suffix.startsWith('COLLECTED') ? 'collection reported' : 'cash receipt reconciliation'} ${order.orderNo}`, reference,
  postedBy: actor, postedByRole: suffix === 'COLLECTED' ? 'system' : 'admin',
  metadata: { source: 'order-finance-v2', snapshotId: order.financialSnapshot.snapshotId },
}, { session });

// A shared checkout Payment becomes paid only after every sibling's cash is
// settled. Write Payment first to serialize concurrent siblings.
const markCodPaymentIfSettled = async (order, expectedPaise, session) => {
  const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
  if (!payment || payment.method !== 'cod') throw httpError(409, 'COD payment association is missing');
  payment.settlementRevision = (payment.settlementRevision || 0) + 1;
  await payment.save({ session });
  const siblings = await Order.find(payment.groupRef ? { groupRef: payment.groupRef, paymentId: payment._id } : { _id: payment.orderId, paymentId: payment._id }).session(session);
  if (!siblings.some(sibling => String(sibling._id) === String(order._id))) throw httpError(409, 'COD order is not associated with payment');
  const settled = sibling => ['verified', 'allocated'].includes(sibling.codFinance?.status);
  // A settled sibling paid its whole order total; the cash itself was the
  // rounded rupee amount, so the frozen total is what counts toward the payment.
  const paidPaise = siblings.reduce((sum, sibling) => sum + (String(sibling._id) === String(order._id) ? expectedPaise : settled(sibling) ? snapshotOf(sibling).expectedPaise : 0), 0);
  if (paidPaise === moneyPaise(payment.amount) && siblings.every(sibling => String(sibling._id) === String(order._id) || settled(sibling))) {
    // A return already refunded to the wallet while the cash was unconfirmed
    // keeps its refund state rather than being overwritten as fully paid.
    const refundedPaise = moneyPaise(payment.refund?.totalRefundedAmount || 0);
    payment.status = !refundedPaise ? 'paid' : refundedPaise === moneyPaise(payment.amount) ? 'refunded' : 'partial_refund';
    payment.paidAt = new Date(); await payment.save({ session });
  }
};

export const recordCodEvent = async ({ orderId, partnerId, actorId, action, input }) => {
  requireFinanceOperation();
  if (!['collect', 'remit', 'verify', 'dispute', 'writeoff'].includes(action)) throw httpError(400, 'Unknown COD action');
  const proof = evidence(input);
  // A dispute concerns the whole order and a write-off its recorded shortage,
  // so neither needs an amount typed by the admin.
  const amountGiven = !(input.amount == null || input.amount === '');
  if (!amountGiven && !['dispute', 'writeoff'].includes(action)) throw httpError(400, 'Amount is required');
  const typedPaise = amountGiven ? moneyPaise(input.amount) : null;
  const admin = ['verify', 'dispute', 'writeoff'].includes(action);
  let notice = null;
  const result = await financialTransaction(async session => {
    const order = await lockOrder(orderId, session, admin && input.expectedRevision != null ? { ...input, actorId, action: `cod:${action}` } : undefined);
    if (order.paymentMethod !== 'cod') throw httpError(409, 'Order is not COD');
    if (!admin && String(order.deliveryPartnerId) !== String(partnerId)) throw httpError(404, 'COD assignment not found');
    const delivery = await Delivery.findOne({ _id: order.deliveryId, orderId: order._id, partnerId: order.deliveryPartnerId }).session(session);
    if (!delivery || delivery.direction === 'return_pickup' || delivery.status !== 'delivered' || !delivery.otpVerified || action === 'collect' && order.status !== 'delivered') throw httpError(409, 'Verified completed delivery is required');
    const expectedPaise = snapshotOf(order).expectedPaise;
    // Cash changes hands in whole rupees, so collection limits, verification
    // and shortage/excess are all measured against the rounded amount.
    const duePaise = codCashDuePaise(expectedPaise);
    const cash = order.codFinance || { expectedPaise, status: 'expected', events: [] };
    const amountPaise = typedPaise ?? (action === 'writeoff' ? cash.shortagePaise || 0 : expectedPaise);
    // Replays must agree with the original immutable evidence.
    const previous = cash.events.find(row => row.action === action && row.reference === proof.reference);
    if (previous) {
      if (previous.amountPaise !== amountPaise || String(previous.actorId) !== String(actorId) || previous.reason !== proof.reason) throw httpError(409, 'COD reference reused with different evidence');
      return cash;
    }
    if (expectedPaise === 0) throw httpError(409, 'Zero-payable COD requires a separately approved reconciliation policy');
    if (action === 'dispute') {
      if (cash.status === 'expected' || amountPaise !== expectedPaise) throw httpError(409, 'A dispute requires an existing cash report and the expected order amount');
      for (const sellerId of new Set(order.financialSnapshot.lines.map(line => line.sellerId))) await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      await DeliveryPartner.updateOne({ _id: order.deliveryPartnerId }, { $inc: { __v: 1 } }, { session });
      cash.status = 'disputed';
    } else if (action === 'writeoff') {
      // Approved policy: Bulkimart absorbs a verified COD shortage so seller
      // and rider settlement can continue. Excess cash is never written off.
      if (cash.status !== 'discrepancy' || !(cash.shortagePaise > 0) || cash.excessPaise > 0 || cash.writtenOffPaise) throw httpError(409, 'Only a verified cash shortage can be written off');
      if (amountPaise !== cash.shortagePaise) throw httpError(409, 'Write-off must equal the verified shortage');
      const custodyLeft = Math.max(0, (cash.collectedPaise || 0) - Math.min(duePaise, cash.verifiedPaise || 0));
      const custodyPaise = Math.min(amountPaise, custodyLeft);
      if (custodyPaise) await cashLedger(order, 'debit', 'SHORTAGE_WRITEOFF', actorId, session, custodyPaise, 'cod_custody', proof.reference);
      await postLedgerEntry({ idempotencyKey: `COD:${order._id}:SHORTAGE_EXPENSE`, orderId: order._id, partnerId: order.deliveryPartnerId, paymentId: order.paymentId,
        deliveryId: order.deliveryId, account: 'cod_shortage_expense', type: 'cod_shortage_writeoff', direction: 'credit', bucket: 'held', amount: amountPaise / 100,
        description: `COD shortage absorbed by Bulkimart ${order.orderNo}`, reference: proof.reference, postedBy: actorId, postedByRole: 'admin',
        metadata: { source: 'order-finance-v2', snapshotId: order.financialSnapshot.snapshotId, reason: proof.reason } }, { session });
      for (const sellerId of new Set(order.financialSnapshot.lines.map(line => line.sellerId))) await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      await DeliveryPartner.updateOne({ _id: order.deliveryPartnerId }, { $inc: { __v: 1 } }, { session });
      cash.writtenOffPaise = amountPaise; cash.writtenOffCustodyPaise = custodyPaise;
      cash.status = order.financialPosting ? 'allocated' : 'verified';
      await markCodPaymentIfSettled(order, expectedPaise, session);
    } else if (action === 'collect') {
      if (input.method !== 'cash') throw httpError(400, 'Only cash collection is approved by this workflow');
      if (cash.status !== 'expected') throw httpError(409, 'Collection already recorded');
      // The rider records the collected cash; allows exact or nearest rounded cash amount.
      const maxAllowedPaise = Math.max(expectedPaise, duePaise);
      if (amountPaise <= 0 || amountPaise > maxAllowedPaise) throw httpError(409, 'Collected amount must be more than zero and at most the order amount');
      cash.status = 'collected'; cash.collectedPaise = amountPaise; cash.collectedAt = new Date();
      await cashLedger(order, 'credit', 'COLLECTED', actorId, session, amountPaise);
    } else if (action === 'remit') {
      if (cash.status !== 'collected') throw httpError(409, 'Collection must precede remittance reporting');
      // A rider can hand over only the cash they reported collecting.
      if (amountPaise <= 0 || amountPaise > (cash.collectedPaise || 0)) throw httpError(409, `Handover amount must be more than zero and at most the ₹${((cash.collectedPaise || 0) / 100).toFixed(2)} you collected`);
      cash.status = 'remittance_reported'; cash.reportedPaise = amountPaise;
      // A rider report never establishes platform receipt.
    } else {
      if (!['remittance_reported', 'discrepancy', 'disputed'].includes(cash.status) || !cash.events.some(event => event.action === 'remit')) throw httpError(409, 'Reported handover is required before verification');
      if (String(actorId) === String(cash.events.find(row => row.action === 'remit')?.actorId)) throw httpError(403, 'The remittance reporter cannot verify their own cash');
      if (cash.writtenOffPaise) throw httpError(409, 'The shortage was already written off; record a dispute to investigate further');
      for (const sellerId of new Set(order.financialSnapshot.lines.map(line => line.sellerId))) await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      await DeliveryPartner.updateOne({ _id: order.deliveryPartnerId }, { $inc: { __v: 1 } }, { session });
      const previousVerified = cash.verifiedPaise || 0;
      const receiptKey = crypto.createHash('sha256').update(proof.reference).digest('hex');
      const custodyDelta = Math.min(duePaise, amountPaise) - Math.min(duePaise, previousVerified);
      if (custodyDelta) await cashLedger(order, custodyDelta > 0 ? 'debit' : 'credit', `RECEIPT:${receiptKey}`, actorId, session, Math.abs(custodyDelta), 'cod_custody', proof.reference);
      const excessDelta = Math.max(0, amountPaise - duePaise) - Math.max(0, previousVerified - duePaise);
      if (excessDelta) await cashLedger(order, excessDelta > 0 ? 'credit' : 'debit', `EXCESS:${receiptKey}`, actorId, session, Math.abs(excessDelta), 'cod_excess_liability', proof.reference);
      cash.verifiedPaise = amountPaise;
      cash.shortagePaise = Math.max(0, duePaise - amountPaise);
      cash.excessPaise = Math.max(0, amountPaise - duePaise);
      cash.status = amountPaise === duePaise ? 'verified' : 'discrepancy';
      if (cash.status === 'verified' && order.financialPosting) cash.status = 'allocated';
      // Receipt changes above are append-only deltas. Re-verifying the same
      // amount appends evidence without posting a second cash receipt.
      if (['verified','allocated'].includes(cash.status)) await markCodPaymentIfSettled(order, expectedPaise, session);
    }
    cash.events.push({ action, ...proof, amountPaise, actorId: String(actorId), at: new Date(), deliveryId: String(delivery._id), partnerId: String(delivery.partnerId), result: cash.status });
    // Latest cash activity, so the admin COD list can show new reports first.
    cash.updatedAt = new Date();
    await Order.updateOne({ _id: order._id }, { $set: { codFinance: cash } }, { session });
    notice = { orderId: order._id, orderNo: order.orderNo, partnerId: order.deliveryPartnerId, status: cash.status, amountPaise, expectedPaise };
    return cash;
  });
  if (notice) await notifyCodEvent(action, notice);
  return result;
};

const rupeeText = paise => `₹${(paise / 100).toFixed(2)}`;
// After commit: admins hear about a rider's handover; the rider hears how it was settled.
const notifyCodEvent = (action, { orderId, orderNo, partnerId, status, amountPaise, expectedPaise }) => {
  const metadata = { orderId, orderNo };
  if (action === 'remit') {
    return notifyAllAdmins({ event: NOTIFICATION_EVENT.COD_HANDOVER_REPORTED, title: 'Rider cash settlement request',
      message: `${orderNo}: rider reports handing over ${rupeeText(amountPaise)}. Confirm when the cash is received.`,
      metadata, route: '/admin/finance-center?area=orders&view=cod' }).catch(() => {});
  }
  const riderMessage = action === 'dispute' ? `Your cash report for ${orderNo} is under review. Bulkimart will contact you.`
    : status === 'discrepancy' ? `Bulkimart received ${rupeeText(amountPaise)} for ${orderNo}, but ${rupeeText(codCashDuePaise(expectedPaise))} was due. Bulkimart will contact you.`
    : ['verify', 'writeoff'].includes(action) && ['verified', 'allocated'].includes(status) ? `Your COD cash for ${orderNo} is settled. Bulkimart confirmed receipt.` : null;
  if (riderMessage && partnerId) return notifyRider(partnerId, { event: NOTIFICATION_EVENT.COD_CASH_SETTLED,
    title: status === 'discrepancy' || action === 'dispute' ? 'COD cash needs attention' : 'COD cash settled',
    message: riderMessage, metadata, route: '/delivery/earnings' }).catch(() => {});
};

const ensurePayment = async (order, session, allowCompensatedRefunds = false) => {
  if (snapshotOf(order).paymentMethod !== order.paymentMethod) throw httpError(409, 'Payment method differs from frozen financial snapshot');
  if (snapshotOf(order).paymentId !== String(order.paymentId)) throw httpError(409, 'Payment association differs from frozen financial snapshot');
  if (order.paymentMethod === 'cod') {
    if (!codCashSettled(order.codFinance, snapshotOf(order).expectedPaise)) throw httpError(409, 'COD cash is not verified');
    return;
  }
  const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
  if (!payment) throw httpError(409, 'Verified customer payment is required');
  if (payment.merchandiseSettlementHold) throw httpError(409, 'Payment dispute requires financial reconciliation');
  // One checkout payment can fund several fulfilment orders. When one of them is
  // cancelled, its own share is refunded under the obligation key
  // `CANCEL:<thatOrderId>`. That refund belongs to the cancelled order only, so
  // it must not freeze seller and rider money on the siblings that were
  // delivered. Any other refund still requires the full reconciliation below.
  const cancelledSiblings = new Set((await Order.find({ paymentId: payment._id, status: 'cancelled', _id: { $ne: order._id } }).select('_id').session(session)).map(row => String(row._id)));
  const siblingCancellation = row => typeof row.key === 'string' && row.key.startsWith('CANCEL:') && cancelledSiblings.has(row.key.slice('CANCEL:'.length))
    && (!row.orderId || cancelledSiblings.has(String(row.orderId)));
  const ownObligations = (payment.refundObligations || []).filter(row => !siblingCancellation(row));
  const siblingRefundedPaise = (payment.refundObligations || []).filter(row => siblingCancellation(row) && row.status === 'processed').reduce((sum, row) => sum + (row.amountPaise || 0), 0);
  // Partially refunded only because cancelled siblings got their own money back.
  const onlySiblingCancellationsRefunded = payment.status === 'partial_refund' && siblingRefundedPaise > 0
    && moneyPaise(payment.refund?.totalRefundedAmount || 0) === siblingRefundedPaise;
  const effectiveStatus = onlySiblingCancellationsRefunded ? 'paid' : payment.status;
  const cashReturns = allowCompensatedRefunds && await Return.exists({ orderId: { $in: (await Order.find({ paymentId: payment._id }).select('_id').session(session)).map(row => row._id) }, status: 'REFUNDED', refundAmount: { $gt: 0 } }).session(session);
  const captureRefunds = allowCompensatedRefunds && ownObligations.some(row => (row.status === 'processed' || !row.returnId) && payment.captures.some(capture => capture.disposition === 'settled' && capture.gatewayPaymentId === row.gatewayPaymentId));
  if (effectiveStatus !== 'paid' || cashReturns || captureRefunds) {
    if (!allowCompensatedRefunds) throw httpError(409, 'Verified customer payment is required');
    await verifyRefundedFunding(payment, order, session);
  }
  if (payment.method !== order.paymentMethod || String(payment.userId) !== String(order.userId) || !(payment.groupRef && payment.groupRef === order.groupRef || String(payment.orderId) === String(order._id))) throw httpError(409, 'Customer payment ownership mismatch');
  const siblings = await Order.find({ paymentId: payment._id }).select('_id userId paymentMethod groupRef financialSnapshot').session(session);
  const originalTotal = siblings.reduce((sum, row) => {
    const frozen = snapshotOf(row);
    if (String(row.userId) !== String(payment.userId) || row.paymentMethod !== payment.method || frozen.paymentId !== String(payment._id)
      || !Number.isSafeInteger(frozen.expectedPaise) || frozen.expectedPaise < 0 || (payment.groupRef ? row.groupRef !== payment.groupRef : String(row._id) !== String(payment.orderId))) throw httpError(409, 'Payment sibling allocation requires reconciliation');
    return sum + frozen.expectedPaise;
  }, 0);
  if (!Number.isSafeInteger(originalTotal) || originalTotal !== moneyPaise(payment.amount)) throw httpError(409, 'Frozen order totals do not reconcile with original payment funding');
  if (order.paymentMethod === 'online' && !payment.captures?.some(capture => capture.disposition === 'settled' && capture.gatewayPaymentId && capture.currency === 'INR' && capture.amountPaise === moneyPaise(payment.amount))) throw httpError(409, 'Authoritative captured payment evidence is required');
  if (order.paymentMethod === 'wallet') {
    const { default: WalletLedger } = await import('../models/WalletLedger.js');
    if (!await WalletLedger.exists({ userId: order.userId, direction: 'debit', referenceId: { $in: [String(order._id), String(payment._id), order.groupRef].filter(Boolean) }, amount: payment.amount, status: 'completed' }).session(session)) throw httpError(409, 'Wallet debit evidence is missing');
  }
};

export const postOrderFinance = async (orderId, actorId, review) => {
  requireFinanceOperation();
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, review && { ...review, actorId, action: 'postOrderFinance' });
    if (order.financialPosting) return { status: order.financialPosting, alreadyProcessed: true };
    if (order.status !== 'delivered') throw httpError(409, 'Only completed deliveries can accrue merchandise earnings');
    // A delivery only the seller reported (own courier) posts after the customer's confirmation hold, and never
    // while the customer has reported it as not received (externalCourier.service.js).
    if (externalDeliveryHoldOpen(order)) throw httpError(409, 'Seller-reported delivery is still in its confirmation hold', { code: 'EXTERNAL_DELIVERY_HOLD' });
    const snapshot = snapshotOf(order);
    if (snapshot.state === 'held_discount_policy') throw httpError(409, 'Discount funding policy is not approved; no seller deduction may be assumed');
    if (snapshot.state !== 'configured') throw httpError(409, 'Commission policy was missing at checkout; historical recalculation is prohibited');
    await ensurePayment(order, session);
    const legacy = await SellerLedgerEntry.exists({ orderId: order._id, type: { $in: ['order_earning', 'platform_commission'] } }).session(session);
    if (legacy) throw httpError(409, 'Existing merchandise postings require reconciliation before allocation');
    for (const line of snapshot.lines) {
      const common = { sellerId: line.sellerId, orderId: order._id, paymentId: order.paymentId, direction: 'credit', bucket: 'held', postedBy: actorId, postedByRole: actorId ? 'admin' : 'system',
        metadata: { source: 'order-finance-v2', itemId: line.itemId, ruleVersion: line.rule.version, snapshotId: snapshot.snapshotId,
          // Tax reports read the supply value from the entry itself.
          taxableValuePaise: line.taxableValuePaise ?? line.grossPaise, gstRatePercent: line.gstRatePercent ?? null } };
      for (const [suffix, account, type, amount] of [
        ['NET', 'seller_payable', 'order_earning', line.netPaise],
        ['COMMISSION', 'commission_revenue', 'platform_commission', line.commissionPaise],
        ['TAX', 'tax_liability', 'commission_tax', line.taxPaise],
        ['TCS', 'tcs_liability', 'tcs_deduction', line.tcsPaise || 0],
        ['TDS', 'tds_liability', 'tds_deduction', line.tdsPaise || 0],
        ['PLATFORM_DISCOUNT', 'platform_discount_expense', 'platform_discount', platformFunded(snapshot) ? line.platformDiscountPaise || 0 : 0],
        ['GROSS', 'merchandise_gross', 'merchandise_gross', line.grossPaise],
      ]) {
        if (amount > 0) await postLedgerEntry({ ...common, idempotencyKey: `FINANCE:${order._id}:${line.itemId}:${suffix}`, account, type, amount: amount / 100, description: `${type} for ${order.orderNo}` }, { session });
      }
    }
    const { deliveryPaise, incentivePaise } = deliverySplit(order, snapshot);
    /**
     * The customer's delivery charge: platform delivery income, except when the seller arranged and paid their
     * own courier and the order was promised the charge at hand-off (externalShipment.deliveryFeePayee). Both
     * routes use the SAME idempotency key, so one order's charge can only ever be booked once, to one payee —
     * a replay that names the other payee is refused by the ledger (account mismatch).
     */
    const sellerGetsDelivery = order.deliveryType === 'external' && order.fulfillment?.method === 'external_courier' && order.externalShipment?.deliveryFeePayee === 'seller';
    if (deliveryPaise > 0) await postLedgerEntry(sellerGetsDelivery
      ? { idempotencyKey: `FINANCE:${order._id}:CUSTOMER_DELIVERY`, sellerId: incentiveSeller(snapshot), orderId: order._id, paymentId: order.paymentId,
        account: 'seller_payable', type: 'self_delivery_fee', direction: 'credit', bucket: 'held', amount: deliveryPaise / 100,
        description: `Delivery charge for own-courier delivery ${order.orderNo}`, postedBy: actorId, postedByRole: actorId ? 'admin' : 'system',
        metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId, payee: 'seller', taxTreatment: 'pending_accountant_review' } }
      : { idempotencyKey: `FINANCE:${order._id}:CUSTOMER_DELIVERY`, orderId: order._id,
        account: 'customer_delivery', type: 'customer_delivery', direction: 'credit', bucket: 'held', amount: deliveryPaise / 100,
        description: `Customer delivery charge ${order.orderNo}`, metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
    // COD handling fee: platform income (net) + GST payable, never seller earnings.
    const { codFeeNetPaise, codFeeTaxPaise } = codFeeSplit(order, snapshot);
    if (codFeeNetPaise > 0) await postLedgerEntry({ idempotencyKey: `FINANCE:${order._id}:CUSTOMER_COD_FEE`, orderId: order._id,
      account: 'customer_cod_fee', type: 'customer_cod_fee', direction: 'credit', bucket: 'held', amount: codFeeNetPaise / 100,
      description: `COD handling fee ${order.orderNo}`, metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
    if (codFeeTaxPaise > 0) await postLedgerEntry({ idempotencyKey: `FINANCE:${order._id}:COD_FEE_TAX`, orderId: order._id,
      account: 'tax_liability', type: 'cod_fee_tax', direction: 'credit', bucket: 'held', amount: codFeeTaxPaise / 100,
      description: `GST on COD handling fee ${order.orderNo}`, metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
    if (incentivePaise > 0) await postLedgerEntry({ idempotencyKey: `FINANCE:${order._id}:SAME_DAY_INCENTIVE`, sellerId: incentiveSeller(snapshot), orderId: order._id,
      paymentId: order.paymentId, account: 'seller_payable', type: 'same_day_incentive', direction: 'credit', bucket: 'held', amount: incentivePaise / 100,
      description: `Same-day seller incentive ${order.orderNo}`, postedBy: actorId, postedByRole: actorId ? 'admin' : 'system',
      metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
    await Order.updateOne({ _id: order._id }, { $set: { financialPosting: 'held', ...(order.paymentMethod === 'cod' ? { 'codFinance.status': 'allocated' } : {}) } }, { session });
    return { status: 'held', alreadyProcessed: false };
  });
};

export const releaseOrderFinance = async (orderId, actorId, review) => {
  requireFinanceOperation();
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, review && { ...review, actorId, action: 'releaseOrderFinance' });
    if (order.financialPosting === 'eligible') return { status: 'eligible', alreadyProcessed: true };
    if (order.financialPosting === 'reversed') return { status: 'reversed', alreadyProcessed: true };
    if (order.financialPosting !== 'held' || order.status !== 'delivered') throw httpError(409, 'Held delivered earnings are required');
    await ensurePayment(order, session, true);
    const returns = await Return.find({ orderId: order._id, status: { $nin: ['REJECTED', 'CANCELLED'] } }).session(session);
    const entries = await SellerLedgerEntry.find({ orderId: order._id, account: 'seller_payable', type: 'order_earning', bucket: 'held' }).session(session);
    let heldLines = 0, releasedLines = 0;
    for (const entry of entries) {
      const item = order.items.find(row => String(row._id) === entry.metadata.itemId);
      // An EXCHANGED return is settled with no money moved (a replacement was sent): the seller keeps this sale.
      const blocked = returnHoldOpen(item) || returns.some(ret => String(ret.orderItemId) === entry.metadata.itemId && ret.status !== 'EXCHANGED' && (ret.status !== 'REFUNDED' || !order.financialReturnQuantities?.[`return_${ret._id}`]));
      if (blocked) { heldLines++; continue; }
      if (await SellerLedgerEntry.exists({ idempotencyKey: `FINANCE:${entry._id}:RELEASE:eligible` }).session(session)) continue;
      await Seller.updateOne({ _id: entry.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const reversals = await SellerLedgerEntry.find({ orderId: order._id, account: 'seller_payable', type: 'reversal', bucket: 'held', direction: 'debit', 'metadata.itemId': entry.metadata.itemId }).session(session);
      const amountPaise = moneyPaise(entry.amount) - reversals.reduce((sum, row) => sum + moneyPaise(row.amount), 0);
      if (amountPaise < 0) throw httpError(409, 'Refund reversals exceed original seller earnings');
      if (!amountPaise) continue;
      for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({
        idempotencyKey: `FINANCE:${entry._id}:RELEASE:${bucket}`, sellerId: entry.sellerId, orderId: order._id, account: 'seller_payable',
        type: 'adjustment', direction, bucket, amount: amountPaise / 100, description: `Return hold cleared ${order.orderNo}`,
        postedBy: actorId, postedByRole: actorId ? 'admin' : 'system', metadata: { source: 'order-finance-v2', originalEntryId: String(entry._id), itemId: entry.metadata.itemId },
      }, { session });
      releasedLines++;
    }
    if (heldLines && !releasedLines) throw httpError(409, 'Delivery evidence, return hold or financial reconciliation has not cleared');
    const status = heldLines ? 'held' : 'eligible';
    if (status === 'eligible') {
      await releaseSameDayIncentive(order, actorId, session);
      // Self Delivery (own courier): the delivery charge credited to the seller leaves the hold with the order.
      await releaseSameDayIncentive(order, actorId, session, 'self_delivery_fee', 'Self Delivery charge');
    }
    await Order.updateOne({ _id: order._id }, { $set: { financialPosting: status } }, { session });
    return { status, heldLines, releasedLines };
  });
};

// A rate card frozen at acceptance is usable when its base and per-km figures
// are real numbers. Cards from the built-in default rates have no database id;
// they are still exactly what the rider was offered, so they are valid to pay.
const frozenRatesUsable = rates => Boolean(rates) && ['base', 'perKm'].every(key => Number.isFinite(Number(rates[key])) && Number(rates[key]) >= 0);
const rateConfigurationIdOf = rates => (rates?.rateId ? String(rates.rateId) : `default:${rates?.mode || 'quick'}`);

export const recordDeliveryEarning = async ({ order, delivery, settlement, session }) => {
  // Called only within the existing OTP completion transaction. Legacy orders
  // keep their current behavior; v2 COD earns into held, never pending cash.
  if (!order.financialSnapshot) return false;
  const verified = ['total', 'tip', 'base', 'perKm', 'distanceKm'].every(key => Number.isFinite(settlement[key]) && settlement[key] >= 0)
    && Number.isFinite(delivery.route?.distanceKm) && delivery.route.distanceKm >= 0 && frozenRatesUsable(delivery.ratesUsed);
  if (!verified || settlement.total === 0) {
    const status = verified ? 'zero_value' : 'reconciliation_required';
    await Delivery.updateOne({ _id: delivery._id }, { $set: { financialEarningStatus: status }, ...(!verified ? { $unset: { partnerEarnings: 1, partnerTip: 1 } } : {}) }, { session });
    return { credited: false, status };
  }
  await postLedgerEntry({ idempotencyKey: `DELIVERY:${delivery._id}:EARNING`, orderId: order._id, partnerId: delivery.partnerId, deliveryId: delivery._id,
    account: 'rider_payable', type: 'delivery_earning', direction: 'credit', bucket: 'held', amount: settlement.total,
    description: `Completed delivery ${order.orderNo}`, metadata: { source: 'order-finance-v2', ...settlement, rateConfigurationId: rateConfigurationIdOf(delivery.ratesUsed), ratesUsed: delivery.ratesUsed, snapshotId: order.financialSnapshot.snapshotId } }, { session });
  await Delivery.updateOne({ _id: delivery._id }, { $set: { financialEarningStatus: 'held' } }, { session });
  return { credited: true, status: 'held' };
};

/**
 * Admin repair for a completed delivery whose rider pay could not be priced at
 * OTP time (status `reconciliation_required`: no usable frozen rate card, or no
 * measured distance). Prices it once from the rate card frozen at acceptance
 * (or today's card for that delivery type if none was frozen) and, when the
 * distance is missing, the distance the admin supplies. The pay is posted on
 * hold exactly like a normal completion, so the usual release rules still apply.
 */
export const repriceDeliveryEarning = async (orderId, actorId, review) => {
  requireFinanceOperation();
  const suppliedKm = review?.distanceKm === undefined || review?.distanceKm === null || review?.distanceKm === '' ? null : Number(review.distanceKm);
  if (suppliedKm !== null && !(Number.isFinite(suppliedKm) && suppliedKm >= 0 && suppliedKm <= 300)) throw httpError(400, 'Distance must be between 0 and 300 km');
  const { riderPayout, payoutModeOf, rateSnapshotFor } = await import('./riderPay.service.js');
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, review && { ...review, actorId, action: 'repriceDeliveryEarning' });
    if (order.status !== 'delivered') throw httpError(409, 'Delivered order required');
    const delivery = await Delivery.findOne({ _id: order.deliveryId, orderId: order._id, status: 'delivered', direction: { $ne: 'return_pickup' } }).session(session);
    if (!delivery) throw httpError(409, 'Completed delivery trip is missing');
    if (['held', 'eligible', 'zero_value'].includes(delivery.financialEarningStatus)) return { status: delivery.financialEarningStatus, alreadyProcessed: true };
    if (delivery.financialEarningStatus !== 'reconciliation_required') throw httpError(409, 'This delivery does not need repricing');
    const km = Number.isFinite(delivery.route?.distanceKm) && delivery.route.distanceKm >= 0 ? delivery.route.distanceKm : suppliedKm;
    if (km === null) throw httpError(400, 'This trip has no measured distance. Enter the shop-to-customer distance in km.');
    const mode = delivery.ratesUsed?.mode || payoutModeOf(order);
    const rates = frozenRatesUsable(delivery.ratesUsed) ? delivery.ratesUsed : rateSnapshotFor(mode);
    const settlement = riderPayout(km, { mode, rates, tip: order.pricing?.tipAmount });
    const set = { financialEarningStatus: settlement.total > 0 ? 'held' : 'zero_value', partnerEarnings: settlement.total, partnerTip: settlement.tip, 'route.distanceKm': km };
    if (!frozenRatesUsable(delivery.ratesUsed)) set.ratesUsed = rates;
    if (settlement.total > 0) {
      await postLedgerEntry({ idempotencyKey: `DELIVERY:${delivery._id}:EARNING`, orderId: order._id, partnerId: delivery.partnerId, deliveryId: delivery._id,
        account: 'rider_payable', type: 'delivery_earning', direction: 'credit', bucket: 'held', amount: settlement.total,
        description: `Completed delivery ${order.orderNo} (priced by admin)`, postedBy: actorId, postedByRole: 'admin',
        metadata: { source: 'order-finance-v2', ...settlement, rateConfigurationId: rateConfigurationIdOf(rates), ratesUsed: rates, snapshotId: order.financialSnapshot.snapshotId,
          repriced: true, distanceSource: Number.isFinite(delivery.route?.distanceKm) ? 'measured' : 'admin' } }, { session });
      await DeliveryPartner.updateOne({ _id: delivery.partnerId }, { $set: { financialWorkflowVersion: 2 },
        $inc: { 'earnings.total': settlement.total, 'earnings.held': settlement.total, 'earnings.tips': settlement.tip } }, { session });
    }
    await Delivery.updateOne({ _id: delivery._id }, { $set: set }, { session });
    return { status: set.financialEarningStatus, earnings: settlement.total, tip: settlement.tip, distanceKm: km };
  });
};

export const releaseDeliveryEarning = async (orderId, actorId, review) => {
  requireFinanceOperation();
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, review && { ...review, actorId, action: 'releaseDeliveryEarning' });
    if (order.status !== 'delivered') throw httpError(409, 'Delivered order required');
    await ensurePayment(order, session);
    const earning = await SellerLedgerEntry.findOne({ orderId: order._id, account: 'rider_payable', type: 'delivery_earning', bucket: 'held', direction: 'credit' }).session(session);
    if (!earning) throw httpError(409, 'Verified delivery earning is missing');
    const prior = await SellerLedgerEntry.exists({ idempotencyKey: `DELIVERY:${earning.deliveryId}:RELEASE:eligible` }).session(session);
    if (prior) return { alreadyProcessed: true };
    for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({
      idempotencyKey: `DELIVERY:${earning.deliveryId}:RELEASE:${bucket}`, partnerId: earning.partnerId, deliveryId: earning.deliveryId, orderId: order._id,
      account: 'rider_payable', type: 'adjustment', direction, bucket, amount: earning.amount,
      description: `Verified delivery earning release ${order.orderNo}`, postedBy: actorId, postedByRole: actorId ? 'admin' : 'system', metadata: { source: 'order-finance-v2' },
    }, { session });
    await DeliveryPartner.updateOne({ _id: earning.partnerId }, { $inc: { 'earnings.held': -earning.amount, 'earnings.pending': earning.amount } }, { session });
    await Delivery.updateOne({ _id: earning.deliveryId }, { $set: { financialEarningStatus: 'eligible' } }, { session });
    return { status: 'eligible' };
  });
};

export const reverseRefundedReturn = async (returnId, actorId, review) => {
  requireFinanceOperation();
  return financialTransaction(async session => {
    const ret = await Return.findById(returnId).session(session);
    if (!ret || ret.status !== 'REFUNDED') throw httpError(409, 'Authoritatively completed refund is required');
    const zero = ret.refundAmount === 0 && ret.refundStatus === 'completed' && ret.refundBreakdown?.refundAmount === 0 && ret.zeroRefundEvidence?.key === `ZERO_RETURN:${ret._id}` && ret.zeroRefundEvidence.actorId && ret.zeroRefundEvidence.reason?.length >= 5 && ret.zeroRefundEvidence.completedAt && !ret.refundReference;
    if (!ret.refundReference && !zero) throw httpError(409, 'Authoritatively completed refund is required');
    const order = await lockOrder(ret.orderId, session, review && { ...review, actorId, action: 'reverseRefundedReturn' });
    const snapshot = snapshotOf(order);
    const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
    if (!payment || snapshot.paymentId !== String(payment._id) || payment.method !== snapshot.paymentMethod || String(payment.userId) !== String(order.userId) || !(payment.groupRef && payment.groupRef === order.groupRef || String(payment.orderId) === String(order._id))) throw httpError(409, 'Original refund payment association differs from frozen order');
    if (!zero) await verifyReturnCashEvidence(payment, ret, session);
    const line = snapshot.lines.find(line => line.itemId === String(ret.orderItemId));
    if (!line || !line.rule || !order.financialPosting) throw httpError(409, 'Original order allocation is missing');
    const key = `RETURN_FINANCE:${ret._id}`;
    const markReconciled = () => Return.updateOne({ _id: ret._id, financeReconciledAt: { $exists: false } }, { $set: { financeReconciledAt: new Date() } }, { session });
    if (order.financialReturnQuantities?.[`return_${ret._id}`]) { await markReconciled(); return { alreadyProcessed: true }; }
    if (await SellerLedgerEntry.exists({ 'metadata.returnId': String(ret._id), 'metadata.source': 'order-finance-v2', type: 'reversal' }).session(session)) { await markReconciled(); return { alreadyProcessed: true }; }
    const before = order.financialReturnQuantities?.[line.itemId] || 0;
    if (ret.refundAllocationStartQuantity != null && ret.refundAllocationStartQuantity !== before) throw httpError(409, 'Earlier refund allocations must be compensated first');
    const after = before + ret.quantity;
    if (!Number.isSafeInteger(ret.quantity) || ret.quantity <= 0 || after > line.qty) throw httpError(409, 'Refund quantity exceeds original allocation');
    const proportional = amount => cumulativePaise(amount, after, line.qty) - cumulativePaise(amount, before, line.qty);
    const refundBase = proportional(line.eligiblePaise);
    if (moneyPaise(ret.refundAmount) !== refundBase) throw httpError(409, 'Refund differs from frozen merchandise allocation; manual reconciliation required');
    // Hold the seller fence also used by reservation/settlement, so a refund
    // cannot race a new withdrawal. A paid amount becomes explicit held debt.
    await Seller.updateOne({ _id: line.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
    const { sellerBalances } = await import('./sellerLedger.service.js');
    const balances = await sellerBalances(new mongoose.Types.ObjectId(line.sellerId), { session });
    const parts = refundCompensation(snapshot, line, proportional);
    const net = parts.sellerPaise;
    if (net < 0) throw httpError(409, 'Partial refund rounding requires reconciliation');
    const original = await SellerLedgerEntry.findOne({ orderId: order._id, account: 'seller_payable', type: 'order_earning', 'metadata.itemId': line.itemId }).session(session);
    const released = order.financialPosting === 'eligible' || original && await SellerLedgerEntry.exists({ idempotencyKey: `FINANCE:${original._id}:RELEASE:eligible` }).session(session);
    const available = released ? Math.min(net, Math.max(0, moneyPaise(Math.max(0, balances.eligible)))) : 0;
    for (const [suffix, account, bucket, amount] of [
      ['NET_ELIGIBLE', 'seller_payable', 'eligible', available],
      ['NET_HELD', 'seller_payable', 'held', net - available],
      ['COMMISSION', 'commission_revenue', 'held', parts.commissionPaise],
      ['TAX', 'tax_liability', 'held', parts.taxPaise],
      ['TCS', 'tcs_liability', 'held', parts.tcsPaise],
      ['TDS', 'tds_liability', 'held', parts.tdsPaise],
      ['PLATFORM_DISCOUNT', 'platform_discount_expense', 'held', parts.platformDiscountPaise],
      ['GROSS', 'merchandise_gross', 'held', proportional(line.grossPaise)],
    ]) {
      if (amount > 0) await postLedgerEntry({ idempotencyKey: `${key}:${suffix}`, sellerId: line.sellerId, orderId: order._id,
        account, type: 'reversal', status: 'reversal', direction: 'debit', bucket, amount: amount / 100,
        description: `Refund compensation ${ret.returnNumber}`, reference: ret.refundReference || ret.zeroRefundEvidence.key, postedBy: actorId, postedByRole: actorId ? 'admin' : 'system',
        metadata: { source: 'order-finance-v2', returnId: String(ret._id), itemId: line.itemId, ruleVersion: line.rule.version, snapshotId: snapshot.snapshotId, quantity: ret.quantity,
          taxableValuePaise: proportional(line.taxableValuePaise ?? line.grossPaise), gstRatePercent: line.gstRatePercent ?? null },
      }, { session });
    }
    // Zero-value returns still need a durable processed marker.
    const allReversed = snapshot.lines.every(row => row.itemId === line.itemId ? after === row.qty : order.financialReturnQuantities?.[row.itemId] === row.qty);
    await Order.updateOne({ _id: order._id }, { $set: { [`financialReturnQuantities.${line.itemId}`]: after, [`financialReturnQuantities.return_${ret._id}`]: true, ...(allReversed ? { financialPosting: 'reversed' } : {}) } }, { session });
    // Item refunds never include the delivery charge, so a fully refunded
    // order still owes the seller the incentive the customer paid for fulfilment.
    if (allReversed) await releaseSameDayIncentive(order, actorId, session);
    await markReconciled();
    return { reversedNetPaise: net, reconciliationRequired: Boolean(net > available && released) };
  });
};

/* ============================================================================
 * COURIER COD REMITTANCE (audit H1)
 *
 * A courier (Shiprocket) collects COD cash and remits it to Bulkimart. The only settlement evidence is a remittance
 * recorded by a finance admin from the provider's remittance report: never a Delivered scan, a tracking number or an
 * order status. Each remittance reference is stored once (unique index); every line is matched to one COD order by
 * AWB and applied cumulatively, so partial remittances add up and a duplicate line changes nothing.
 *   remitted == expected  → verified (the order's own payment share is settled; a grouped payment becomes paid only
 *                           when every sibling is settled, via markCodPaymentIfSettled)
 *   remitted <  expected  → remittance_reported (partial; waits for the rest or a finance review)
 *   remitted >  expected  → discrepancy (finance review queue)
 * Seller earnings are then posted by the normal finance automation, which requires settled cash.
 * ========================================================================== */

const REMITTANCE_LINE_LIMIT = 500;
const remittanceLinesHash = lines => crypto.createHash('sha256').update(JSON.stringify(lines.map(line => [line.awb, line.amountPaise]))).digest('hex');

const normaliseRemittance = ({ reference, remittedAt, lines, evidenceNote, currency = 'INR' }) => {
  const ref = typeof reference === 'string' ? reference.trim() : '';
  if (ref.length < 3 || ref.length > 100) throw httpError(400, 'Enter the remittance reference (3–100 characters) from the courier remittance report');
  if (currency !== 'INR') throw httpError(400, 'Only INR remittances are supported');
  const at = new Date(remittedAt);
  if (!remittedAt || Number.isNaN(at.getTime()) || at > new Date(Date.now() + 5 * 60 * 1000)) throw httpError(400, 'Enter a valid remittance date');
  const note = typeof evidenceNote === 'string' ? evidenceNote.trim() : '';
  if (note.length < 5 || note.length > 500) throw httpError(400, 'Describe the remittance evidence (5–500 characters), e.g. the report or bank credit it came from');
  if (!Array.isArray(lines) || !lines.length || lines.length > REMITTANCE_LINE_LIMIT) throw httpError(400, `A remittance needs 1–${REMITTANCE_LINE_LIMIT} lines`);
  const seen = new Set();
  const rows = lines.map(line => {
    const awb = typeof line?.awb === 'string' ? line.awb.trim() : '';
    if (!awb || awb.length > 64) throw httpError(400, 'Every remittance line needs its AWB');
    if (seen.has(awb)) throw httpError(400, `AWB ${awb} appears twice in this remittance`);
    seen.add(awb);
    const amountPaise = moneyPaise(line.amount, 'Remitted amount');
    if (!(amountPaise > 0)) throw httpError(400, `Remitted amount for ${awb} must be more than zero`);
    return { awb, amountPaise };
  });
  return { reference: ref, remittedAt: at, evidenceNote: note, rows };
};

/** Apply one remittance line to its order inside the remittance transaction. Returns the line outcome. */
const applyRemittanceLine = async ({ row, remittance, actorId, session }) => {
  const order = await Order.findOne({ 'shiprocket.awb': row.awb }).session(session);
  if (!order) return { ...row, outcome: 'unmatched', detail: 'No order carries this AWB' };
  const base = { ...row, orderId: order._id };
  if (order.paymentMethod !== 'cod') return { ...base, outcome: 'not_cod', detail: 'The order was not cash on delivery' };
  // Rider-delivered COD settles through the rider's verified collection, never a courier remittance.
  if (order.deliveryType !== 'shiprocket' || order.deliveryId || order.deliveryPartnerId) return { ...base, outcome: 'not_courier', detail: 'The order was not delivered by a courier' };
  if (order.status !== 'delivered') return { ...base, outcome: 'not_delivered', detail: `Order status is ${order.status}; review before applying cash` };
  if (order.financialSnapshot?.version !== 2) return { ...base, outcome: 'no_finance_snapshot', detail: 'Order needs historical finance review' };
  const locked = await lockOrder(order._id, session);
  const expectedPaise = locked.financialSnapshot.expectedPaise;
  const cash = locked.codFinance || { expectedPaise, status: 'expected', events: [] };
  if (cash.source && cash.source !== 'courier_remittance') return { ...base, outcome: 'not_courier', detail: 'COD cash is already being settled through a rider' };
  if ((cash.events || []).some(event => event.action === 'courier_remittance' && event.remittanceId === String(remittance._id))) return { ...base, outcome: 'duplicate' };
  const remittedPaise = (cash.remittedPaise || 0) + row.amountPaise;
  cash.source = 'courier_remittance';
  cash.expectedPaise = expectedPaise;
  cash.remittedPaise = remittedPaise;
  // Cash the platform has received for this order (bounds any wallet refund on a return before settlement).
  cash.collectedPaise = remittedPaise;
  cash.verifiedPaise = remittedPaise;
  cash.shortagePaise = Math.max(0, expectedPaise - remittedPaise);
  cash.excessPaise = Math.max(0, remittedPaise - expectedPaise);
  cash.status = remittedPaise === expectedPaise ? (locked.financialPosting ? 'allocated' : 'verified') : remittedPaise < expectedPaise ? 'remittance_reported' : 'discrepancy';
  cash.events = [...(cash.events || []), { action: 'courier_remittance', reference: remittance.reference, remittanceId: String(remittance._id), awb: row.awb,
    amountPaise: row.amountPaise, actorId: String(actorId), at: new Date(), reason: remittance.evidenceNote, result: cash.status }];
  cash.updatedAt = new Date();
  if (cash.status !== 'remittance_reported') for (const sellerId of new Set(locked.financialSnapshot.lines.map(line => line.sellerId))) await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
  await Order.updateOne({ _id: locked._id }, { $set: { codFinance: cash } }, { session });
  if (['verified', 'allocated'].includes(cash.status)) await markCodPaymentIfSettled({ ...locked.toObject(), codFinance: cash }, expectedPaise, session);
  return { ...base, outcome: cash.status === 'discrepancy' ? 'excess' : cash.status === 'remittance_reported' ? 'partial' : 'applied',
    detail: `Remitted ${remittedPaise} of ${expectedPaise} paise` };
};

/**
 * Record a courier COD remittance (finance admin, from the provider's remittance report). Idempotent: the same
 * reference with the same lines returns the stored result; the same reference with different lines is refused.
 */
export const recordCourierCodRemittance = async ({ reference, remittedAt, lines, evidenceNote, currency, actorId }) => {
  requireFinanceOperation();
  if (!actorId) throw httpError(403, 'A finance admin must record the remittance');
  const input = normaliseRemittance({ reference, remittedAt, lines, evidenceNote, currency });
  const linesHash = remittanceLinesHash(input.rows);
  const existing = await CourierCodRemittance.findOne({ provider: 'shiprocket', reference: input.reference }).lean();
  if (existing) {
    if (existing.linesHash !== linesHash) throw httpError(409, 'This remittance reference was already recorded with different lines. Check the report before recording it again.');
    return { remittance: existing, alreadyRecorded: true };
  }
  try {
    return await financialTransaction(async session => {
      const [remittance] = await CourierCodRemittance.create([{ provider: 'shiprocket', reference: input.reference, remittedAt: input.remittedAt,
        totalPaise: input.rows.reduce((sum, row) => sum + row.amountPaise, 0), linesHash, lines: [], evidenceNote: input.evidenceNote, recordedBy: actorId }], { session });
      const results = [];
      for (const row of input.rows) results.push(await applyRemittanceLine({ row, remittance, actorId, session }));
      remittance.lines = results;
      await remittance.save({ session });
      return { remittance: remittance.toObject(), alreadyRecorded: false };
    });
  } catch (error) {
    // Two submissions at once: the unique reference index lets one win; the other returns the stored result.
    if (error?.code === 11000) {
      const stored = await CourierCodRemittance.findOne({ provider: 'shiprocket', reference: input.reference }).lean();
      if (stored?.linesHash === linesHash) return { remittance: stored, alreadyRecorded: true };
      throw httpError(409, 'This remittance reference was already recorded with different lines.');
    }
    throw error;
  }
};

/**
 * Re-apply the lines of a recorded remittance that could not settle at the time (invariant C3, amended
 * 2026-11-25 with approval). The usual case: Shiprocket remitted the cash before its delivered scan reached
 * Bulkimart, so the line was stored as `not_delivered`; or the AWB was not yet on any order (`unmatched`).
 *
 * Safeguards:
 *   - Finance admin only, with a written reason; the attempt is appended to `reapplications` (the original
 *     `lines` are never rewritten).
 *   - Only lines whose latest outcome is not_delivered or unmatched are tried. Applied, partial, excess,
 *     duplicate, not_cod, not_courier and no_finance_snapshot lines are never re-run.
 *   - Each line goes through the same applyRemittanceLine as the first recording, which refuses a remittance
 *     already applied to that order (`duplicate`) — so cash is never credited twice.
 *   - The remittance's revision is incremented first inside the transaction: two attempts at once serialize,
 *     and the second sees the first one's results.
 *   - A delivered scan still never settles cash by itself; only the remitted amount does, and seller earnings
 *     still wait for verified cash (L2).
 */
const REAPPLICABLE_REMITTANCE_OUTCOMES = ['not_delivered', 'unmatched'];
export const reapplyCourierCodRemittance = async ({ remittanceId, reason, actorId }) => {
  requireFinanceOperation();
  if (!actorId) throw httpError(403, 'A finance admin must re-apply the remittance');
  if (!mongoose.isValidObjectId(remittanceId)) throw httpError(400, 'Invalid remittance reference');
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (note.length < 5 || note.length > 500) throw httpError(400, 'Explain why the remittance is being re-applied (5–500 characters)');
  return financialTransaction(async session => {
    const remittance = await CourierCodRemittance.findOneAndUpdate({ _id: remittanceId }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
    if (!remittance) throw httpError(404, 'Remittance not found');
    const latest = new Map(remittance.lines.map(line => [line.awb, { awb: line.awb, amountPaise: line.amountPaise, outcome: line.outcome }]));
    for (const attempt of remittance.reapplications || []) for (const result of attempt.results || []) {
      const line = latest.get(result.awb);
      if (line) latest.set(result.awb, { ...line, outcome: result.outcome });
    }
    const eligible = [...latest.values()].filter(line => REAPPLICABLE_REMITTANCE_OUTCOMES.includes(line.outcome));
    if (!eligible.length) throw httpError(409, 'No line of this remittance is waiting to be applied', { code: 'NOTHING_TO_REAPPLY' });
    const results = [];
    for (const line of eligible) {
      const applied = await applyRemittanceLine({ row: { awb: line.awb, amountPaise: line.amountPaise }, remittance, actorId, session });
      results.push({ awb: line.awb, previousOutcome: line.outcome, outcome: applied.outcome, orderId: applied.orderId, detail: applied.detail });
    }
    await CourierCodRemittance.updateOne({ _id: remittance._id }, { $push: { reapplications: { at: new Date(), actorId, reason: note, results } } }, { session });
    return { remittanceId: remittance._id, reference: remittance.reference, revision: remittance.revision, results };
  });
};

/**
 * Read-only reconciliation report of courier COD orders (historical and new): shipment, cash/remittance, payment,
 * seller-earning and return state, and the action each needs. Changes nothing.
 */
export const courierCodReconciliationReport = async ({ page = 1, limit = 50, needsAction = false } = {}) => {
  const filter = { paymentMethod: 'cod', deliveryType: 'shiprocket', ...(needsAction ? { 'codFinance.status': { $nin: ['verified', 'allocated'] } } : {}) };
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select('orderNo status paymentId pricing.totalAmount financialSnapshot.version financialSnapshot.expectedPaise financialPosting codFinance.status codFinance.source codFinance.remittedPaise shiprocket.orderId shiprocket.shipmentId shiprocket.awb shiprocket.trackingStatus shiprocket.status createdAt').lean(),
    Order.countDocuments(filter),
  ]);
  const ids = orders.map(order => order._id);
  // Provider charges confirmed from billing evidence (courierCost.service.js), per forward shipment.
  const chargeRows = await CourierCharge.find({ _id: { $in: orders.filter(order => order.shiprocket?.shipmentId).map(order => `forward:${order.shiprocket.shipmentId}`) }, status: 'actual' }).select('actualPaise').lean();
  const verifiedChargeOf = new Map(chargeRows.map(row => [row._id, row.actualPaise || 0]));
  const [payments, returns] = await Promise.all([
    Payment.find({ _id: { $in: orders.map(order => order.paymentId).filter(Boolean) } }).select('status').lean(),
    Return.find({ orderId: { $in: ids } }).select('orderId status refundStatus refundAmount').lean(),
  ]);
  const paymentOf = new Map(payments.map(row => [String(row._id), row.status]));
  const rows = orders.map(order => {
    const expectedPaise = order.financialSnapshot?.expectedPaise ?? Math.round((order.pricing?.totalAmount || 0) * 100);
    const remittedPaise = order.codFinance?.source === 'courier_remittance' ? order.codFinance.remittedPaise || 0 : 0;
    const cashStatus = order.codFinance?.status || 'expected';
    const orderReturns = returns.filter(row => String(row.orderId) === String(order._id));
    const action = order.financialSnapshot?.version !== 2 ? 'Historical finance review: no finance snapshot'
      : order.status !== 'delivered' ? 'Wait for delivery (or resolve the shipment exception)'
        : ['verified', 'allocated'].includes(cashStatus) ? (order.financialPosting ? 'None: settled and posted' : 'None: settled; earnings post on the next finance run')
          : cashStatus === 'discrepancy' ? 'Finance review: remitted more than expected'
            : remittedPaise > 0 ? 'Record the remaining remittance or review the shortfall'
              : 'Record the courier remittance from the provider report';
    /**
     * Gross vs net, shown side by side and never netted automatically. If Shiprocket remits the full COD
     * amount (charges billed separately), `outstandingPaise` is what is still to come. If it deducts its
     * charges first, the deduction shows as `verifiedCourierChargesPaise` once finance records the provider
     * invoice, and `unexplainedPaise` is what neither remittance nor verified charges account for. Neither
     * case settles anything: a shortfall stays outstanding until finance records evidence or writes it off.
     */
    const verifiedCourierChargesPaise = order.shiprocket?.shipmentId ? verifiedChargeOf.get(`forward:${order.shiprocket.shipmentId}`) ?? null : null;
    const outstandingPaise = Math.max(0, expectedPaise - remittedPaise);
    const amounts = { grossCodPaise: expectedPaise, verifiedCourierChargesPaise, remittedPaise, outstandingPaise,
      unexplainedPaise: Math.max(0, outstandingPaise - (verifiedCourierChargesPaise || 0)), excessPaise: Math.max(0, remittedPaise - expectedPaise) };
    return { orderId: order._id, orderNo: order.orderNo, orderStatus: order.status, amounts, shipment: { awb: order.shiprocket?.awb || null, providerBooked: Boolean(order.shiprocket?.orderId), tracking: order.shiprocket?.trackingStatus || order.shiprocket?.status || null },
      expectedPaise, remittedPaise, cashStatus, paymentStatus: paymentOf.get(String(order.paymentId)) || 'missing', sellerEarning: order.financialPosting || 'not_posted',
      returns: orderReturns.map(row => ({ status: row.status, refundStatus: row.refundStatus, refundAmount: row.refundAmount })), action };
  });
  return { rows, total, page, limit };
};
