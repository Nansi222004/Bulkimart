import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Delivery from '../models/Delivery.js';
import Return from '../models/Return.js';
import Commission from '../models/Commission.js';
import Seller from '../models/Seller.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { httpError } from '../utils/response.js';
import { financialTransaction, requireFinanceOperation } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import Admin from '../models/Admin.js';
import SellerPayout from '../models/SellerPayout.js';
import { moneyPaise } from '../utils/financeMoney.js';

export { historicalManifestRow } from '../utils/historicalManifest.js';
import { historicalManifestRow } from '../utils/historicalManifest.js';

export const historicalExceptions = async ({ page = 1, limit = 50, orderIds, session = null } = {}) => {
  const filter = { 'financialSnapshot.version': { $ne: 2 }, ...(orderIds ? { _id: { $in: orderIds } } : { status: 'delivered' }) };
  limit = Math.min(100, Math.max(1, Number(limit) || 50)); page = Math.max(1, Number(page) || 1);
  const orders = await Order.find(filter).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).session(session).lean();
  const policies = await Commission.find({}).select('_id').sort({ _id: 1 }).session(session).lean();
  const rows = [];
  for (const order of orders) {
    const payment = await Payment.findById(order.paymentId).session(session).lean();
    const deliveries = await Delivery.find({ orderId: order._id }).select('_id status otpVerified').sort({ _id: 1 }).session(session).lean();
    const returns = await Return.find({ orderId: order._id }).select('_id orderItemId quantity status refundAmount refundReference').sort({ _id: 1 }).session(session).lean();
    const entries = await Ledger.find({ orderId: order._id }).sort({ _id: 1 }).session(session).lean();
    const sellerIds = order.items.map(item => item.sellerId);
    const payouts = await SellerPayout.find({ sellerId: { $in: sellerIds } }).select('_id sellerId payoutNo amount status ledgerEntryIds').sort({ _id: 1 }).session(session).lean();
    const unscopedEntries = await Ledger.find({ sellerId: { $in: sellerIds }, orderId: { $exists: false } }).select('_id sellerId amount idempotencyKey direction bucket').sort({ _id: 1 }).session(session).lean();
    for (const item of order.items) rows.push(historicalManifestRow({ order, item, payment, deliveries, returns, entries, policies, payouts, unscopedEntries }));
  }
  return { manifestVersion: 1, mode: 'dry-run', page, limit, totalOrders: await Order.countDocuments(filter).session(session), rows, mutations: 0 };
};

