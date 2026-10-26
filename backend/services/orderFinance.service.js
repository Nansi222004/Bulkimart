import { verifyReturnCashEvidence, verifyRefundedFunding } from './refundFunding.service.js';
import { cumulativePaise } from '../utils/financeMoney.js';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Seller from '../models/Seller.js';
import Return from '../models/Return.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { financialTransaction, requireFinanceOperation } from './financeSafety.service.js';
import { moneyPaise, sameDayIncentiveOf } from './vendorCommission.service.js';
import { httpError } from '../utils/response.js';
import { returnHoldOpen } from './returnHold.service.js';

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
const releaseSameDayIncentive = async (order, actorId, session) => {
  const entry = await SellerLedgerEntry.findOne({ orderId: order._id, account: 'seller_payable', type: 'same_day_incentive', bucket: 'held', direction: 'credit' }).session(session);
  if (!entry || await SellerLedgerEntry.exists({ idempotencyKey: `FINANCE:${entry._id}:RELEASE:eligible` }).session(session)) return false;
  await Seller.updateOne({ _id: entry.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
  for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({
    idempotencyKey: `FINANCE:${entry._id}:RELEASE:${bucket}`, sellerId: entry.sellerId, orderId: order._id, account: 'seller_payable',
    type: 'adjustment', direction, bucket, amount: entry.amount, description: `Same-day incentive released ${order.orderNo}`,
    postedBy: actorId, postedByRole: actorId ? 'admin' : 'system', metadata: { source: 'order-finance-v2', originalEntryId: String(entry._id), kind: 'same_day_incentive' },
  }, { session });
  return true;
};
// Cash Bulkimart accepts as settled: what was verified plus any shortage the
// platform has written off under the approved "platform absorbs" policy.
export const codSettledPaise = cash => (cash?.verifiedPaise || 0) + (cash?.writtenOffPaise || 0);
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
  const paidPaise = siblings.reduce((sum, sibling) => sum + (String(sibling._id) === String(order._id) ? expectedPaise : settled(sibling) ? codSettledPaise(sibling.codFinance) : 0), 0);
  if (paidPaise === moneyPaise(payment.amount) && siblings.every(sibling => String(sibling._id) === String(order._id) || settled(sibling))) {
    payment.status = 'paid'; payment.paidAt = new Date(); await payment.save({ session });
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
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, admin && input.expectedRevision != null ? { ...input, actorId, action: `cod:${action}` } : undefined);
    if (order.paymentMethod !== 'cod') throw httpError(409, 'Order is not COD');
    if (!admin && String(order.deliveryPartnerId) !== String(partnerId)) throw httpError(404, 'COD assignment not found');
    const delivery = await Delivery.findOne({ _id: order.deliveryId, orderId: order._id, partnerId: order.deliveryPartnerId }).session(session);
    if (!delivery || delivery.direction === 'return_pickup' || delivery.status !== 'delivered' || !delivery.otpVerified || action === 'collect' && order.status !== 'delivered') throw httpError(409, 'Verified completed delivery is required');
    const expectedPaise = snapshotOf(order).expectedPaise;
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
      const custodyLeft = Math.max(0, (cash.collectedPaise || 0) - Math.min(expectedPaise, cash.verifiedPaise || 0));
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
      // The rider records what the customer actually paid; any shortage stays
      // visible and is settled at verification or by an approved write-off.
      if (amountPaise <= 0 || amountPaise > expectedPaise) throw httpError(409, 'Collected amount must be more than zero and at most the order amount');
      cash.status = 'collected'; cash.collectedPaise = amountPaise; cash.collectedAt = new Date();
      await cashLedger(order, 'credit', 'COLLECTED', actorId, session, amountPaise);
    } else if (action === 'remit') {
      if (cash.status !== 'collected') throw httpError(409, 'Collection must precede remittance reporting');
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
      const custodyDelta = Math.min(expectedPaise, amountPaise) - Math.min(expectedPaise, previousVerified);
      if (custodyDelta) await cashLedger(order, custodyDelta > 0 ? 'debit' : 'credit', `RECEIPT:${receiptKey}`, actorId, session, Math.abs(custodyDelta), 'cod_custody', proof.reference);
      const excessDelta = Math.max(0, amountPaise - expectedPaise) - Math.max(0, previousVerified - expectedPaise);
      if (excessDelta) await cashLedger(order, excessDelta > 0 ? 'credit' : 'debit', `EXCESS:${receiptKey}`, actorId, session, Math.abs(excessDelta), 'cod_excess_liability', proof.reference);
      cash.verifiedPaise = amountPaise;
      cash.shortagePaise = Math.max(0, expectedPaise - amountPaise);
      cash.excessPaise = Math.max(0, amountPaise - expectedPaise);
      cash.status = amountPaise === expectedPaise ? 'verified' : 'discrepancy';
      if (cash.status === 'verified' && order.financialPosting) cash.status = 'allocated';
      // Receipt changes above are append-only deltas. Re-verifying the same
      // amount appends evidence without posting a second cash receipt.
      if (['verified','allocated'].includes(cash.status)) await markCodPaymentIfSettled(order, expectedPaise, session);
    }
    cash.events.push({ action, ...proof, amountPaise, actorId: String(actorId), at: new Date(), deliveryId: String(delivery._id), partnerId: String(delivery.partnerId), result: cash.status });
    await Order.updateOne({ _id: order._id }, { $set: { codFinance: cash } }, { session });
    return cash;
  });
};

