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

// ---- Reviewed batch workflow for pre-ledger orders -----------------------
// One admin prepares a batch with the evidence for each item, a different
// admin approves it, then it is applied (earnings on hold) and released
// (available to pay). Nothing is ever credited from the read-only report alone.
const batchesCollection = () => mongoose.connection.collection('finance_historical_reviewed_batches');
const financeOperator = async (actorId, session = null) => {
  const actor = await Admin.findById(actorId).session(session).lean();
  if (!actor?.isActive || (!actor.permissions?.includes('manage_finance') && actor.role !== 'superAdmin')) throw httpError(403, 'Finance operator required');
  return actor;
};
const text = (value, name, required = true) => {
  const out = String(value ?? '').trim();
  if ((required || out) && (out.length < 5 || out.length > 300)) throw httpError(400, `${name} must be 5–300 characters`);
  return out || null;
};
const rupeesToPaise = (value, name) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) || number < 0) throw httpError(400, `${name} must be zero or more`);
  return moneyPaise(number, name);
};

export const listHistoricalBatches = async () => ({ batches: await batchesCollection().find({}, { projection: { rows: 1, status: 1, operatorId: 1, reviewerId: 1, note: 1, approvalReference: 1, createdAt: 1, approvedAt: 1, appliedAt: 1, releasedAt: 1, rejectionReason: 1 } }).sort({ createdAt: -1 }).limit(50).toArray() });

