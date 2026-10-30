import { itemGrossExpression, summarizeProductGst } from '../services/productGst.service.js';
import { payoutPublic } from '../services/payoutEvidence.service.js';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import SellerPayout from '../models/SellerPayout.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { sellerBalances } from '../services/sellerLedger.service.js';
import { requireFinanceOperation, financeFlags } from '../services/financeSafety.service.js';
import { getFinancePolicy } from '../services/financePolicy.service.js';
import { createSellerPayoutRequest } from '../services/sellerPayout.service.js';
import { sellerTaxStatement } from '../services/financeReports.service.js';
import { sellerOrderAmounts } from '../services/sellerOrderAmounts.service.js';
import { sellerDashboardMetrics } from '../services/sellerDashboard.service.js';
import { sellerHistoryPaymentStages } from '../services/orderPaymentEligibility.service.js';

// Sum of the GST frozen on this seller's own items at checkout; null when the order predates it.
const productGstOf = (items = [], sellerId) => {
  const own = items.filter(item => String(item.sellerId) === String(sellerId));
  if (!own.length || own.some(item => !Number.isSafeInteger(item.productTax?.gstPaise))) return null;
  return own.reduce((sum, item) => sum + item.productTax.gstPaise, 0) / 100;
};

const ownSeller = async (req) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  return seller;
};

export const getSellerFinanceSummary = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const [balances, payouts, sales, policy, metrics] = await Promise.all([
    sellerBalances(seller._id),
    SellerPayout.find({ sellerId: seller._id }).sort({ createdAt: -1 }).lean(),
    Order.aggregate([
      { $match: { status: 'delivered', 'items.sellerId': seller._id } },
      ...sellerHistoryPaymentStages(),
      { $project: { orderNo: 1, createdAt: 1, financialPosting: 1,
        pricing: 1, items: 1,
        paymentMethod: 1, cashState: '$codFinance.status', snapshotVersion: '$financialSnapshot.version', snapshotState: '$financialSnapshot.state',
        financialSnapshot: { version: '$financialSnapshot.version', lines: { $filter: { input: { $ifNull: ['$financialSnapshot.lines', []] }, as: 'line', cond: { $eq: ['$$line.sellerId', String(seller._id)] } } } },
        ownItems: { $filter: { input: '$items', as: 'item', cond: { $eq: ['$$item.sellerId', seller._id] } } } } },
      { $set: { grossAmount: { $sum: { $map: { input: '$ownItems', as: 'item', in: { $divide: [itemGrossExpression('$$item'), 100] } } } } } },
      { $facet: {
        totals: [{ $group: { _id: null, orderCount: { $sum: 1 }, grossAmount: { $sum: '$grossAmount' } } }],
        orders: [{ $sort: { createdAt: -1, _id: -1 } }, { $limit: 20 }, { $project: { ownItems: 0 } }],
      } },
    ]),
    getFinancePolicy(),
    sellerDashboardMetrics(seller._id, null),
  ]);
  const flags = financeFlags();
  return ok(res, {
    balances,
    salesMetrics: metrics.kpis,
    salesByChannel: metrics.byChannel,
    payouts: payouts.map(payoutPublic),
    deliveredSales: {
      orderCount: sales[0]?.totals[0]?.orderCount || 0,
      grossAmount: Number((sales[0]?.totals[0]?.grossAmount || 0).toFixed(2)),
      orders: (sales[0]?.orders || []).map(({ financialSnapshot, items, pricing, ...row }) => ({ ...row, sellerAmounts: sellerOrderAmounts({ financialSnapshot, items, pricing }, seller._id),
        // GST already inside this seller's item prices; shown for reference, never deducted.
        productGst: productGstOf(items, seller._id) })),
      limit: 20,
    },
    coverage: {
      authoritativeFrom: 'seller-ledger-v1',
      historicalOrdersIncluded: false,
      deliveredOrders: metrics.kpis.completedOrders,
      netEarningsCalculatedOrders: metrics.kpis.netEarningsCalculatedOrders,
      netEarningsPendingOrders: metrics.kpis.netEarningsPendingOrders,
      unpostedOrders: metrics.kpis.unpostedOrders,
      ledgerEntryCount: balances.ledgerEntryCount,
      note: 'Zero posted funds do not establish zero historical entitlement. Historical orders require original payment, COD custody and policy evidence; contact finance support with the order reference.',
    },
    payoutPolicy: { schedule: policy.payoutSchedule, weekday: policy.payoutWeekday, minimum: policy.sellerMinPayout },
    payoutActionsEnabled: balances.eligible > 0 && balances.eligible >= policy.sellerMinPayout && balances.held >= 0 && policy.payoutSchedule === 'on_request'
      && flags.payouts && flags.policyApproved && flags.testsApproved,
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
    .select('_id orderNo groupRef type pricing fulfillment shiprocket financialSnapshot productTax financialPosting items._id items.name').lean();
  if (!order) throw httpError(404, 'Order not found');
  const [snapshot, entries] = await Promise.all([
    QuickCommerceFinancialSnapshot.findOne({ orderId: order._id, sellerId: seller._id }).lean(),
    SellerLedgerEntry.find({ orderId: order._id, sellerId: seller._id }).sort({ createdAt: 1 }).lean(),
  ]);
  // The product name lets the seller read each line without matching item ids.
  const itemNames = new Map((order.items || []).map(item => [String(item._id), item.name]));
  const merchandise = order.financialSnapshot ? { ...order.financialSnapshot, lines: order.financialSnapshot.lines
    .filter(line => String(line.sellerId) === String(seller._id)).map(line => ({ ...line, itemName: itemNames.get(String(line.itemId)) || null })) } : null;
  return ok(res, { orderId: order._id, orderNo: order.orderNo, snapshot, merchandise, productTax: order.productTax ? summarizeProductGst(order.productTax.lines.filter(line => String(line.sellerId) === String(seller._id))) : null, financialPosting: order.financialPosting, entries });
});

// Monthly TCS/TDS withheld from this seller, for their own GST/income-tax filing.
export const getSellerTaxStatement = asyncHandler(async (req, res) => {
  const seller = await ownSeller(req);
  const [statement, policy] = await Promise.all([sellerTaxStatement({ sellerId: seller._id }), getFinancePolicy()]);
  return ok(res, { ...statement, gstin: seller.gstin || '', pan: seller.pan || '', tcsRatePercent: policy.tcsRatePercent, tdsRatePercent: policy.tdsRatePercent });
});

export const requestSellerPayout = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  const seller = await ownSeller(req);
  const { payout, alreadyProcessed } = await createSellerPayoutRequest({ sellerId: seller._id, userId: req.user._id, amount: Number(req.body?.amount),
    key: req.get('Idempotency-Key') || req.body?.idempotencyKey, requestedBy: req.user._id });
  return ok(res, payoutPublic(payout), alreadyProcessed ? 'Payout request already recorded' : 'Payout request created');
});
