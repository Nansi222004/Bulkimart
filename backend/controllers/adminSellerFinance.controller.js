import crypto from 'node:crypto';
import { destinationFingerprint, payoutPublic, assertBeneficiaryReview, approvedBeneficiaryProcess } from '../services/payoutEvidence.service.js';
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
import { getFinancePolicy, BANK_VERIFICATION_PROCESS_ID } from '../services/financePolicy.service.js';
import { sellerDashboardMetrics } from '../services/sellerDashboard.service.js';
import { notifySeller, NOTIFICATION_EVENT } from '../services/notification.service.js';

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
  const query = { sellerId: { $exists: true }, advertisingCampaignId: { $exists: false } };
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
  const sellers = await Seller.find({ status: 'approved' }).select('businessName storeDetails.name').lean();
  const { sellerPayoutCoverage } = await import('../services/sellerPayoutCoverage.service.js');
  const coverage = new Map((await sellerPayoutCoverage(sellers.map(seller => seller._id))).map(row => [String(row.sellerId), row]));
  const rows = await Promise.all(sellers.map(async seller => {
    // The seller home, seller Earnings and Finance Center share one definition
    // of completed sales, payment eligibility and allocated customer discounts.
    const [balances, sales] = await Promise.all([sellerBalances(seller._id), sellerDashboardMetrics(seller._id, null)]);
    return { sellerId: seller._id, businessName: seller.businessName,
      storeName: seller.storeDetails?.name || seller.businessName, balances,
      salesMetrics: sales.kpis, salesByChannel: sales.byChannel,
      unpostedSales: coverage.get(String(seller._id)) || { orderCount: 0, grossPaise: 0, reasons: [] } };
  }));
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
  const { requireIndependentPayoutReviewer: requireIndependent } = await getFinancePolicy();
  const payouts = await SellerPayout.find({}).populate('sellerId', 'businessName storeDetails.name').sort({ createdAt: -1 }).lean();
  const rows = await Promise.all(payouts.map(async (payout) => {
    const reservation = await SellerLedgerEntry.findOne({
      payoutId: payout._id, sellerId: payout.sellerId?._id || payout.sellerId, account: 'seller_payable', currency: 'INR', type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount,
    }).select('_id').lean();
    let reviewBlocker = null, beneficiaryReviewRequired = !payout.beneficiaryVerification?.verifiedAt;
    try {
      assertBeneficiaryReview(payout, req.user._id, { requireIndependent });
      const process = await approvedBeneficiaryProcess(mongoose.connection, payout.beneficiaryVerification.approvalReference, null);
      if (process.version !== payout.beneficiaryVerification.processVersion) { reviewBlocker = 'Beneficiary process changed; reviewed evidence must be renewed'; beneficiaryReviewRequired = true; }
    } catch (error) { if (!error.status) throw error; reviewBlocker = error.message; }
    return {
      ...payoutPublic(payout), destinationFingerprint: destinationFingerprint(payout.bankDetails, false), status: payout.status.toLowerCase(), payoutRef: payout.payoutNo,
      storeName: payout.sellerId?.storeDetails?.name || payout.sellerId?.businessName,
      beneficiaryReviewRequired, settlementEligible: Boolean(reservation) && enabled && !reviewBlocker,
      settlementBlocker: !enabled ? 'Payout reconciliation disabled pending approval' : reviewBlocker ? reviewBlocker : reservation ? null : 'No matching ledger reservation; legacy payout cannot be settled from the ledger',
    };
  }));
  return ok(res, rows);
});