export const createHistoricalBatch = async ({ rows, note, actorId }) => {
  requireFinanceOperation();
  await financeOperator(actorId);
  const batchNote = text(note, 'Batch note');
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) throw httpError(400, 'Add between 1 and 50 order items');
  const proposals = [], seen = new Set();
  for (const input of rows) {
    if (!mongoose.isValidObjectId(input?.orderId) || !mongoose.isValidObjectId(input?.itemId)) throw httpError(400, 'Each row needs an order and item');
    const report = await historicalExceptions({ orderIds: [new mongoose.Types.ObjectId(String(input.orderId))] });
    const original = report.rows.find(row => row.itemId === String(input.itemId));
    if (!original) throw httpError(404, 'Old order item not found');
    if (original.classification === 'already_reconciled' || seen.has(original.idempotencyKey)) throw httpError(409, `${original.orderNo} is already settled or listed twice`);
    if (await batchesCollection().findOne({ status: { $in: ['pending_approval', 'approved', 'applied', 'released'] }, 'rows.idempotencyKey': original.idempotencyKey })) throw httpError(409, `${original.orderNo} is already in another batch`);
    seen.add(original.idempotencyKey);
    const grossPaise = moneyPaise(original.evidence.price) * original.evidence.qty;
    const commissionPaise = rupeesToPaise(input.commission, 'Commission'), taxPaise = rupeesToPaise(input.commissionGst, 'GST on commission');
    // Bulkimart funds discounts, so the seller's base is the full item price.
    const proposedPayablePaise = grossPaise - commissionPaise - taxPaise;
    if (proposedPayablePaise <= 0) throw httpError(400, `${original.orderNo}: commission and GST must be less than the item price`);
    const agreement = text(input.agreementReference, 'Original commission agreement');
    proposals.push({ manifestVersion: 1, orderId: original.orderId, orderNo: original.orderNo, itemId: original.itemId, sellerId: original.sellerId, currency: 'INR',
      idempotencyKey: original.idempotencyKey, evidenceHash: original.evidenceHash, policyVersion: agreement, originalAgreementReference: agreement,
      fundingEvidenceReference: text(input.fundingEvidenceReference, 'Payment proof'), entitlementApprovalReference: text(input.entitlementApprovalReference, 'Amount approval'),
      codCustodyApprovalReference: text(input.codCustodyApprovalReference, 'COD cash proof', original.evidence.payment?.method === 'cod'),
      refundReconciliationReference: text(input.refundReconciliationReference, 'Refund check', original.evidence.returns.length > 0),
      priorPayoutReconciliationReference: text(input.priorPayoutReconciliationReference, 'Earlier payout check', original.evidence.payouts.length > 0 || original.evidence.unattributedEntries.length > 0),
      grossPaise, eligiblePaise: grossPaise, commissionPaise, taxPaise, proposedPayablePaise });
  }
  const now = new Date();
  const batch = { _id: `HB-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, manifestVersion: 1, status: 'pending_approval',
    operatorId: new mongoose.Types.ObjectId(String(actorId)), note: batchNote, rows: proposals, createdAt: now };
  batch.manifestHash = crypto.createHash('sha256').update(JSON.stringify(batch.rows)).digest('hex');
  await batchesCollection().insertOne(batch);
  return batch;
};

export const reviewHistoricalBatch = async ({ batchId, actorId, approve, note }) => {
  requireFinanceOperation();
  await financeOperator(actorId);
  const reason = text(note, approve ? 'Approval note' : 'Rejection reason');
  const batch = await batchesCollection().findOne({ _id: String(batchId) });
  if (!batch) throw httpError(404, 'Batch not found');
  if (batch.status !== 'pending_approval') throw httpError(409, 'Only a batch waiting for approval can be reviewed');
  if (String(batch.operatorId) === String(actorId)) throw httpError(409, 'A different admin must review this batch');
  const update = approve ? { status: 'approved', reviewerId: new mongoose.Types.ObjectId(String(actorId)), approvalReference: `${batch._id}: ${reason}`, approvedAt: new Date() }
    : { status: 'rejected', rejectedBy: new mongoose.Types.ObjectId(String(actorId)), rejectionReason: reason, rejectedAt: new Date() };
  const result = await batchesCollection().updateOne({ _id: batch._id, status: 'pending_approval' }, { $set: update });
  if (!result.modifiedCount) throw httpError(409, 'Batch changed; reload');
  return { ...batch, ...update };
};

export const applyHistoricalBatch = async ({ batchId, actorId }) => {
  const batch = await batchesCollection().findOne({ _id: String(batchId) });
  if (!batch) throw httpError(404, 'Batch not found');
  return applyReviewedHistoricalBatch({ batchId: batch._id, actorId, approvalReference: batch.approvalReference || '' });
};

// Old orders are past their return window and refunds were checked during
// review, so applied earnings can be made available to pay in one step.
export const releaseHistoricalBatch = async ({ batchId, actorId }) => {
  requireFinanceOperation();
  await financeOperator(actorId);
  return financialTransaction(async session => {
    const batch = await batchesCollection().findOne({ _id: String(batchId) }, { session });
    if (!batch) throw httpError(404, 'Batch not found');
    if (batch.status === 'released') return { batchId: batch._id, alreadyProcessed: true };
    if (batch.status !== 'applied') throw httpError(409, 'Apply the batch before releasing it');
    for (const row of batch.rows) {
      const entry = await Ledger.findOne({ idempotencyKey: `${row.idempotencyKey}:NET`, account: 'seller_payable', bucket: 'held' }).session(session);
      if (!entry) throw httpError(409, `${row.orderNo}: applied earnings are missing`);
      await Seller.updateOne({ _id: row.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      for (const [bucket, direction] of [['held', 'debit'], ['eligible', 'credit']]) await postLedgerEntry({ idempotencyKey: `${row.idempotencyKey}:RELEASE:${bucket}`, sellerId: row.sellerId, orderId: row.orderId,
        account: 'seller_payable', type: 'adjustment', direction, bucket, amount: entry.amount, reference: batch._id, postedBy: actorId, postedByRole: 'admin',
        description: `Reviewed old-order earnings released ${row.orderNo}`, metadata: { source: 'historical-release-v1', batchId: batch._id, itemId: row.itemId, originalEntryId: String(entry._id) } }, { session });
    }
    await batchesCollection().updateOne({ _id: batch._id, status: 'applied' }, { $set: { status: 'released', releasedAt: new Date(), releasedBy: actorId } }, { session });
    return { batchId: batch._id, status: 'released' };
  });
};

// The apply step below is reached only through a batch that a second admin
// approved (reviewHistoricalBatch); it re-verifies the frozen evidence first.
// Presence of a proposed amount in an uploaded JSON file is never approval.
export const applyReviewedHistoricalBatch = async ({ batchId, actorId, approvalReference }) => {
  requireFinanceOperation();
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9:_-]{5,120}$/.test(batchId) || typeof approvalReference !== 'string' || approvalReference.trim().length < 5) throw httpError(400, 'Exact batch and approval references are required');
  const actor = await Admin.findById(actorId).lean();
  if (!actor?.isActive || (!actor.permissions?.includes('manage_finance') && actor.role !== 'superAdmin')) throw httpError(403, 'Finance operator required');
  return financialTransaction(async session => {
    const batches = mongoose.connection.collection('finance_historical_reviewed_batches');
    const batch = await batches.findOne({ _id: batchId }, { session });
    if (!batch || batch.approvalReference !== approvalReference || !approvalReference || !batch.operatorId || !batch.reviewerId || String(batch.operatorId) === String(batch.reviewerId)) throw httpError(409, 'Separately reviewed approval is missing');
    const reviewers = await Admin.find({ _id: { $in: [batch.operatorId, batch.reviewerId] }, isActive: true, $or: [{ permissions: 'manage_finance' }, { role: 'superAdmin' }] }).session(session).lean();
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
