import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { assertSellerSettlementClear } from '../services/sellerSettlementEligibility.service.js';
import SellerPayout from '../models/SellerPayout.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { getQuickCommerceConfig, saveQuickCommerceDraft } from '../services/quickCommerceFinance.service.js';
import { postLedgerEntry, sellerBalances } from '../services/sellerLedger.service.js';
import { requireFinanceOperation, financeFlags, financialTransaction } from '../services/financeSafety.service.js';

export const getQuickCommerceDeliveryConfigAdmin = asyncHandler(async (req, res) => {
  return ok(res, await getQuickCommerceConfig(), 'Quick Commerce third-party configuration');
});

export const listQuickShiprocketFeesAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = 25;
  const snapshotQuery = {};
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [orders, sellers] = await Promise.all([
      Order.find({ orderNo: { $regex: literal, $options: 'i' } }).select('_id').limit(200).lean(),
      Seller.find({ $or: [{ businessName: { $regex: literal, $options: 'i' } }, { 'storeDetails.name': { $regex: literal, $options: 'i' } }] }).select('_id').limit(200).lean(),
    ]);
    snapshotQuery.$or = [{ orderId: { $in: orders.map(row => row._id) } }, { sellerId: { $in: sellers.map(row => row._id) } }];
  }
  const match = { quickFeeSnapshotId: { $exists: true } };
  if (q) match.quickFeeSnapshotId = { $in: (await QuickCommerceFinancialSnapshot.find(snapshotQuery).select('_id').lean()).map(row => row._id) };
  if (['pending', 'paid', 'failed', 'refunded', 'partial_refund'].includes(req.query.status)) match.status = req.query.status;
  if (req.query.exceptions === 'true') match.$or = [{ 'gatewayAttempts.status': { $in: ['initializing', 'creation_unknown'] } }, { 'refundObligations.0': { $exists: true } }];
  const [rows, total] = await Promise.all([
    Payment.find(match).select('_id status amount paidAt createdAt gateway.orderId gateway.paymentId gatewayAttempts.status refundObligations.status quickFeeSnapshotId')
      .populate({ path: 'quickFeeSnapshotId', populate: [{ path: 'sellerId', select: 'businessName storeDetails.name' }, { path: 'orderId', select: 'orderNo shiprocket.status status' }] })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(match),
  ]);
  return paginated(res, rows, { page, limit, total });
});

export const updateQuickCommerceDeliveryConfigAdmin = asyncHandler(async (req, res) => {
  const config = await saveQuickCommerceDraft({ fee: req.body?.fee, enabled: req.body?.enabled, adminId: req.user._id, currency: req.body?.currency, effectiveAt: req.body?.effectiveAt, paymentRequired: req.body?.paymentRequired, revision: req.body?.revision });
  return ok(res, { ...(await getQuickCommerceConfig()), config }, 'Draft configuration saved; live activation remains disabled');
});

export const listSellerLedgerAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const query = {};
  if (mongoose.Types.ObjectId.isValid(req.query.sellerId)) query.sellerId = req.query.sellerId;
  if (req.query.bucket) query.bucket = req.query.bucket;
  if (req.query.type) query.type = req.query.type;
  const [rows, total] = await Promise.all([
    SellerLedgerEntry.find(query).populate('sellerId', 'businessName storeDetails.name').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    SellerLedgerEntry.countDocuments(query),
  ]);
  return paginated(res, rows, { page, limit, total });
});

export const getSellerBalancesAdmin = asyncHandler(async (req, res) => {
  const sellers = await Seller.find({ status: 'approved' }).select('businessName storeDetails.name bankDetails').lean();
  const rows = await Promise.all(sellers.map(async (seller) => ({
    sellerId: seller._id, businessName: seller.businessName,
    storeName: seller.storeDetails?.name || seller.businessName,
    bankDetails: seller.bankDetails || {}, balances: await sellerBalances(seller._id),
  })));
  return ok(res, { rows, coverage: { historicalOrdersIncluded: false, authoritativeFrom: 'seller-ledger-v1' } });
});

export const getOrderFinanceAdmin = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).select('_id orderNo groupRef type pricing fulfillment shiprocket financialSnapshot financialPosting codFinance').lean();
  if (!order) throw httpError(404, 'Order not found');
  const [snapshot, entries] = await Promise.all([
    QuickCommerceFinancialSnapshot.findOne({ orderId: order._id }).lean(),
    SellerLedgerEntry.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
  ]);
  return ok(res, { order, snapshot, entries });
});

export const listFinancialReconciliationAdmin = asyncHandler(async (req, res) => {
  const snapshots = await QuickCommerceFinancialSnapshot.find({
    $or: [
      { accountingStatus: { $in: ['pending', 'held'] } },
      { finalProviderFreight: { $exists: false } },
    ],
  }).sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, snapshots.map((snapshot) => ({
    ...snapshot,
    discrepancy: snapshot.finalProviderFreight == null ? 'Final provider freight not verified'
      : Number((snapshot.finalProviderFreight - snapshot.quotedCourierFreight).toFixed(2)),
    retryAllowed: false,
    reason: 'Automated reconciliation and provider cancellation are not approved',
  })));
});