// This deliberately has no generic CLI or HTTP apply route. A separately
// authorized recovery operation must persist a reviewed, exact batch first.
// Presence of a proposed amount in an uploaded JSON file is never approval.
export const applyReviewedHistoricalBatch = async ({ batchId, actorId, approvalReference }) => {
  requireFinanceOperation();
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9:_-]{5,120}$/.test(batchId) || typeof approvalReference !== 'string' || approvalReference.trim().length < 5) throw httpError(400, 'Exact batch and approval references are required');
  const actor = await Admin.findById(actorId).lean();
  if (!actor?.isActive || !actor.permissions?.includes('manage_finance')) throw httpError(403, 'Finance operator required');
  return financialTransaction(async session => {
    const batches = mongoose.connection.collection('finance_historical_reviewed_batches');
    const batch = await batches.findOne({ _id: batchId }, { session });
    if (!batch || batch.approvalReference !== approvalReference || !approvalReference || !batch.operatorId || !batch.reviewerId || String(batch.operatorId) === String(batch.reviewerId)) throw httpError(409, 'Separately reviewed approval is missing');
    const reviewers = await Admin.find({ _id: { $in: [batch.operatorId, batch.reviewerId] }, isActive: true, permissions: 'manage_finance' }).session(session).lean();
    if (reviewers.length !== 2 || batch.manifestHash !== crypto.createHash('sha256').update(JSON.stringify(batch.rows)).digest('hex')) throw httpError(409, 'Reviewed batch integrity or independent reviewers are invalid');
    if (batch.status === 'applied') return { batchId, alreadyProcessed: true };
    if (batch.manifestVersion !== 1 || batch.status !== 'approved' || !Array.isArray(batch.rows) || !batch.rows.length) throw httpError(409, 'Approved nonempty versioned batch required');
    const seen = new Set();
    for (const row of batch.rows) {
      if (![row.orderId,row.itemId,row.sellerId].every(value => typeof value === 'string' && mongoose.isValidObjectId(value)) || row.idempotencyKey !== `HISTORICAL:${row.orderId}:${row.itemId}:v1` || seen.has(row.idempotencyKey) || !row.policyVersion || !row.originalAgreementReference || !row.fundingEvidenceReference || !row.entitlementApprovalReference || row.currency !== 'INR'
        || !Number.isSafeInteger(row.proposedPayablePaise) || row.proposedPayablePaise <= 0) throw httpError(409, 'Historical entitlement or evidence is unresolved');
      if (!['grossPaise', 'eligiblePaise', 'commissionPaise', 'taxPaise'].every(key => Number.isSafeInteger(row[key]) && row[key] >= 0) || row.eligiblePaise > row.grossPaise || row.proposedPayablePaise + row.commissionPaise + row.taxPaise !== row.eligiblePaise) throw httpError(409, 'Approved historical amounts do not reconcile');
      seen.add(row.idempotencyKey);
      // Fence the order and seller against current return/payment workflows.
      await Order.updateOne({ _id: row.orderId }, { $inc: { financialRevision: 1 } }, { session });
      await Seller.updateOne({ _id: row.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const current = await historicalExceptions({ orderIds: [row.orderId], session });
      const original = current.rows.find(value => value.itemId === row.itemId && value.sellerId === row.sellerId);
      if (!original || original.evidenceHash !== row.evidenceHash || original.evidence.entries.length || original.classification === 'already_reconciled') throw httpError(409, 'Historical evidence is stale or conflicts with prior postings');
      if (row.grossPaise !== moneyPaise(original.evidence.price) * original.evidence.qty) throw httpError(409, 'Historical gross differs from frozen item evidence');
      if (original.evidence.returns.length && !row.refundReconciliationReference) throw httpError(409, 'Historical returns require reviewed refund reconciliation');
      if ((original.evidence.payouts.length || original.evidence.unattributedEntries.length) && !row.priorPayoutReconciliationReference) throw httpError(409, 'Prior seller payouts and unattributed entries require reviewed reconciliation');
      if (!row.codCustodyApprovalReference && original.evidence.payment?.method === 'cod') throw httpError(409, 'Historical COD custody approval required');
    }
    for (const row of batch.rows) {
      for (const [suffix, account, type, amount] of [['NET', 'seller_payable', 'adjustment', row.proposedPayablePaise], ['COMMISSION', 'commission_revenue', 'platform_commission', row.commissionPaise], ['TAX', 'tax_liability', 'commission_tax', row.taxPaise], ['GROSS', 'merchandise_gross', 'merchandise_gross', row.grossPaise]]) {
      if (!amount) continue;
      await postLedgerEntry({ idempotencyKey: `${row.idempotencyKey}:${suffix}`, sellerId: row.sellerId, orderId: row.orderId, account, type, direction: 'credit', bucket: 'held', currency: 'INR', amount: amount / 100,
        reference: approvalReference, postedBy: actorId, postedByRole: 'admin', description: `Reviewed historical entitlement ${batchId}`,
        metadata: { source: 'historical-reviewed-v1', itemId: row.itemId, batchId, policyVersion: row.policyVersion, evidenceHash: row.evidenceHash, operatorId: String(batch.operatorId), reviewerId: String(batch.reviewerId) } }, { session });
      }
    }
    await batches.updateOne({ _id: batchId, status: 'approved' }, { $set: { status: 'applied', appliedAt: new Date(), appliedBy: actorId } }, { session });
    return { batchId, status: 'applied', bucket: 'held', releaseAutomatically: false };
  });
};
