import { historicalExceptions } from '../services/historicalFinance.service.js';
import mongoose from 'mongoose';
import Return from '../models/Return.js';
import { cumulativePaise } from '../utils/financeMoney.js';
import Commission from '../models/Commission.js';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { financeFlags } from '../services/financeSafety.service.js';
import { financialReconciliation } from '../services/financialReconciliation.service.js';
import { saveCommissionVersion } from '../services/vendorCommission.service.js';
import { recordCodEvent, postOrderFinance, releaseOrderFinance, releaseDeliveryEarning, reverseRefundedReturn } from '../services/orderFinance.service.js';

export const getCommissionConfiguration = asyncHandler(async (req, res) => {
  const rules = await Commission.find({ financeVersion: 2, channel: { $ne: 'legal' } }).sort({ createdAt: -1, _id: -1 }).limit(500).lean();
  return ok(res, { rules, flags: financeFlags(), historicalRulesApplied: false });
});
export const createCommissionConfiguration = asyncHandler(async (req, res) => ok(res, await saveCommissionVersion(req.body, req.user._id), 'Commission version saved; live financial operations use separate release gates'));

const filters = (req, rider = false) => {
  const match = { 'financialSnapshot.version': 2 };
  if (rider) match.deliveryPartnerId = req.partner._id;
  if (req.query.cod === 'true' || rider) match.paymentMethod = 'cod';
  if (req.query.status) {
    if (!['expected', 'collected', 'remittance_reported', 'verified', 'allocated', 'discrepancy', 'disputed'].includes(req.query.status)) throw httpError(400, 'Invalid COD status');
    match['codFinance.status'] = req.query.status;
    if (req.query.status === 'expected') {
      match.$or = [{ 'codFinance.status': 'expected' }, { codFinance: { $exists: false } }];
      delete match['codFinance.status'];
    }
  }
  if (req.query.q) match.orderNo = { $regex: String(req.query.q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (req.query.partnerId && !rider) {
    if (!mongoose.isValidObjectId(req.query.partnerId)) throw httpError(400, 'Invalid delivery partner');
    match.deliveryPartnerId = req.query.partnerId;
  }
  for (const [key, operator] of [['from', '$gte'], ['to', '$lte']]) {
    if (req.query[key]) {
      const date = new Date(req.query[key]);
      if (!Number.isFinite(date.getTime())) throw httpError(400, 'Invalid date filter');
      match.createdAt ||= {}; match.createdAt[operator] = date;
    }
  }
  return match;
};
const exceptionCodes = (order) => [
  ...(order.financialSnapshot.state === 'held_discount_policy' ? ['discount_funding_policy_missing'] : order.financialSnapshot.state !== 'configured' ? ['commission_rule_missing'] : []),
  ...(order.paymentMethod === 'cod' && !['verified', 'allocated'].includes(order.codFinance?.status) ? ['cod_unverified'] : []),
  ...(order.codFinance?.status === 'discrepancy' ? ['cash_discrepancy'] : []),
  ...(order.status === 'delivered' && !order.financialPosting ? ['allocation_not_posted'] : []),
];
const csv = value => {
  const str = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/.test(str) ? "'" + str : str).replaceAll('"', '""')}"`;
};

export const listFinanceOrders = asyncHandler(async (req, res) => {
  const rider = Boolean(req.partner);
  const match = filters(req, rider);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 25;
  const total = await Order.countDocuments(match);
  const exporting = req.query.export === 'csv';
  if (exporting && total > 5000) throw httpError(400, 'Narrow the date range to export at most 5000 records');
  const orders = await Order.find(match).select('_id orderNo status paymentMethod paymentId deliveryPartnerId deliveryId financialSnapshot financialPosting financialRevision financialOperationLog financialReturnQuantities codFinance createdAt')
    .sort({ createdAt: -1 }).skip(exporting ? 0 : (page - 1) * limit).limit(exporting ? 5000 : limit).lean();
  const rows = orders.map(order => ({ ...order, exceptions: exceptionCodes(order),
    ...(rider ? { financialSnapshot: { expectedPaise: order.financialSnapshot.expectedPaise }, financialReturnQuantities: undefined, paymentId: undefined } : {}),
    cash: { expectedPaise: order.financialSnapshot.expectedPaise,
      collectedPaise: order.codFinance?.collectedPaise || 0, reportedPaise: order.codFinance?.reportedPaise || 0,
      verifiedPaise: order.codFinance?.verifiedPaise || 0,
      outstandingPaise: Math.max(0, (order.codFinance?.collectedPaise || 0) - (order.codFinance?.verifiedPaise || 0)),
      status: order.codFinance?.status || 'expected' },
  }));
  if (exporting) {
    const header = ['Order', 'Created', 'Order status', 'Payment method', 'COD status', 'Expected paise', 'Collected paise', 'Reported paise', 'Verified paise', 'Outstanding paise', 'Allocation', 'Exceptions'];
    const lines = rows.map(row => [row.orderNo, row.createdAt.toISOString(), row.status, row.paymentMethod, row.cash.status,
      row.cash.expectedPaise, row.cash.collectedPaise, row.cash.reportedPaise, row.cash.verifiedPaise, row.cash.outstandingPaise, row.financialPosting || 'unposted', row.exceptions.join(';')]);
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="financial-orders.csv"');
    return res.send([header, ...lines].map(row => row.map(csv).join(',')).join('\r\n'));
  }
  return paginated(res, rows, { total, page, limit, flags: financeFlags() });
});