export const listSellerPayoutsLedgerAdmin = asyncHandler(async (req, res) => {
  const flags = financeFlags();
  const enabled = flags.payouts && flags.policyApproved && flags.testsApproved;
  const payouts = await SellerPayout.find({}).populate('sellerId', 'businessName storeDetails.name bankDetails').sort({ createdAt: -1 }).lean();
  const rows = await Promise.all(payouts.map(async (payout) => {
    const reservation = await SellerLedgerEntry.findOne({
      payoutId: payout._id, type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount,
    }).select('_id').lean();
    return {
      ...payout, status: payout.status.toLowerCase(), payoutRef: payout.payoutNo,
      storeName: payout.sellerId?.storeDetails?.name || payout.sellerId?.businessName,
      bankAccount: payout.bankDetails, settlementEligible: Boolean(reservation) && enabled,
      settlementBlocker: !enabled ? 'Payout reconciliation disabled pending approval' : reservation ? null : 'No matching ledger reservation; legacy payout cannot be settled from the ledger',
    };
  }));
  return ok(res, rows);
});

export const settleSellerPayoutLedgerAdmin = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const reconciliationReason = String(req.body?.reason || '').trim();
  if (req.body?.verified !== true || reconciliationReason.length < 5) throw httpError(400, 'Verified bank transfer evidence and reconciliation reason are required');
  const transactionRef = String(req.body?.transactionRef || '').trim();
  if (transactionRef.length < 4) throw httpError(400, 'Confirmed bank transaction reference is required');
  const session = await mongoose.startSession();
  let payout;
  try {
    await session.withTransaction(async () => {
      payout = await SellerPayout.findOne({ _id: req.params.id, status: 'PENDING' }).session(session);
      if (!payout) {
        const existing = await SellerPayout.findById(req.params.id).session(session);
        if (existing?.status === 'APPROVED' && existing.transactionRef === transactionRef) { payout = existing; return; }
        throw httpError(409, 'Payout is not pending');
      }
      const reservation = await SellerLedgerEntry.findOne({
        payoutId: payout._id, type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount,
      }).session(session);
      if (!reservation) throw httpError(409, 'Payout has no matching ledger reservation and cannot be marked paid');
      await Seller.updateOne({ _id: payout.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const balances = await sellerBalances(payout.sellerId, { session });
      if (balances.held < 0) throw httpError(409, 'Seller refund debt requires reconciliation before payout');
      await assertSellerSettlementClear(payout.sellerId, session);
      const out = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:SETTLE_OUT`, sellerId: payout.sellerId, payoutId: payout._id,
        type: 'payout_settlement', direction: 'debit', bucket: 'reserved', amount: payout.amount,
        reference: transactionRef, description: `Payout ${payout.payoutNo} sent`, postedBy: req.user._id, postedByRole: 'admin',
      }, { session });
      const paid = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:SETTLED`, sellerId: payout.sellerId, payoutId: payout._id,
        type: 'payout_settlement', direction: 'credit', bucket: 'settled', amount: payout.amount,
        reference: transactionRef, description: `Payout ${payout.payoutNo} confirmed`, postedBy: req.user._id, postedByRole: 'admin',
      }, { session });
      payout.status = 'APPROVED'; payout.transactionRef = transactionRef;
      payout.reconciliationReason = reconciliationReason;
      payout.processedAt = new Date(); payout.processedBy = req.user._id;
      payout.ledgerEntryIds.push(out.entry._id, paid.entry._id);
      await payout.save({ session });
    });
  } finally { await session.endSession(); }
  return ok(res, payout, 'Payout settlement recorded');
});

export const rejectSellerPayoutLedgerAdmin = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw httpError(400, 'A rejection reason of 5–1000 characters is required');
  const payout = await financialTransaction(async session => {
    const payout = await SellerPayout.findById(req.params.id).session(session);
    if (!payout) throw httpError(404, 'Payout not found');
    if (payout.status === 'REJECTED') return payout;
    if (payout.status !== 'PENDING') throw httpError(409, 'Payout is already resolved');
    await Seller.updateOne({ _id: payout.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
    const reservation = await SellerLedgerEntry.findOne({ payoutId: payout._id, type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount }).session(session);
    if (!reservation) throw httpError(409, 'Matching seller payout reservation is missing');
    const entries = [];
    for (const [bucket, direction] of [['reserved','debit'],['eligible','credit']]) {
      const { entry } = await postLedgerEntry({ idempotencyKey: `PAYOUT:${payout._id}:REJECT:${bucket}`, sellerId: payout.sellerId, payoutId: payout._id,
        type: 'payout_reservation', direction, bucket, amount: payout.amount, reference: payout.payoutNo,
        description: `Payout rejected: ${reason}`, postedBy: req.user._id, postedByRole: 'admin' }, { session });
      entries.push(entry._id);
    }
    payout.status = 'REJECTED'; payout.rejectionReason = reason; payout.processedBy = req.user._id; payout.processedAt = new Date();
    payout.ledgerEntryIds.push(...entries); await payout.save({ session }); return payout;
  });
  return ok(res, payout, 'Payout rejected; reservation returned through compensating entries');
});
