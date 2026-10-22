import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import SellerPayout from '../models/SellerPayout.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { assertSellerSettlementClear } from '../services/sellerSettlementEligibility.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { postLedgerEntry, sellerBalances } from '../services/sellerLedger.service.js';
import { requireFinanceOperation, financeFlags } from '../services/financeSafety.service.js';
import { moneyPaise } from '../services/vendorCommission.service.js';

const ownSeller = async (req) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  return seller;
};

export const getSellerFinanceSummary = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const [balances, payouts, sales] = await Promise.all([
    sellerBalances(seller._id),
    SellerPayout.find({ sellerId: seller._id }).sort({ createdAt: -1 }).lean(),
    Order.aggregate([
      { $match: { status: 'delivered', 'items.sellerId': seller._id } },
      { $project: { orderNo: 1, createdAt: 1, financialPosting: 1,
        snapshotVersion: '$financialSnapshot.version', snapshotState: '$financialSnapshot.state',
        items: { $filter: { input: '$items', as: 'item', cond: { $eq: ['$$item.sellerId', seller._id] } } } } },
      { $set: { grossAmount: { $sum: { $map: { input: '$items', as: 'item', in: { $multiply: ['$$item.price', '$$item.qty'] } } } } } },
      { $facet: {
        totals: [{ $group: { _id: null, orderCount: { $sum: 1 }, grossAmount: { $sum: '$grossAmount' } } }],
        orders: [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 20 }, { $project: { items: 0 } }],
      } },
    ]),
  ]);
  return ok(res, {
    balances,
    payouts,
    deliveredSales: {
      orderCount: sales[0]?.totals[0]?.orderCount || 0,
      grossAmount: Number((sales[0]?.totals[0]?.grossAmount || 0).toFixed(2)),
      orders: sales[0]?.orders || [],
      limit: 20,
    },
    coverage: {
      authoritativeFrom: 'seller-ledger-v1',
      historicalOrdersIncluded: false,
      note: 'Historical orders are not deducted or backfilled without separate approval.',
    },
    payoutActionsEnabled: balances.eligible > 0 && balances.held >= 0 && financeFlags().payouts && financeFlags().policyApproved && financeFlags().testsApproved,
  }, 'Seller finance summary');
});

export const listSellerLedger = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const query = { sellerId: seller._id };
  if (req.query.bucket) query.bucket = req.query.bucket;
  if (req.query.type) query.type = req.query.type;
  const [rows, total] = await Promise.all([
    SellerLedgerEntry.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SellerLedgerEntry.countDocuments(query),
  ]);
  return paginated(res, rows, { page, limit, total });
});

export const getSellerOrderFinance = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const order = await Order.findOne({ _id: req.params.id, 'items.sellerId': seller._id })
    .select('_id orderNo groupRef type pricing fulfillment shiprocket financialSnapshot financialPosting').lean();
  if (!order) throw httpError(404, 'Order not found');
  const [snapshot, entries] = await Promise.all([
    QuickCommerceFinancialSnapshot.findOne({ orderId: order._id, sellerId: seller._id }).lean(),
    SellerLedgerEntry.find({ orderId: order._id, sellerId: seller._id }).sort({ createdAt: 1 }).lean(),
  ]);
  const merchandise = order.financialSnapshot ? { ...order.financialSnapshot, lines: order.financialSnapshot.lines.filter(line => String(line.sellerId) === String(seller._id)) } : null;
  return ok(res, { orderId: order._id, orderNo: order.orderNo, snapshot, merchandise, financialPosting: order.financialPosting, entries });
});

export const requestSellerPayout = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const seller = await ownSeller(req);
  const amount = Number(req.body?.amount);
  const submittedKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  const idempotencyKey = `SELLER:${seller._id}:${submittedKey}`;
  moneyPaise(amount);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Payout amount must be positive');
  if (!submittedKey || submittedKey.length > 100) throw httpError(400, 'A valid Idempotency-Key is required');
  const existing = await SellerPayout.findOne({ idempotencyKey });
  if (existing) {
    if (String(existing.sellerId) !== String(seller._id) || existing.amount !== amount) throw httpError(409, 'Payout key reused with different financial data');
    return ok(res, existing, 'Payout request already recorded');
  }

  const session = await mongoose.startSession();
  let payout;
  try {
    await session.withTransaction(async () => {
      await Seller.updateOne({ _id: seller._id }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const replay = await SellerPayout.findOne({ idempotencyKey }).session(session);
      if (replay) {
        if (replay.amount !== amount) throw httpError(409, 'Payout key reused with a different amount');
        payout = replay; return;
      }
      const balances = await sellerBalances(seller._id, { session });
      if (balances.held < 0) throw httpError(409, 'Outstanding seller adjustments require reconciliation');
      await assertSellerSettlementClear(seller._id, session);
      if (balances.eligible < amount) throw httpError(409, 'Insufficient settlement-eligible balance');
      await Seller.updateOne({ _id: seller._id }, { $inc: { financialLedgerVersion: 1 } }, { session });
      [payout] = await SellerPayout.create([{
        payoutNo: `PAY-${new mongoose.Types.ObjectId()}`,
        sellerId: seller._id, amount, status: 'PENDING', idempotencyKey,
        requestedBy: req.user._id, bankDetails: seller.bankDetails,
      }], { session });
      const reserveOut = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:ELIGIBLE`, sellerId: seller._id, payoutId: payout._id,
        type: 'payout_reservation', direction: 'debit', bucket: 'eligible', amount,
        reference: payout.payoutNo, description: `Reserved for payout ${payout.payoutNo}`,
      }, { session });
      const reserveIn = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:RESERVED`, sellerId: seller._id, payoutId: payout._id,
        type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount,
        reference: payout.payoutNo, description: `Reserved for payout ${payout.payoutNo}`,
      }, { session });
      payout.ledgerEntryIds = [reserveOut.entry._id, reserveIn.entry._id];
      await payout.save({ session });
    });
  } finally {
    await session.endSession();
  }
  return ok(res, payout, 'Payout request created');
});