export const listFinanceLedger = asyncHandler(async (req, res) => {
  const match = req.partner ? { partnerId: req.partner._id, account: 'rider_payable' } : {advertisingCampaignId:{$exists:false}};
  if (req.query.account) {
    if(String(req.query.account).startsWith('advertising_'))throw httpError(403,'Use the dedicated advertising finance permissions and workspace');
    if (!SellerLedgerEntry.schema.path('account').enumValues.includes(req.query.account)) throw httpError(400, 'Invalid account');
    if (!req.partner) match.account = req.query.account;
  }
  if (req.query.orderId) {
    if (!mongoose.isValidObjectId(req.query.orderId)) throw httpError(400, 'Invalid order');
    match.orderId = new mongoose.Types.ObjectId(req.query.orderId);
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 50;
  const [rows, total, balances] = await Promise.all([
    SellerLedgerEntry.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SellerLedgerEntry.countDocuments(match),
    SellerLedgerEntry.aggregate([{ $match: match }, { $group: { _id: { account: { $ifNull: ['$account', 'seller_payable'] }, bucket: '$bucket' },
      amount: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] } }, count: { $sum: 1 } } }]),
  ]);
  return ok(res, { rows, balances, total, page, limit, flags: financeFlags() });
});

export const getDeliveryFinance = asyncHandler(async (req, res) => {
  const query = { partnerId: req.partner._id };
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 25;
  const [rows, total] = await Promise.all([
    Delivery.find(query).select('_id orderId status route.distanceKm ratesUsed partnerEarnings partnerTip financialEarningStatus endTime').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Delivery.countDocuments(query),
  ]);
  return paginated(res, rows, { page, limit, total, flags: financeFlags() });
});
export const collectCod = asyncHandler(async (req, res) => ok(res, await recordCodEvent({ orderId: req.params.id, partnerId: req.partner._id, actorId: req.user._id, action: 'collect', input: req.body })));
export const reportCodRemittance = asyncHandler(async (req, res) => ok(res, await recordCodEvent({ orderId: req.params.id, partnerId: req.partner._id, actorId: req.user._id, action: 'remit', input: req.body })));
export const verifyCodRemittance = asyncHandler(async (req, res) => ok(res, await recordCodEvent({ orderId: req.params.id, actorId: req.user._id, action: 'verify', input: reviewed(req) })));
export const disputeCod = asyncHandler(async (req, res) => ok(res, await recordCodEvent({ orderId: req.params.id, actorId: req.user._id, action: 'dispute', input: reviewed(req) })));
const reviewed = req => {
  if (!Number.isSafeInteger(req.body?.expectedRevision) || String(req.body?.reason || '').trim().length < 5 || String(req.body?.reference || '').trim().length < 4) throw httpError(400, 'Financial preview revision, evidence reference and reason are required');
  return req.body;
};
export const allocateOrder = asyncHandler(async (req, res) => ok(res, await postOrderFinance(req.params.id, req.user._id, reviewed(req))));
export const releaseOrder = asyncHandler(async (req, res) => ok(res, await releaseOrderFinance(req.params.id, req.user._id, reviewed(req))));
export const releaseRider = asyncHandler(async (req, res) => ok(res, await releaseDeliveryEarning(req.params.id, req.user._id, reviewed(req))));
export const reverseReturn = asyncHandler(async (req, res) => ok(res, await reverseRefundedReturn(req.params.id, req.user._id, reviewed(req))));
export const getFinancialExceptions = asyncHandler(async (req, res) => ok(res, await financialReconciliation({ page: Math.max(1, parseInt(req.query.page, 10) || 1) })));

export const getHistoricalExceptions = asyncHandler(async (req, res) => ok(res, await historicalExceptions({ page: req.query.page, limit: req.query.limit })));

export const previewRefundCompensation = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid return');
  const ret = await Return.findById(req.params.id).lean();
  const order = ret && await Order.findById(ret.orderId).lean();
  const line = order?.financialSnapshot?.lines?.find(row => row.itemId === String(ret.orderItemId));
  if (!line || !line.rule || !order.financialPosting || ret.status !== 'REFUNDED') throw httpError(409, 'Completed refund and original allocation are required');
  const before = order.financialReturnQuantities?.[line.itemId] || 0;
  const after = before + ret.quantity;
  const amount = value => cumulativePaise(value, after, line.qty) - cumulativePaise(value, before, line.qty);
  return ok(res, { returnId: ret._id, orderId: order._id, orderNo: order.orderNo, sellerId: line.sellerId, itemId: line.itemId, quantity: ret.quantity,
    currency: 'INR', expectedRevision: order.financialRevision || 0, policyVersion: line.rule.version,
    refundPaise: amount(line.eligiblePaise), commissionPaise: amount(line.commissionPaise), taxPaise: amount(line.taxPaise),
    sellerCompensationPaise: amount(line.eligiblePaise) - amount(line.commissionPaise) - amount(line.taxPaise),
    consequence: 'Append compensation entries; already transferred funds may become held debt. No customer refund is initiated.' });
});