const ensurePayment = async (order, session, allowCompensatedRefunds = false) => {
  if (snapshotOf(order).paymentMethod !== order.paymentMethod) throw httpError(409, 'Payment method differs from frozen financial snapshot');
  if (snapshotOf(order).paymentId !== String(order.paymentId)) throw httpError(409, 'Payment association differs from frozen financial snapshot');
  if (order.paymentMethod === 'cod') {
    if (!['verified', 'allocated'].includes(order.codFinance?.status) || codSettledPaise(order.codFinance) !== snapshotOf(order).expectedPaise) throw httpError(409, 'COD cash is not verified');
    return;
  }
  const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
  if (!payment) throw httpError(409, 'Verified customer payment is required');
  if (payment.merchandiseSettlementHold) throw httpError(409, 'Payment dispute requires financial reconciliation');
  const cashReturns = allowCompensatedRefunds && await Return.exists({ orderId: { $in: (await Order.find({ paymentId: payment._id }).select('_id').session(session)).map(row => row._id) }, status: 'REFUNDED', refundAmount: { $gt: 0 } }).session(session);
  const captureRefunds = allowCompensatedRefunds && payment.refundObligations.some(row => (row.status === 'processed' || !row.returnId) && payment.captures.some(capture => capture.disposition === 'settled' && capture.gatewayPaymentId === row.gatewayPaymentId));
  if (payment.status !== 'paid' || cashReturns || captureRefunds) {
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
    if (deliveryPaise > 0) await postLedgerEntry({ idempotencyKey: `FINANCE:${order._id}:CUSTOMER_DELIVERY`, orderId: order._id,
      account: 'customer_delivery', type: 'customer_delivery', direction: 'credit', bucket: 'held', amount: deliveryPaise / 100,
      description: `Customer delivery charge ${order.orderNo}`, metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
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
      const blocked = returnHoldOpen(item) || returns.some(ret => String(ret.orderItemId) === entry.metadata.itemId && (ret.status !== 'REFUNDED' || !order.financialReturnQuantities?.[`return_${ret._id}`]));
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
    if (status === 'eligible') await releaseSameDayIncentive(order, actorId, session);
    await Order.updateOne({ _id: order._id }, { $set: { financialPosting: status } }, { session });
    return { status, heldLines, releasedLines };
  });
};

export const recordDeliveryEarning = async ({ order, delivery, settlement, session }) => {
  // Called only within the existing OTP completion transaction. Legacy orders
  // keep their current behavior; v2 COD earns into held, never pending cash.
  if (!order.financialSnapshot) return false;
  const verified = ['total', 'tip', 'base', 'perKm', 'distanceKm'].every(key => Number.isFinite(settlement[key]) && settlement[key] >= 0)
    && Number.isFinite(delivery.route?.distanceKm) && delivery.route.distanceKm >= 0 && delivery.ratesUsed?.rateId;
  if (!verified || settlement.total === 0) {
    const status = verified ? 'zero_value' : 'reconciliation_required';
    await Delivery.updateOne({ _id: delivery._id }, { $set: { financialEarningStatus: status }, ...(!verified ? { $unset: { partnerEarnings: 1, partnerTip: 1 } } : {}) }, { session });
    return { credited: false, status };
  }
  await postLedgerEntry({ idempotencyKey: `DELIVERY:${delivery._id}:EARNING`, orderId: order._id, partnerId: delivery.partnerId, deliveryId: delivery._id,
    account: 'rider_payable', type: 'delivery_earning', direction: 'credit', bucket: 'held', amount: settlement.total,
    description: `Completed delivery ${order.orderNo}`, metadata: { source: 'order-finance-v2', ...settlement, rateConfigurationId: String(delivery.ratesUsed.rateId), ratesUsed: delivery.ratesUsed, snapshotId: order.financialSnapshot.snapshotId } }, { session });
  await Delivery.updateOne({ _id: delivery._id }, { $set: { financialEarningStatus: 'held' } }, { session });
  return { credited: true, status: 'held' };
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
