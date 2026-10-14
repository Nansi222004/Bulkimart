import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import SellerPayout from '../models/SellerPayout.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { postLedgerEntry, sellerBalances } from '../services/sellerLedger.service.js';

const ownSeller = async (req) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  return seller;
};

export const getSellerFinanceSummary = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const [balances, payouts] = await Promise.all([
    sellerBalances(seller._id),
    SellerPayout.find({ sellerId: seller._id }).sort({ createdAt: -1 }).lean(),
  ]);
  return ok(res, {
    balances,
    payouts,
    coverage: {
      authoritativeFrom: 'seller-ledger-v1',
      historicalOrdersIncluded: false,
      note: 'Historical orders are not deducted or backfilled without separate approval.',
    },
    payoutActionsEnabled: balances.eligible > 0,
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
    .select('_id orderNo groupRef type pricing fulfillment shiprocket').lean();
  if (!order) throw httpError(404, 'Order not found');
  const [snapshot, entries] = await Promise.all([
    QuickCommerceFinancialSnapshot.findOne({ orderId: order._id, sellerId: seller._id }).lean(),
    SellerLedgerEntry.find({ orderId: order._id, sellerId: seller._id }).sort({ createdAt: 1 }).lean(),
  ]);
  return ok(res, { orderId: order._id, orderNo: order.orderNo, snapshot, entries });
});

export const requestSellerPayout = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const amount = Number(req.body?.amount);
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Payout amount must be positive');
  if (!idempotencyKey || idempotencyKey.length > 100) throw httpError(400, 'A valid Idempotency-Key is required');
  const existing = await SellerPayout.findOne({ idempotencyKey });
  if (existing) return ok(res, existing, 'Payout request already recorded');

  const session = await mongoose.startSession();
  let payout;
  try {
    await session.withTransaction(async () => {
      const balances = await sellerBalances(seller._id, { session });
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
