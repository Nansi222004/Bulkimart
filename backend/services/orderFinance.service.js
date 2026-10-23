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
import { moneyPaise } from './vendorCommission.service.js';
import { httpError } from '../utils/response.js';

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

export const recordCodEvent = async ({ orderId, partnerId, actorId, action, input }) => {
  requireFinanceOperation();
  if (!['collect', 'remit', 'verify', 'dispute'].includes(action)) throw httpError(400, 'Unknown COD action');
  const proof = evidence(input);
  const amountPaise = moneyPaise(input.amount);
  return financialTransaction(async session => {
    const order = await lockOrder(orderId, session, ['verify','dispute'].includes(action) && input.expectedRevision != null ? { ...input, actorId, action: `cod:${action}` } : undefined);
    if (order.paymentMethod !== 'cod') throw httpError(409, 'Order is not COD');
    if (!['verify', 'dispute'].includes(action) && String(order.deliveryPartnerId) !== String(partnerId)) throw httpError(404, 'COD assignment not found');
    const delivery = await Delivery.findOne({ _id: order.deliveryId, orderId: order._id, partnerId: order.deliveryPartnerId }).session(session);
    if (!delivery || delivery.direction === 'return_pickup' || delivery.status !== 'delivered' || !delivery.otpVerified || action === 'collect' && order.status !== 'delivered') throw httpError(409, 'Verified completed delivery is required');
    const expectedPaise = snapshotOf(order).expectedPaise;
    const cash = order.codFinance || { expectedPaise, status: 'expected', events: [] };
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
    } else if (action === 'collect') {
      if (input.method !== 'cash') throw httpError(400, 'Only cash collection is approved by this workflow');
      if (cash.status !== 'expected') throw httpError(409, 'Collection already recorded');
      if (amountPaise !== expectedPaise) throw httpError(409, 'Collected amount must match expected COD exactly');
      cash.status = 'collected'; cash.collectedPaise = amountPaise;
      await cashLedger(order, 'credit', 'COLLECTED', actorId, session);
    } else if (action === 'remit') {
      if (cash.status !== 'collected') throw httpError(409, 'Collection must precede remittance reporting');
      cash.status = 'remittance_reported'; cash.reportedPaise = amountPaise;
      // A rider report never establishes platform receipt.
    } else {
      if (!['remittance_reported', 'discrepancy', 'disputed'].includes(cash.status) || !cash.events.some(event => event.action === 'remit')) throw httpError(409, 'Reported handover is required before verification');
      if (String(actorId) === String(cash.events.find(row => row.action === 'remit')?.actorId)) throw httpError(403, 'The remittance reporter cannot verify their own cash');
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
      if (['verified','allocated'].includes(cash.status)) {
        // Receipt changes above are append-only deltas. Re-verifying the same
        // amount appends evidence without posting a second cash receipt.
        // Shared checkout Payment becomes paid only after every sibling's cash
        // is verified. Write Payment first to serialize concurrent siblings.
        const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
        if (!payment || payment.method !== 'cod') throw httpError(409, 'COD payment association is missing');
        payment.settlementRevision = (payment.settlementRevision || 0) + 1;
        await payment.save({ session });
        const siblings = await Order.find(payment.groupRef ? { groupRef: payment.groupRef, paymentId: payment._id } : { _id: payment.orderId, paymentId: payment._id }).session(session);
        if (!siblings.some(sibling => String(sibling._id) === String(order._id))) throw httpError(409, 'COD order is not associated with payment');
        const paidPaise = siblings.reduce((sum, sibling) => sum + (String(sibling._id) === String(order._id) ? expectedPaise : sibling.codFinance?.status === 'verified' || sibling.codFinance?.status === 'allocated' ? sibling.codFinance.verifiedPaise : 0), 0);
        if (paidPaise === moneyPaise(payment.amount) && siblings.every(sibling => String(sibling._id) === String(order._id) || ['verified', 'allocated'].includes(sibling.codFinance?.status))) {
          payment.status = 'paid'; payment.paidAt = new Date(); await payment.save({ session });
        }
      }
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
    if (!['verified', 'allocated'].includes(order.codFinance?.status) || order.codFinance?.verifiedPaise !== snapshotOf(order).expectedPaise) throw httpError(409, 'COD cash is not verified');
    return;
  }
  const payment = await Payment.findOneAndUpdate({ _id: order.paymentId }, { $inc: { settlementRevision: 1 } }, { session, returnDocument: 'after' });
  if (!payment) throw httpError(409, 'Verified customer payment is required');
  const cashReturns = allowCompensatedRefunds && await Return.exists({ orderId: { $in: (await Order.find({ paymentId: payment._id }).select('_id').session(session)).map(row => row._id) }, status: { $nin: ['REJECTED', 'CANCELLED'] }, refundAmount: { $gt: 0 } }).session(session);
  const captureRefunds = allowCompensatedRefunds && payment.refundObligations.some(row => payment.captures.some(capture => capture.disposition === 'settled' && capture.gatewayPaymentId === row.gatewayPaymentId));
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
      const common = { sellerId: line.sellerId, orderId: order._id, paymentId: order.paymentId, direction: 'credit', bucket: 'held', postedBy: actorId, postedByRole: 'admin',
        metadata: { source: 'order-finance-v2', itemId: line.itemId, ruleVersion: line.rule.version, snapshotId: snapshot.snapshotId } };
      for (const [suffix, account, type, amount] of [
        ['NET', 'seller_payable', 'order_earning', line.netPaise],
        ['COMMISSION', 'commission_revenue', 'platform_commission', line.commissionPaise],
        ['TAX', 'tax_liability', 'commission_tax', line.taxPaise],
        ['GROSS', 'merchandise_gross', 'merchandise_gross', line.grossPaise],
      ]) {
        if (amount > 0) await postLedgerEntry({ ...common, idempotencyKey: `FINANCE:${order._id}:${line.itemId}:${suffix}`, account, type, amount: amount / 100, description: `${type} for ${order.orderNo}` }, { session });
      }
    }
    if (snapshot.components.deliveryPaise > 0) await postLedgerEntry({ idempotencyKey: `FINANCE:${order._id}:CUSTOMER_DELIVERY`, orderId: order._id,
      account: 'customer_delivery', type: 'customer_delivery', direction: 'credit', bucket: 'held', amount: snapshot.components.deliveryPaise / 100,
      description: `Customer delivery charge ${order.orderNo}`, metadata: { source: 'order-finance-v2', snapshotId: snapshot.snapshotId } }, { session });
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
    if (order.items.some(item => !item.deliveredAt || (item.returnEligibleUntil && new Date(item.returnEligibleUntil) > new Date()))) throw httpError(409, 'Delivery evidence or return hold has not cleared');
    const returns = await Return.find({ orderId: order._id, status: { $nin: ['REJECTED', 'CANCELLED'] } }).session(session);
    if (returns.some(ret => ret.status !== 'REFUNDED' || !order.financialReturnQuantities?.[`return_${ret._id}`])) throw httpError(409, 'Returns require financial reconciliation before release');
    const entries = await SellerLedgerEntry.find({ orderId: order._id, account: 'seller_payable', type: 'order_earning', bucket: 'held' }).session(session);
    for (const entry of entries) {
      await Seller.updateOne({ _id: entry.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const reversals = await SellerLedgerEntry.find({ orderId: order._id, account: 'seller_payable', type: 'reversal', bucket: 'held', direction: 'debit', 'metadata.itemId': entry.metadata.itemId }).session(session);
      const amountPaise = moneyPaise(entry.amount) - reversals.reduce((sum, row) => sum + moneyPaise(row.amount), 0);
      if (amountPaise < 0) throw httpError(409, 'Refund reversals exceed original seller earnings');
      if (!amountPaise) continue;
      for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({
        idempotencyKey: `FINANCE:${entry._id}:RELEASE:${bucket}`, sellerId: entry.sellerId, orderId: order._id, account: 'seller_payable',
        type: 'adjustment', direction, bucket, amount: amountPaise / 100, description: `Return hold cleared ${order.orderNo}`,
        postedBy: actorId, postedByRole: 'admin', metadata: { source: 'order-finance-v2', originalEntryId: String(entry._id) },
      }, { session });
    }
    await Order.updateOne({ _id: order._id }, { $set: { financialPosting: 'eligible' } }, { session });
    return { status: 'eligible' };
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
      description: `Verified delivery earning release ${order.orderNo}`, postedBy: actorId, postedByRole: 'admin', metadata: { source: 'order-finance-v2' },
    }, { session });
    await DeliveryPartner.updateOne({ _id: earning.partnerId }, { $inc: { 'earnings.held': -earning.amount, 'earnings.pending': earning.amount } }, { session });
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
    if (order.financialReturnQuantities?.[`return_${ret._id}`]) return { alreadyProcessed: true };
    if (await SellerLedgerEntry.exists({ 'metadata.returnId': String(ret._id), 'metadata.source': 'order-finance-v2', type: 'reversal' }).session(session)) return { alreadyProcessed: true };
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
    const net = refundBase - proportional(line.commissionPaise) - proportional(line.taxPaise);
    if (net < 0) throw httpError(409, 'Partial refund rounding requires reconciliation');
    const available = order.financialPosting === 'eligible' ? Math.min(net, Math.max(0, moneyPaise(Math.max(0, balances.eligible)))) : 0;
    for (const [suffix, account, bucket, amount] of [
      ['NET_ELIGIBLE', 'seller_payable', 'eligible', available],
      ['NET_HELD', 'seller_payable', 'held', net - available],
      ['COMMISSION', 'commission_revenue', 'held', proportional(line.commissionPaise)],
      ['TAX', 'tax_liability', 'held', proportional(line.taxPaise)],
      ['GROSS', 'merchandise_gross', 'held', proportional(line.grossPaise)],
    ]) {
      if (amount > 0) await postLedgerEntry({ idempotencyKey: `${key}:${suffix}`, sellerId: line.sellerId, orderId: order._id,
        account, type: 'reversal', status: 'reversal', direction: 'debit', bucket, amount: amount / 100,
        description: `Refund compensation ${ret.returnNumber}`, reference: ret.refundReference || ret.zeroRefundEvidence.key, postedBy: actorId, postedByRole: 'admin',
        metadata: { source: 'order-finance-v2', returnId: String(ret._id), itemId: line.itemId, ruleVersion: line.rule.version, snapshotId: snapshot.snapshotId, quantity: ret.quantity },
      }, { session });
    }
    // Zero-value returns still need a durable processed marker.
    const allReversed = snapshot.lines.every(row => row.itemId === line.itemId ? after === row.qty : order.financialReturnQuantities?.[row.itemId] === row.qty);
    await Order.updateOne({ _id: order._id }, { $set: { [`financialReturnQuantities.${line.itemId}`]: after, [`financialReturnQuantities.return_${ret._id}`]: true, ...(allReversed ? { financialPosting: 'reversed' } : {}) } }, { session });
    return { reversedNetPaise: net, reconciliationRequired: net > available && order.financialPosting === 'eligible' };
  });
};