export const settleSellerPayoutLedgerAdmin = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const reconciliationReason = String(req.body?.reason || '').trim();
  if (req.body?.verified !== true || reconciliationReason.length < 5) throw httpError(400, 'Verified bank transfer evidence and reconciliation reason are required');
  const transactionRef = String(req.body?.transactionRef || '').trim();
  if (transactionRef.length < 4 || transactionRef.length > 200) throw httpError(400, 'Confirmed bank transaction reference is required');
  const { requireIndependentPayoutReviewer: requireIndependent } = await getFinancePolicy();
  const session = await mongoose.startSession();
  let payout;
  try {
    await session.withTransaction(async () => {
      payout = await SellerPayout.findOne({ _id: req.params.id, status: 'PENDING' }).session(session);
      if (!payout) {
        const existing = await SellerPayout.findById(req.params.id).session(session);
        if (existing?.status === 'APPROVED' && existing.transactionRef?.toUpperCase() === transactionRef.toUpperCase() && existing.reconciliationReason === reconciliationReason && String(existing.processedBy) === String(req.user._id)) { payout = existing; return; }
        throw httpError(409, 'Payout is not pending');
      }
      assertBeneficiaryReview(payout, req.user._id, { requireIndependent });
      const process = await approvedBeneficiaryProcess(mongoose.connection, payout.beneficiaryVerification.approvalReference, session);
      if (process.version !== payout.beneficiaryVerification.processVersion) throw httpError(409, 'Beneficiary verification process changed; renewed review is required');
      if ((payout.currency || 'INR') !== 'INR') throw httpError(409, 'Payout currency requires reconciliation');
      const normalizedRef = transactionRef.toUpperCase();
      const duplicate = await SellerPayout.aggregate([{ $match: { _id: { $ne: payout._id }, status: 'APPROVED' } }, { $match: { $expr: { $eq: [{ $toUpper: { $trim: { input: { $ifNull: ['$transactionRef', ''] } } } }, normalizedRef] } } }]).session(session);
      if (duplicate.length) throw httpError(409, 'Transfer reference already belongs to another payout');
      // Built-in _id uniqueness supplies the atomic cross-seller receipt claim;
      // no deployment-time secondary index creation is required.
      const receiptId = crypto.createHash('sha256').update(normalizedRef).digest('hex');
      const receipts = mongoose.connection.collection('seller_payout_receipts');
      const claimed = await receipts.findOne({ _id: receiptId }, { session });
      if (claimed && String(claimed.payoutId) !== String(payout._id)) throw httpError(409, 'Transfer reference already allocated');
      if (!claimed) await receipts.insertOne({ _id: receiptId, payoutId: payout._id, sellerId: payout.sellerId, amount: payout.amount, currency: payout.currency || 'INR', destinationFingerprint: destinationFingerprint(payout.bankDetails), actorId: req.user._id, at: new Date() }, { session });
      const reservation = await SellerLedgerEntry.findOne({
        payoutId: payout._id, sellerId: payout.sellerId?._id || payout.sellerId, account: 'seller_payable', currency: 'INR', type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount,
      }).session(session);
      if (!reservation) throw httpError(409, 'Payout has no matching ledger reservation and cannot be marked paid');
      await Seller.updateOne({ _id: payout.sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const balances = await sellerBalances(payout.sellerId, { session });
      if (balances.reserved < payout.amount) throw httpError(409, 'Reserved funds require reconciliation');
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

  if (payout?.status === 'APPROVED') {
    const amountText = `₹${Number(payout.amount).toFixed(2)}`;
    notifySeller(payout.sellerId, {
      event: NOTIFICATION_EVENT.PAYOUT_COMPLETED,
      title: 'Payout Processed',
      message: `Your payout of ${amountText} has been transferred to your bank account. Ref: ${transactionRef}.`,
      metadata: { payoutId: payout._id, transactionRef },
      route: '/seller/earnings',
    }).catch((err) => console.error('[NOTIFICATION] notifySeller (payout settled) failed:', err.message));
  }

  return ok(res, payoutPublic(payout), 'External transfer evidence reconciled; no transfer initiated by this application');
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
    const reservation = await SellerLedgerEntry.findOne({ payoutId: payout._id, sellerId: payout.sellerId, account: 'seller_payable', currency: 'INR', type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount: payout.amount }).session(session);
    if (!reservation) throw httpError(409, 'Matching seller payout reservation is missing');
    if ((await sellerBalances(payout.sellerId, { session })).reserved < payout.amount) throw httpError(409, 'Reserved funds require reconciliation');
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

  if (payout?.status === 'REJECTED') {
    const amountText = `₹${Number(payout.amount).toFixed(2)}`;
    notifySeller(payout.sellerId, {
      event: NOTIFICATION_EVENT.PAYOUT_REJECTED,
      title: 'Payout Request Rejected',
      message: `Your payout request for ${amountText} was not processed: ${reason}. The amount has been credited back to your balance.`,
      metadata: { payoutId: payout._id, reason },
      route: '/seller/earnings',
    }).catch((err) => console.error('[NOTIFICATION] notifySeller (payout rejected) failed:', err.message));
  }

  return ok(res, payoutPublic(payout), 'Payout rejected; reservation returned through compensating entries');
});

export const verifySellerPayoutBeneficiaryAdmin = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const { evidenceReference, reason, fingerprint } = req.body || {};
  // The bank-verification method saved in Finance Settings is the default process.
  const approvalReference = req.body?.approvalReference || BANK_VERIFICATION_PROCESS_ID;
  if (![evidenceReference, approvalReference, reason].every(value => typeof value === 'string' && value.trim().length >= 5 && value.length <= 500)) throw httpError(400, 'Approved verification process reference, ownership evidence and reason are required');
  const payout = await financialTransaction(async session => {
    const row = await SellerPayout.findById(req.params.id).session(session);
    if (!row || row.status !== 'PENDING') throw httpError(409, 'Pending payout is required');
    const process = await approvedBeneficiaryProcess(mongoose.connection, approvalReference, session);
    const actual = destinationFingerprint(row.bankDetails);
    if (fingerprint !== actual) throw httpError(409, 'Destination changed; refresh the review');
    if (row.beneficiaryVerification?.verifiedAt) {
      const old = row.beneficiaryVerification;
      if (old.processVersion === process.version && old.approvalReference === approvalReference) {
        if (old.fingerprint === actual && old.evidenceReference === evidenceReference && old.reason === reason && String(old.reviewedBy) === String(req.user._id)) return row;
        throw httpError(409, 'Beneficiary review already recorded; conflicting evidence requires investigation');
      }
      if (old.evidenceReference === evidenceReference) throw httpError(409, 'Renewed verification requires new ownership evidence');
      row.beneficiaryVerificationHistory ||= [];
      row.beneficiaryVerificationHistory.push(old.toObject?.() || old);
    }
    row.beneficiaryVerification = { processVersion: process.version, fingerprint: actual, reviewedBy: req.user._id, verifiedAt: new Date(), evidenceReference, approvalReference, reason };
    await row.save({ session }); return row;
  });
  return ok(res, payoutPublic(payout), 'Beneficiary review recorded; independent transfer reconciliation still required');
});
