import { historicalExceptions, listHistoricalBatches, createHistoricalBatch, reviewHistoricalBatch, applyHistoricalBatch, releaseHistoricalBatch } from '../services/historicalFinance.service.js';
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
import { saveCommissionVersion, saveCommissionForAllChannels, describeCurrentCommissionRules } from '../services/vendorCommission.service.js';
import { recordCodEvent, postOrderFinance, releaseOrderFinance, releaseDeliveryEarning, reverseRefundedReturn, refundCompensation } from '../services/orderFinance.service.js';
import { getFinancePolicy, saveFinancePolicy } from '../services/financePolicy.service.js';
import { taxReport, journal, trialBalance, toCsv, rupees } from '../services/financeReports.service.js';
import SellerPayout from '../models/SellerPayout.js';
import { effectiveAccountExpr } from '../services/sellerLedger.service.js';
import { courierCostSummary, listCourierCosts, recordActualCourierCost, disputeCourierCost } from '../services/courierCost.service.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Seller from '../models/Seller.js';

export const getCommissionConfiguration = asyncHandler(async (req, res) => {
  // `rules` is the full change history; `current` is what new orders use.
  const [rules, { current, coverage }] = await Promise.all([
    Commission.find({ financeVersion: 2, channel: { $ne: 'legal' } }).sort({ createdAt: -1, _id: -1 }).limit(500).lean(),
    describeCurrentCommissionRules(),
  ]);
  return ok(res, { rules, current, coverage, flags: financeFlags(), historicalRulesApplied: false });
});
export const createCommissionConfiguration = asyncHandler(async (req, res) => req.body?.channel === 'all'
  ? ok(res, await saveCommissionForAllChannels(req.body, req.user._id), 'Commission saved for every channel; live financial operations use separate release gates')
  : ok(res, await saveCommissionVersion(req.body, req.user._id), 'Commission version saved; live financial operations use separate release gates'));

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
  ...(order.financeAutomation?.lastError ? ['needs_admin_review'] : []),
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
  const fields = '_id orderNo status paymentMethod paymentId deliveryPartnerId deliveryId financialSnapshot financialPosting financialRevision financialOperationLog financialReturnQuantities codFinance financeAutomation createdAt' + (rider ? '' : ' type salesChannel items._id items.name');
  const skip = exporting ? 0 : (page - 1) * limit, take = exporting ? 5000 : limit;
  // The admin COD list puts rider handover reports awaiting confirmation first,
  // then the latest cash activity; every other list stays newest order first.
  const codQueue = req.query.cod === 'true' && !rider;
  const orders = codQueue
    // Aggregation does not cast like find(), so the rider filter needs a real ObjectId.
    ? await Order.aggregate([{ $match: match.deliveryPartnerId ? { ...match, deliveryPartnerId: new mongoose.Types.ObjectId(String(match.deliveryPartnerId)) } : match },
      { $addFields: { codPriority: { $cond: [{ $eq: ['$codFinance.status', 'remittance_reported'] }, 0, 1] } } },
      { $sort: { codPriority: 1, 'codFinance.updatedAt': -1, createdAt: -1 } }, { $skip: skip }, { $limit: take },
      { $project: Object.fromEntries(fields.split(' ').map(field => [field, 1])) }])
    : await Order.find(match).select(fields).sort({ createdAt: -1 }).skip(skip).limit(take).lean();
  // Display names are resolved in batches, without changing frozen money records.
  const actors = new Map(), sellers = new Map();
  if (!rider && !exporting && orders.length) {
    const validIds = values => [...new Set(values.map(String).filter(value => mongoose.isValidObjectId(value)))];
    const actorIds = validIds(orders.flatMap(order => (order.codFinance?.events || []).map(event => event.actorId)));
    const sellerIds = validIds(orders.flatMap(order => (order.financialSnapshot?.lines || []).map(line => line.sellerId)));
    const [users, admins, stores] = await Promise.all([
      User.find({ _id: { $in: actorIds } }).select('name roles').lean(),
      Admin.find({ _id: { $in: actorIds } }).select('name').lean(),
      Seller.find({ _id: { $in: sellerIds } }).select('businessName storeDetails.name').lean(),
    ]);
    users.forEach(user => actors.set(String(user._id), { name: user.name, role: user.roles?.includes('delivery') ? 'Delivery partner' : 'Team member' }));
    admins.forEach(admin => actors.set(String(admin._id), { name: admin.name, role: 'Admin' }));
    stores.forEach(store => sellers.set(String(store._id), store.storeDetails?.name || store.businessName));
  }
  const rows = orders.map(({ items, ...order }) => ({ ...order, exceptions: exceptionCodes(order),
    ...(!rider && !exporting ? { display: {
      channel: order.salesChannel === 'wholesale' ? 'wholesale' : order.type === 'grocery' ? 'quick' : order.type,
      items: (order.financialSnapshot?.lines || []).map(line => ({ itemId: String(line.itemId), name: line.itemName || items?.find(item => String(item._id) === String(line.itemId))?.name || null, sellerName: sellers.get(String(line.sellerId)) || null })),
      actors: Object.fromEntries((order.codFinance?.events || []).map(event => [String(event.actorId), actors.get(String(event.actorId)) || null])),
    } } : {}),
    ...(rider ? { financialSnapshot: { expectedPaise: order.financialSnapshot.expectedPaise }, financialReturnQuantities: undefined, paymentId: undefined } : {}),
    cash: { expectedPaise: order.financialSnapshot.expectedPaise,
      collectedPaise: order.codFinance?.collectedPaise || 0, reportedPaise: order.codFinance?.reportedPaise || 0,
      verifiedPaise: order.codFinance?.verifiedPaise || 0,
      shortagePaise: order.codFinance?.shortagePaise || 0, writtenOffPaise: order.codFinance?.writtenOffPaise || 0,
      outstandingPaise: ['collected', 'remittance_reported'].includes(order.codFinance?.status) ? Math.max(0, (order.codFinance?.collectedPaise || 0) - (order.codFinance?.verifiedPaise || 0)) : 0,
      status: order.codFinance?.status || 'expected' },
    ...(rider ? { financeAutomation: undefined } : {}),
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
    SellerLedgerEntry.aggregate([{ $match: match }, { $group: { _id: { account: effectiveAccountExpr, bucket: '$bucket' },
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
export const writeOffCodShortage = asyncHandler(async (req, res) => ok(res, await recordCodEvent({ orderId: req.params.id, actorId: req.user._id, action: 'writeoff', input: reviewed(req) }), 'Shortage absorbed by Bulkimart'));
const reviewed = req => {
  if (!Number.isSafeInteger(req.body?.expectedRevision) || String(req.body?.reason || '').trim().length < 5 || String(req.body?.reference || '').trim().length < 4) throw httpError(400, 'Financial preview revision, evidence reference and reason are required');
  return req.body;
};
export const allocateOrder = asyncHandler(async (req, res) => ok(res, await postOrderFinance(req.params.id, req.user._id, reviewed(req))));
export const releaseOrder = asyncHandler(async (req, res) => ok(res, await releaseOrderFinance(req.params.id, req.user._id, reviewed(req))));
export const releaseRider = asyncHandler(async (req, res) => ok(res, await releaseDeliveryEarning(req.params.id, req.user._id, reviewed(req))));
export const reverseReturn = asyncHandler(async (req, res) => ok(res, await reverseRefundedReturn(req.params.id, req.user._id, reviewed(req))));
export const getFinancialExceptions = asyncHandler(async (req, res) => ok(res, await financialReconciliation({ page: Math.max(1, parseInt(req.query.page, 10) || 1) })));

export const getCourierCosts = asyncHandler(async (req, res) => {
  if (req.query.direction && !['forward', 'reverse'].includes(req.query.direction)) throw httpError(400, 'Invalid shipment direction');
  ok(res, { ...await listCourierCosts({ direction: req.query.direction || 'forward', page: Math.max(1, parseInt(req.query.page, 10) || 1) }), flags: financeFlags() });
});
export const recordCourierCost = asyncHandler(async (req, res) => ok(res, await recordActualCourierCost({ actorId: req.user._id, input: req.body || {} }), 'Provider courier charge recorded'));
export const disputeCourierCharge = asyncHandler(async (req, res) => ok(res, await disputeCourierCost({ actorId: req.user._id, input: req.body || {} }), 'Courier charge marked as disputed'));

export const getHistoricalBatches = asyncHandler(async (req, res) => ok(res, await listHistoricalBatches()));
export const postHistoricalBatch = asyncHandler(async (req, res) => ok(res, await createHistoricalBatch({ rows: req.body?.rows, note: req.body?.note, actorId: req.user._id }), 'Batch prepared; another admin must approve it'));
export const reviewHistoricalBatchRoute = asyncHandler(async (req, res) => ok(res, await reviewHistoricalBatch({ batchId: req.params.id, actorId: req.user._id, approve: req.body?.approve === true, note: req.body?.note })));
export const applyHistoricalBatchRoute = asyncHandler(async (req, res) => ok(res, await applyHistoricalBatch({ batchId: req.params.id, actorId: req.user._id }), 'Batch applied; earnings are on hold'));
export const releaseHistoricalBatchRoute = asyncHandler(async (req, res) => ok(res, await releaseHistoricalBatch({ batchId: req.params.id, actorId: req.user._id }), 'Earnings released'));

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
  const parts = refundCompensation(order.financialSnapshot, line, amount);
  return ok(res, { returnId: ret._id, orderId: order._id, orderNo: order.orderNo, sellerId: line.sellerId, itemId: line.itemId, quantity: ret.quantity,
    currency: 'INR', expectedRevision: order.financialRevision || 0, policyVersion: line.rule.version,
    refundPaise: amount(line.eligiblePaise), commissionPaise: parts.commissionPaise, taxPaise: parts.taxPaise,
    sellerCompensationPaise: parts.sellerPaise,
    consequence: 'Append compensation entries; already transferred funds may become held debt. No customer refund is initiated.' });
});

const sendCsv = (res, filename, csvText) => {
  res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csvText);
};
export const getTaxReport = asyncHandler(async (req, res) => {
  const report = await taxReport({ month: req.query.month });
  if (req.query.format !== 'csv') return ok(res, report);
  return sendCsv(res, `tcs-tds-${report.month}.csv`, toCsv(['Seller', 'GSTIN', 'PAN', 'Item sales incl. GST (INR)', 'Taxable value (INR)', 'TCS (INR)', 'TDS (INR)', 'Missing'],
    [...report.rows.map(row => [row.sellerName, row.gstin, row.pan, rupees(row.grossPaise), rupees(row.taxablePaise), rupees(row.tcsPaise), rupees(row.tdsPaise), row.missing.join(' ')]),
      ['Total', '', '', rupees(report.totals.grossPaise), rupees(report.totals.taxablePaise), rupees(report.totals.tcsPaise), rupees(report.totals.tdsPaise), '']]));
});
export const getAccountingJournal = asyncHandler(async (req, res) => {
  const result = await journal({ from: req.query.from, to: req.query.to });
  if (req.query.format !== 'csv') return ok(res, { ...result, lines: result.lines.slice(0, 500), totalLines: result.lines.length });
  return sendCsv(res, `journal-${req.query.from}-to-${req.query.to}.csv`, toCsv(['Date', 'Entry', 'Debit account', 'Credit account', 'Amount (INR)', 'Description', 'Reference', 'Order', 'Party'],
    result.lines.map(line => [new Date(line.date).toISOString(), line.entryNo, line.debit, line.credit, rupees(line.amountPaise), line.description, line.reference, line.orderId, line.party])));
});
export const getTrialBalance = asyncHandler(async (req, res) => {
  const result = await trialBalance({ from: req.query.from, to: req.query.to });
  if (req.query.format !== 'csv') return ok(res, result);
  return sendCsv(res, `trial-balance-${req.query.from}-to-${req.query.to}.csv`, toCsv(['Account', 'Debit (INR)', 'Credit (INR)', 'Balance (INR, debit +)'],
    [...result.rows.map(row => [row.account, rupees(row.debitPaise), rupees(row.creditPaise), rupees(row.balancePaise)]), ['Total', rupees(result.totals.debitPaise), rupees(result.totals.creditPaise), '']]));
});

export const getFinancePolicySettings = asyncHandler(async (req, res) => ok(res, { policy: await getFinancePolicy(), flags: financeFlags() }));
export const saveFinancePolicySettings = asyncHandler(async (req, res) => ok(res, { policy: await saveFinancePolicy(req.body, req.user._id), flags: financeFlags() }, 'Finance policy saved'));

// One read for the Finance Center home: what needs attention and where money stands.
export const getFinanceOverview = asyncHandler(async (req, res) => {
  const { sellerPayoutCoverage } = await import('../services/sellerPayoutCoverage.service.js');
  const v2 = { 'financialSnapshot.version': 2 };
  const count = filter => Order.countDocuments({ ...v2, ...filter });
  const snapshotFailed = await Order.countDocuments({ 'financialSnapshotError.message': { $exists: true } });
  const [cashToVerify, cashMismatch, cashWithRiders, cashOverdue, missingRule, waitingPayment, needsReview, onHold, sellerPayouts, riderPayouts, accounts, policy] = await Promise.all([
    count({ paymentMethod: 'cod', 'codFinance.status': 'remittance_reported' }),
    count({ paymentMethod: 'cod', 'codFinance.status': { $in: ['discrepancy', 'disputed'] } }),
    count({ paymentMethod: 'cod', 'codFinance.status': 'collected' }),
    // Collected but not handed over within a day: chase the rider.
    count({ paymentMethod: 'cod', 'codFinance.status': 'collected', 'codFinance.collectedAt': { $lt: new Date(Date.now() - 24 * 3600 * 1000) } }),
    count({ status: 'delivered', financialPosting: { $exists: false }, 'financialSnapshot.state': { $ne: 'configured' } }),
    count({ status: 'delivered', financialPosting: { $exists: false }, 'financialSnapshot.state': 'configured' }),
    count({ 'financeAutomation.lastError': { $exists: true } }),
    count({ financialPosting: 'held' }),
    SellerPayout.countDocuments({ status: 'PENDING' }),
    DeliveryPayout.countDocuments({ status: 'pending', financeVersion: 2 }),
    SellerLedgerEntry.aggregate([{ $match: { advertisingCampaignId: { $exists: false } } }, { $group: { _id: { account: effectiveAccountExpr, bucket: '$bucket', type: '$type' },
      paise: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, { $round: [{ $multiply: ['$amount', 100] }, 0] }, { $multiply: [{ $round: [{ $multiply: ['$amount', 100] }, 0] }, -1] }] } } } }]),
    getFinancePolicy(),
  ]);
  const total = (account, buckets, types) => accounts.filter(row => row._id.account === account && (!buckets || buckets.includes(row._id.bucket)) && (!types || types.includes(row._id.type))).reduce((sum, row) => sum + row.paise, 0);
  const courierCharged = -total('seller_courier_obligation', null, ['quick_freight_obligation', 'quick_service_fee', 'quick_fee_tax']);
  const courierPaid = total('seller_courier_obligation', null, ['quick_fee_payment']);
  const [courier, commission] = await Promise.all([courierCostSummary(), describeCurrentCommissionRules()]);
  return ok(res, {
    flags: financeFlags(),
    unpostedSellerSales: await sellerPayoutCoverage(),
    policy: { payoutSchedule: policy.payoutSchedule, payoutWeekday: policy.payoutWeekday, tcsRatePercent: policy.tcsRatePercent, tdsRatePercent: policy.tdsRatePercent,
      sellerMinPayout: policy.sellerMinPayout, riderMinPayout: policy.riderMinPayout, configured: policy.configured, bankVerificationConfigured: Boolean(policy.bankVerificationMethod) },
    // Configured only when a current, switched-on rule actually covers a channel.
    commissionRulesConfigured: commission.coverage.some(row => row.active),
    commissionCoverage: commission.coverage,
    todo: { snapshotFailed, cashToVerify, cashMismatch, cashWithRiders, cashOverdue, missingRule, waitingPayment, needsReview, onHold, sellerPayouts, riderPayouts },
    totalsPaise: {
      sellersOnHold: total('seller_payable', ['held']), sellersAvailable: total('seller_payable', ['eligible']), sellersRequested: total('seller_payable', ['reserved']), sellersPaid: total('seller_payable', ['settled']),
      ridersOnHold: total('rider_payable', ['held']), ridersAvailable: total('rider_payable', ['eligible']), ridersRequested: total('rider_payable', ['reserved']), ridersPaid: total('rider_payable', ['settled']),
      commission: total('commission_revenue'), commissionGst: total('tax_liability'), tcs: total('tcs_liability'), tds: total('tds_liability'),
      platformDiscounts: total('platform_discount_expense'), codShortages: total('cod_shortage_expense'), codCashWithRiders: total('cod_custody'),
      customerDelivery: total('customer_delivery'), sellerSameDayIncentives: total('seller_payable', null, ['same_day_incentive']),
      sellerCourierCharged: courierCharged, sellerCourierPaid: courierPaid, sellerCourierOutstanding: Math.max(0, courierCharged - courierPaid),
      courierCostActual: total('courier_expense'), courierCostEstimatedUnverified: courier.estimatedUnverifiedPaise,
    },
    courierCosts: { shipments: courier.shipments, actual: courier.actual, estimatedOnly: courier.estimatedOnly, disputed: courier.disputed },
  });
});
