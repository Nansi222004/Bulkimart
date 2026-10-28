import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import SellerPayout from '../models/SellerPayout.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { ORDER_STATUSES } from '../constants/enums.js';
import { moneyPaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';
import { newMetric, addPostedCommission } from './adminDashboardMetrics.service.js';
import { riderCodCashBalances } from './riderCashEligibility.service.js';

/**
 * Admin Reports — read-only, period-scoped reports over the live collections.
 * Nothing here writes, posts, backfills or reconciles.
 *
 * Money: integer paise, validated with the same moneyPaise rule as the finance
 * dashboard. A figure containing an invalid stored amount is "incomplete" and
 * reports no total (its valid-record subtotal is shown separately), never a
 * silently partial number.
 * Time: business days in Asia/Kolkata; ranges are [first day 00:00 IST, day
 * after last day 00:00 IST). Every metric names the one timestamp it uses.
 */
export const TIMEZONE = 'Asia/Kolkata';
const IST_MS = 5.5 * 3600 * 1000, DAY_MS = 24 * 3600 * 1000, MAX_DAYS = 366;
const PRESETS = ['today', 'last7', 'last30', 'month', 'custom'];
const id = value => String(value ?? '');
const istDay = date => new Date(new Date(date).getTime() + IST_MS).toISOString().slice(0, 10);
const dayStart = day => new Date(`${day}T00:00:00+05:30`);
const addDays = (day, n) => istDay(dayStart(day).getTime() + n * DAY_MS);
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && istDay(dayStart(value)) === value;

// ---- query validation -------------------------------------------------------
const TABLES = {
  overview: { sorts: [], statuses: [] },
  customers: { sorts: ['spend', 'orders', 'completed', 'lastOrder', 'name'], statuses: ['all', 'completed', 'repeat', 'new'] },
  vendors: { sorts: ['sales', 'orders', 'commission', 'earnings', 'refunds', 'name'], statuses: ['all', 'approved', 'pending', 'under_review', 'incomplete', 'rejected', 'suspended'] },
  delivery: { sorts: ['delivered', 'assigned', 'successRate', 'cod', 'outstanding', 'name'], statuses: ['all', 'approved', 'pending', 'under_review', 'incomplete', 'rejected', 'suspended'] },
  orders: { sorts: ['placed', 'paid', 'admin', 'commission', 'seller', 'rider', 'refunds'], statuses: ['all', 'completed', 'open', 'cancelled'] },
};
const ALLOWED_KEYS = ['range', 'from', 'to', 'search', 'status', 'sort', 'dir', 'page', 'limit', 'report'];

export function resolveRange({ range = 'last30', from, to } = {}, now = Date.now()) {
  if (!PRESETS.includes(range)) throw httpError(400, 'Choose a supported date range');
  const today = istDay(now);
  let fromDay = today, toDay = today;
  if (range === 'last7') fromDay = addDays(today, -6);
  else if (range === 'last30') fromDay = addDays(today, -29);
  else if (range === 'month') fromDay = `${today.slice(0, 7)}-01`;
  else if (range === 'custom') {
    if (!isDay(from) || !isDay(to)) throw httpError(400, 'Choose a valid start and end date (YYYY-MM-DD)');
    if (to < from) throw httpError(400, 'The end date must be on or after the start date');
    if (to > today) throw httpError(400, 'The end date cannot be in the future');
    fromDay = from; toDay = to;
  }
  const days = Math.round((dayStart(toDay) - dayStart(fromDay)) / DAY_MS) + 1;
  if (days > MAX_DAYS) throw httpError(400, `Choose a range of at most ${MAX_DAYS} days`);
  return { preset: range, fromDay, toDay, from: dayStart(fromDay), to: dayStart(addDays(toDay, 1)), days: Array.from({ length: days }, (_, i) => addDays(fromDay, i)) };
}

export function parseReportQuery(report, query = {}, now = Date.now()) {
  const table = TABLES[report];
  if (!table) throw httpError(400, 'Unknown report');
  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED_KEYS.includes(key)) throw httpError(400, `Unsupported report parameter: ${key}`);
    if (typeof value !== 'string') throw httpError(400, `Invalid report parameter: ${key}`);
  }
  const page = query.page === undefined ? 1 : Number(query.page), limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw httpError(400, 'Invalid page');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Page size must be 1–100');
  const search = (query.search || '').trim();
  if (search.length > 80) throw httpError(400, 'Search must be at most 80 characters');
  const status = query.status || 'all', sort = query.sort || table.sorts[0], dir = query.dir || 'desc';
  if (table.statuses.length && !table.statuses.includes(status)) throw httpError(400, 'Unsupported status filter');
  if (table.sorts.length && !table.sorts.includes(sort)) throw httpError(400, 'Unsupported sort column');
  if (!['asc', 'desc'].includes(dir)) throw httpError(400, 'Sort direction must be asc or desc');
  return { range: resolveRange(query, now), search, status, sort, dir, page, limit };
}

// ---- shared helpers ---------------------------------------------------------
// A money measure: verified subtotal plus a count of records whose stored amount is invalid.
const measure = () => ({ subtotal: 0, invalid: 0 });
const addMoney = (m, value) => { try { m.subtotal += moneyPaise(value); return true; } catch { m.invalid++; return false; } };
const addPaise = (m, value) => { if (Number.isSafeInteger(value) && value >= 0) { m.subtotal += value; return true; } m.invalid++; return false; };
const result = (m, basis) => ({ amountPaise: m.invalid ? null : m.subtotal, status: m.invalid ? 'incomplete' : 'complete', verifiedSubtotalPaise: m.subtotal, invalidRecords: m.invalid, basis });
const linePaise = item => { const unit = moneyPaise(item.price); if (!Number.isSafeInteger(item.qty) || item.qty < 1) throw Error('Invalid quantity'); return unit * item.qty; };
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const maskPhone = phone => { const digits = String(phone || '').replace(/\D/g, ''); return digits.length >= 6 ? `${digits.slice(0, 2)}${'•'.repeat(digits.length - 4)}${digits.slice(-2)}` : ''; };

// Orders whose payment was ever secured: COD (cash at delivery), or a Payment that
// reached paid / partially or fully refunded. Abandoned and failed checkouts are
// not orders a customer placed and are excluded everywhere.
const securedOrderStages = () => [
  { $lookup: { from: Payment.collection.name, localField: 'paymentId', foreignField: '_id', pipeline: [{ $project: { status: 1 } }], as: '_pay' } },
  { $match: { $or: [{ paymentMethod: 'cod' }, { '_pay.status': { $in: ['paid', 'partial_refund', 'refunded'] } }] } },
  { $unset: '_pay' },
];
const placedOrders = (range, project) => Order.aggregate([
  { $match: { createdAt: { $gte: range.from, $lt: range.to } } }, ...securedOrderStages(), { $project: project },
]).allowDiskUse(true);
// Completed = status delivered; completion time = latest "delivered" timeline entry,
// else the latest item deliveredAt. Delivered orders with neither are unattributed.
const completedAtExpr = { $ifNull: [
  { $max: { $map: { input: { $filter: { input: { $ifNull: ['$timeline', []] }, cond: { $eq: ['$$this.status', 'delivered'] } } }, in: '$$this.timestamp' } } },
  { $max: '$items.deliveredAt' },
] };
const completedOrders = (range, project) => Order.aggregate([
  { $match: { status: 'delivered', $or: [{ timeline: { $elemMatch: { status: 'delivered', timestamp: { $gte: range.from, $lt: range.to } } } }, { 'items.deliveredAt': { $gte: range.from, $lt: range.to } }] } },
  ...securedOrderStages(),
  { $addFields: { _completedAt: completedAtExpr } },
  { $match: { _completedAt: { $gte: range.from, $lt: range.to } } },
  { $project: { ...project, _completedAt: 1 } },
]).allowDiskUse(true);
const unattributedCompleted = () => Order.countDocuments({ status: 'delivered', timeline: { $not: { $elemMatch: { status: 'delivered' } } }, 'items.deliveredAt': { $exists: false } });

// Completed refunds in the period. Item returns: Return REFUNDED by refundedAt
// (any refund method, incl. COD and wallet). Whole-order (cancellation) refunds:
// verified processed online refund obligations without a returnId, by verifiedAt,
// counted once per provider refund id. Pending refunds are reported separately.
const ORDER_PAYMENT_EXCLUSIONS = ['advertising', 'parcelDeliveryId', 'serviceApplicationId', 'quickFeeSnapshotId', 'subscriptionId', 'shgSubscriptionId', 'premiumMembershipId', 'sellerPromotionId', 'packagingOrderId'];
const orderPaymentMatch = () => ({ $or: [{ orderId: { $exists: true } }, { groupRef: { $exists: true } }], isWalletTopup: { $ne: true }, ...Object.fromEntries(ORDER_PAYMENT_EXCLUSIONS.map(key => [key, { $exists: false }])) });
async function completedRefunds(range) {
  const rows = [];
  const returns = await Return.find({ status: 'REFUNDED', refundedAt: { $gte: range.from, $lt: range.to } }).select('refundAmount refundedAt sellerId customerId orderId').lean();
  for (const ret of returns) rows.push({ source: 'return', at: ret.refundedAt, amount: ret.refundAmount, paise: null, sellerId: ret.sellerId, customerId: ret.customerId });
  const obligations = await Payment.aggregate([
    { $match: { ...orderPaymentMatch(), 'refundObligations.verifiedAt': { $gte: range.from, $lt: range.to } } },
    { $unwind: '$refundObligations' },
    { $match: { 'refundObligations.status': 'processed', 'refundObligations.returnId': { $exists: false }, 'refundObligations.verifiedAt': { $gte: range.from, $lt: range.to } } },
    { $project: { userId: 1, refund: '$refundObligations' } },
  ]);
  const seen = new Set();
  for (const row of obligations) {
    const key = row.refund.providerRefundId || `${row._id}:${row.refund._id}`;
    if (seen.has(key)) continue; seen.add(key);
    rows.push({ source: 'order', at: row.refund.verifiedAt, amount: null, paise: row.refund.currency === 'INR' ? row.refund.amountPaise : NaN, customerId: row.userId });
  }
  return rows;
}
const addRefund = (m, row) => row.source === 'return' ? addMoney(m, row.amount) : addPaise(m, row.paise);

// Seller earnings: the journal's own seller-payable earning rule (original earnings,
// same-day incentives, refund reversals, reviewed historical adjustments). Bucket
// moves (held→eligible releases) are paired adjustments and are excluded.
const earningMatch = range => ({ createdAt: { $gte: range.from, $lt: range.to }, orderId: { $exists: true },
  $and: [{ $or: [{ account: 'seller_payable' }, { account: { $exists: false } }] },
    { $or: [{ type: { $in: ['order_earning', 'reversal', 'same_day_incentive'] } }, { type: 'adjustment', 'metadata.source': 'historical-reviewed-v1' }] }] });
const signedPaise = entry => moneyPaise(entry.amount) * (entry.direction === 'credit' ? 1 : -1);
const commissionMetricResult = (metric, basis) => ({ amountPaise: metric.incompleteRecords ? null : metric.verifiedSubtotalPaise, status: metric.incompleteRecords ? 'incomplete' : 'complete',
  verifiedSubtotalPaise: metric.verifiedSubtotalPaise, invalidRecords: metric.incompleteRecords, excludedRecords: metric.excludedRecords, basis });

const page = (rows, { page: number, limit }) => ({ rows: rows.slice((number - 1) * limit, number * limit), meta: { page: number, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } });
const sorter = (key, dir) => (a, b) => {
  const x = a[key], y = b[key];
  const order = typeof x === 'string' || typeof y === 'string' ? String(x ?? '').localeCompare(String(y ?? '')) : (x ?? -Infinity) - (y ?? -Infinity);
  return (dir === 'asc' ? order : -order) || String(a.id).localeCompare(String(b.id));
};
const envelope = (report, range, body) => ({ version: 1, report, currency: 'INR', unit: 'paise', timezone: TIMEZONE, asOf: new Date().toISOString(),
  range: { preset: range.preset, from: range.fromDay, to: range.toDay, days: range.days.length }, ...body });

// ---- Platform Overview ------------------------------------------------------
export async function overviewReport({ range }) {
  const series = new Map(range.days.map(day => [day, { day, ordersPlaced: 0, orderValuePaise: 0, completedOrders: 0, completedSalesPaise: 0, refundsPaise: 0, refundCount: 0 }]));
  const gross = measure(), cancelled = measure(), completed = measure(), refunds = measure(), captured = measure(), cod = measure();
  const statuses = new Map(), customers = new Set(), sellers = new Set(), vendors = new Map();
  let totalOrders = 0, cancelledOrders = 0, completedCount = 0;
  for await (const order of placedOrders(range, { status: 1, userId: 1, createdAt: 1, 'pricing.totalAmount': 1, 'items.sellerId': 1 }).cursor()) {
    totalOrders++;
    const status = ORDER_STATUSES.includes(order.status) ? order.status : 'unknown';
    statuses.set(status, (statuses.get(status) || 0) + 1);
    customers.add(id(order.userId));
    for (const item of order.items || []) if (item.sellerId) sellers.add(id(item.sellerId));
    const point = series.get(istDay(order.createdAt)); point.ordersPlaced++;
    if (addMoney(gross, order.pricing?.totalAmount)) point.orderValuePaise += moneyPaise(order.pricing.totalAmount);
    if (order.status === 'cancelled') { cancelledOrders++; addMoney(cancelled, order.pricing?.totalAmount); }
  }
  for await (const order of completedOrders(range, { 'pricing.totalAmount': 1, items: { sellerId: 1, price: 1, qty: 1 } }).cursor()) {
    completedCount++;
    const point = series.get(istDay(order._completedAt)); point.completedOrders++;
    if (addMoney(completed, order.pricing?.totalAmount)) point.completedSalesPaise += moneyPaise(order.pricing.totalAmount);
    // Merchandise by seller: each item line once (price × qty), so a
    // multi-seller order is split between sellers, never counted twice.
    const orderSellers = new Set();
    for (const item of order.items || []) {
      const key = id(item.sellerId) || 'unattributed';
      const row = vendors.get(key) || { sellerId: key, merchandise: measure(), orders: 0 };
      try { row.merchandise.subtotal += linePaise(item); } catch { row.merchandise.invalid++; }
      if (!orderSellers.has(key)) { row.orders++; orderSellers.add(key); }
      vendors.set(key, row);
    }
  }
  const refundRows = await completedRefunds(range);
  for (const row of refundRows) {
    if (addRefund(refunds, row)) { const point = series.get(istDay(row.at)); point.refundsPaise += row.source === 'return' ? moneyPaise(row.amount) : row.paise; point.refundCount++; }
  }
  const pending = await Return.aggregate([{ $match: { status: 'REFUND_PENDING' } }, { $project: { refundAmount: 1 } }]);
  const pendingRefunds = measure(); for (const row of pending) addMoney(pendingRefunds, row.refundAmount);
  const commission = newMetric();
  for await (const entry of Ledger.find({ account: 'commission_revenue', createdAt: { $gte: range.from, $lt: range.to } }).select('amount currency direction type metadata serviceApplicationId').lean().cursor()) addPostedCommission(commission, entry);
  const earnings = measure();
  for await (const entry of Ledger.find(earningMatch(range)).select('amount direction').lean().cursor()) {
    try { earnings.subtotal += signedPaise(entry); } catch { earnings.invalid++; }
  }
  // Payments received: settled online captures by receivedAt (once per gateway
  // payment id) and COD cash independently verified by its verify event time.
  const captures = await Payment.aggregate([{ $match: { ...orderPaymentMatch(), method: 'online', 'captures.receivedAt': { $gte: range.from, $lt: range.to } } }, { $unwind: '$captures' },
    { $match: { 'captures.disposition': 'settled', 'captures.receivedAt': { $gte: range.from, $lt: range.to } } }, { $project: { capture: '$captures' } }]);
  const seenCaptures = new Set();
  for (const row of captures) { if (seenCaptures.has(row.capture.gatewayPaymentId)) continue; seenCaptures.add(row.capture.gatewayPaymentId); addPaise(captured, row.capture.currency === 'INR' ? row.capture.amountPaise : NaN); }
  for await (const order of Order.find({ paymentMethod: 'cod', 'codFinance.events': { $elemMatch: { action: 'verify', at: { $gte: range.from, $lt: range.to } } } }).select('codFinance.events.action codFinance.events.at codFinance.verifiedPaise').lean().cursor()) {
    const last = order.codFinance.events.filter(event => event.action === 'verify').at(-1);
    if (last && last.at >= range.from && last.at < range.to) addPaise(cod, order.codFinance.verifiedPaise);
  }
  const deliveries = await Delivery.aggregate([{ $match: { endTime: { $gte: range.from, $lt: range.to }, status: { $in: ['delivered', 'failed'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const delivered = deliveries.find(row => row._id === 'delivered')?.count || 0, failed = deliveries.find(row => row._id === 'failed')?.count || 0;
  const completedSales = result(completed, 'Completed orders: saved order total (incl. delivery, tip, donation; after checkout discounts) of orders delivered in the period, by delivery time.');
  const refundResult = { ...result(refunds, 'Completed refunds in the period: item return refunds by refund time, plus verified whole-order online refunds by verification time.'), count: refundRows.length };
  const netSales = completedSales.amountPaise === null || refundResult.amountPaise === null ? null : completedSales.amountPaise - refundResult.amountPaise;
  const sellerNames = await Seller.find({ _id: { $in: [...vendors.keys()].filter(key => mongoose.isValidObjectId(key)) } }).select('businessName storeDetails.name').lean();
  const names = new Map(sellerNames.map(seller => [id(seller._id), seller.storeDetails?.name || seller.businessName || 'Unnamed seller']));
  const vendorRows = [...vendors.values()].map(row => ({ sellerId: row.sellerId, name: names.get(row.sellerId) || (row.sellerId === 'unattributed' ? 'Unattributed items' : 'Removed seller'), orders: row.orders,
    merchandisePaise: row.merchandise.invalid ? null : row.merchandise.subtotal, status: row.merchandise.invalid ? 'incomplete' : 'complete' }))
    .sort((a, b) => (b.merchandisePaise ?? -1) - (a.merchandisePaise ?? -1) || a.name.localeCompare(b.name)).slice(0, 10);
  return envelope('overview', range, {
    kpis: {
      grossOrderValue: result(gross, 'Saved order total of every order placed in the period (by order time) whose payment was secured — COD, or online paid/refunded. Includes orders later cancelled.'),
      cancelledOrderValue: result(cancelled, 'Part of gross order value whose orders are now cancelled.'),
      completedSales,
      refunds: refundResult,
      netSales: { amountPaise: netSales, status: netSales === null ? 'incomplete' : 'complete', basis: 'Completed sales minus completed refunds, both in the period. Refunds may relate to orders completed earlier.' },
      averageOrderValue: { amountPaise: completedSales.amountPaise === null || !completedCount ? null : Math.round(completedSales.amountPaise / completedCount), status: completedSales.amountPaise === null ? 'incomplete' : 'complete', basis: 'Completed sales ÷ completed orders.' },
      platformCommission: commissionMetricResult(commission, 'Net merchandise commission posted to the ledger in the period (posting time), after posted reversals. Not total platform revenue; taxes and seller payables excluded.'),
      sellerEarnings: result(earnings, 'Net seller earnings posted in the period (posting time): order earnings and incentives minus refund reversals. Not payouts.'),
      paymentsCaptured: result(captured, 'Settled online order payment captures received in the period, once per gateway payment. Wallet, advertising, parcel and other payments excluded.'),
      codVerified: result(cod, 'COD cash independently verified by finance in the period (verification time).'),
      pendingRefunds: { ...result(pendingRefunds, 'Return refunds currently awaiting payout (current state, not period-bound). Not counted as refunded.'), count: pending.length },
    },
    counts: { totalOrders, cancelledOrders, completedOrders: completedCount, activeCustomers: customers.size, activeSellers: sellers.size,
      deliveriesCompleted: delivered, deliveriesFailed: failed, deliverySuccessRate: delivered + failed ? delivered / (delivered + failed) : null },
    series: [...series.values()],
    statuses: [...statuses.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    vendors: vendorRows,
    disclosures: { unattributedCompletedOrders: await unattributedCompleted() },
  });
}

// ---- Consumer Users ---------------------------------------------------------
export async function customersReport(params, { all = false } = {}) {
  const { range } = params;
  const buyer = { roles: 'buyer' };
  const [registered, newcomers] = await Promise.all([User.countDocuments(buyer), User.find({ ...buyer, createdAt: { $gte: range.from, $lt: range.to } }).select('createdAt').lean()]);
  const series = new Map(range.days.map(day => [day, { day, registrations: 0, activeCustomers: 0 }]));
  for (const user of newcomers) series.get(istDay(user.createdAt)).registrations++;
  const rows = new Map(), activeByDay = new Map(range.days.map(day => [day, new Set()]));
  const row = key => { if (!rows.has(key)) rows.set(key, { id: key, ordersPlaced: 0, completedOrders: 0, spend: measure(), lastOrderAt: null }); return rows.get(key); };
  for await (const order of placedOrders(range, { userId: 1, createdAt: 1 }).cursor()) {
    const r = row(id(order.userId)); r.ordersPlaced++;
    if (!r.lastOrderAt || order.createdAt > r.lastOrderAt) r.lastOrderAt = order.createdAt;
    activeByDay.get(istDay(order.createdAt)).add(id(order.userId));
  }
  for await (const order of completedOrders(range, { userId: 1, 'pricing.totalAmount': 1 }).cursor()) { const r = row(id(order.userId)); r.completedOrders++; addMoney(r.spend, order.pricing?.totalAmount); }
  for (const [day, set] of activeByDay) series.get(day).activeCustomers = set.size;
  const users = await User.find({ _id: { $in: [...rows.keys()].filter(key => mongoose.isValidObjectId(key)) } }).select('name phone createdAt isActive').lean();
  const info = new Map(users.map(user => [id(user._id), user]));
  const newIds = new Set(newcomers.map(user => id(user._id)));
  let list = [...rows.values()].map(r => {
    const user = info.get(r.id) || {};
    return { id: r.id, name: user.name || 'Unnamed customer', phone: maskPhone(user.phone), registeredAt: user.createdAt || null, active: user.isActive !== false,
      ordersPlaced: r.ordersPlaced, completedOrders: r.completedOrders, spendPaise: r.spend.invalid ? null : r.spend.subtotal, spendStatus: r.spend.invalid ? 'incomplete' : 'complete',
      lastOrderAt: r.lastOrderAt, isNew: newIds.has(r.id), _phone: String(user.phone || '') };
  });
  const totals = { registeredCustomers: registered, newRegistrations: newcomers.length, activeCustomers: list.filter(r => r.ordersPlaced > 0).length,
    customersWithCompletedOrders: list.filter(r => r.completedOrders > 0).length, repeatCustomers: list.filter(r => r.ordersPlaced >= 2).length };
  if (params.status === 'completed') list = list.filter(r => r.completedOrders > 0);
  if (params.status === 'repeat') list = list.filter(r => r.ordersPlaced >= 2);
  if (params.status === 'new') list = list.filter(r => r.isNew);
  if (params.search) { const rx = new RegExp(escapeRegex(params.search), 'i'), digits = params.search.replace(/\D/g, ''); list = list.filter(r => rx.test(r.name) || (digits.length >= 4 && r._phone.includes(digits))); }
  const key = { spend: 'spendPaise', orders: 'ordersPlaced', completed: 'completedOrders', lastOrder: 'lastOrderAt', name: 'name' }[params.sort];
  list.sort(sorter(key, params.dir));
  list = list.map(({ _phone, ...rest }) => rest);
  const table = all ? { rows: list, meta: { page: 1, limit: list.length, total: list.length, pages: 1 } } : page(list, params);
  return envelope('customers', range, { totals, series: [...series.values()], ...table,
    definitions: { activeCustomer: 'A customer with at least one order placed in the period whose payment was secured (COD, or online paid/refunded).', repeatCustomer: 'An active customer with two or more such orders in the period.',
      spend: 'Saved order totals of the customer’s orders delivered in the period (before later refunds).' } });
}

// ---- General Vendors --------------------------------------------------------
export async function vendorsReport(params, { all = false } = {}) {
  const { range } = params;
  const stats = new Map();
  const stat = key => { if (!stats.has(key)) stats.set(key, { ordersPlaced: 0, completedOrders: 0, sales: measure(), refunds: measure(), commission: newMetric(), earnings: measure(), paid: measure(), pending: measure() }); return stats.get(key); };
  for await (const order of placedOrders(range, { 'items.sellerId': 1 }).cursor()) for (const key of new Set((order.items || []).map(item => id(item.sellerId)).filter(Boolean))) stat(key).ordersPlaced++;
  const products = new Map();
  for await (const order of completedOrders(range, { items: { sellerId: 1, productId: 1, name: 1, price: 1, qty: 1 } }).cursor()) {
    const counted = new Set();
    for (const item of order.items || []) {
      const key = id(item.sellerId); if (!key) continue;
      const s = stat(key); if (!counted.has(key)) { s.completedOrders++; counted.add(key); }
      let line = null; try { line = linePaise(item); s.sales.subtotal += line; } catch { s.sales.invalid++; }
      const product = products.get(id(item.productId)) || { productId: id(item.productId), name: item.name || 'Unnamed product', sellerId: key, units: 0, sales: measure() };
      product.units += Number.isSafeInteger(item.qty) ? item.qty : 0; if (line === null) product.sales.invalid++; else product.sales.subtotal += line;
      products.set(product.productId, product);
    }
  }
  for (const ret of await Return.find({ status: 'REFUNDED', refundedAt: { $gte: range.from, $lt: range.to }, sellerId: { $exists: true } }).select('sellerId refundAmount').lean()) addMoney(stat(id(ret.sellerId)).refunds, ret.refundAmount);
  for await (const entry of Ledger.find({ account: 'commission_revenue', sellerId: { $exists: true }, createdAt: { $gte: range.from, $lt: range.to } }).select('sellerId amount currency direction type metadata serviceApplicationId').lean().cursor()) addPostedCommission(stat(id(entry.sellerId)).commission, entry);
  for await (const entry of Ledger.find({ ...earningMatch(range), sellerId: { $exists: true } }).select('sellerId amount direction').lean().cursor()) { const s = stat(id(entry.sellerId)); try { s.earnings.subtotal += signedPaise(entry); } catch { s.earnings.invalid++; } }
  for (const payout of await SellerPayout.find({ status: 'APPROVED', processedAt: { $gte: range.from, $lt: range.to } }).select('sellerId amount').lean()) addMoney(stat(id(payout.sellerId)).paid, payout.amount);
  for (const payout of await SellerPayout.find({ status: 'PENDING' }).select('sellerId amount').lean()) addMoney(stat(id(payout.sellerId)).pending, payout.amount);
  const filter = params.status && params.status !== 'all' ? { status: params.status } : {};
  if (params.search) { const rx = new RegExp(escapeRegex(params.search), 'i'); filter.$or = [{ businessName: rx }, { 'storeDetails.name': rx }]; }
  const [sellers, totalVendors, activeVendors] = await Promise.all([Seller.find(filter).select('businessName storeDetails.name status createdAt').lean(), Seller.countDocuments({}), Seller.countDocuments({ status: 'approved' })]);
  const money = m => m.invalid ? null : m.subtotal;
  let list = sellers.map(seller => {
    const s = stats.get(id(seller._id)) || stat(id(seller._id));
    return { id: id(seller._id), name: seller.storeDetails?.name || seller.businessName || 'Unnamed seller', status: seller.status || 'incomplete',
      ordersPlaced: s.ordersPlaced, completedOrders: s.completedOrders, salesPaise: money(s.sales), refundsPaise: money(s.refunds),
      commissionPaise: s.commission.incompleteRecords ? null : s.commission.verifiedSubtotalPaise, earningsPaise: money(s.earnings),
      settlementsPaidPaise: money(s.paid), settlementsPendingPaise: money(s.pending),
      incomplete: Boolean(s.sales.invalid || s.refunds.invalid || s.commission.incompleteRecords || s.earnings.invalid || s.paid.invalid || s.pending.invalid) };
  });
  const sum = key => list.some(row => row[key] === null) ? null : list.reduce((total, row) => total + row[key], 0);
  const scope = filter.$or || filter.status ? 'filtered vendors' : 'all vendors';
  const totals = { totalVendors, activeVendors, vendorsWithSales: list.filter(row => row.completedOrders > 0).length, scope,
    salesPaise: sum('salesPaise'), refundsPaise: sum('refundsPaise'), commissionPaise: sum('commissionPaise'), earningsPaise: sum('earningsPaise'), settlementsPaidPaise: sum('settlementsPaidPaise'), settlementsPendingPaise: sum('settlementsPendingPaise') };
  const key = { sales: 'salesPaise', orders: 'ordersPlaced', commission: 'commissionPaise', earnings: 'earningsPaise', refunds: 'refundsPaise', name: 'name' }[params.sort];
  list.sort(sorter(key, params.dir));
  const names = new Map(list.map(row => [row.id, row.name]));
  const topProducts = [...products.values()].map(p => ({ productId: p.productId, name: p.name, seller: names.get(p.sellerId) || 'Seller', units: p.units, salesPaise: p.sales.invalid ? null : p.sales.subtotal }))
    .sort((a, b) => (b.salesPaise ?? -1) - (a.salesPaise ?? -1) || b.units - a.units).slice(0, 10);
  const table = all ? { rows: list, meta: { page: 1, limit: list.length, total: list.length, pages: 1 } } : page(list, params);
  return envelope('vendors', range, { totals, topProducts, ...table, definitions: {
    sales: 'Merchandise value (price × quantity of each item line) of the vendor’s items in orders delivered in the period. A multi-vendor order is split by item, never double counted.',
    refunds: 'Item return refunds completed in the period (refund time).', commission: 'Net commission posted to the ledger for the vendor in the period.',
    earnings: 'Net seller earnings posted in the period, after refund reversals.', settlementsPaid: 'Approved payouts processed in the period.', settlementsPending: 'Payout requests currently awaiting processing (current state).' } });
}

// ---- Delivery Fleet ---------------------------------------------------------
export async function deliveryReport(params, { all = false } = {}) {
  const { range } = params;
  const stats = new Map();
  const stat = key => { if (!stats.has(key)) stats.set(key, { assigned: 0, delivered: 0, failed: 0, rejected: 0, inProgress: 0, durations: [], earnings: measure(), cod: measure() }); return stats.get(key); };
  const totals = { assigned: 0, delivered: 0, failed: 0, rejected: 0, inProgress: 0, forward: 0, returnPickups: 0 };
  const durations = [];
  for await (const trip of Delivery.find({ createdAt: { $gte: range.from, $lt: range.to } }).select('partnerId status direction startTime endTime partnerEarnings').lean().cursor()) {
    const s = stat(id(trip.partnerId)); s.assigned++; totals.assigned++;
    if (trip.direction === 'return_pickup') totals.returnPickups++; else totals.forward++;
    if (trip.status === 'delivered') {
      s.delivered++; totals.delivered++;
      if (trip.startTime && trip.endTime && trip.endTime > trip.startTime) { const minutes = (trip.endTime - trip.startTime) / 60000; s.durations.push(minutes); durations.push(minutes); }
      if (trip.partnerEarnings != null) addMoney(s.earnings, trip.partnerEarnings);
    } else if (trip.status === 'failed') { s.failed++; totals.failed++; } else if (trip.status === 'rejected') { s.rejected++; totals.rejected++; } else { s.inProgress++; totals.inProgress++; }
  }
  // COD: cash riders recorded as collected in the period (collection time), cash
  // verified in the period, and what riders hold right now (collected − verified − written off).
  const collected = measure(), verified = measure();
  for await (const order of Order.find({ paymentMethod: 'cod', 'codFinance.collectedAt': { $gte: range.from, $lt: range.to } }).select('deliveryPartnerId codFinance.collectedPaise').lean().cursor()) {
    if (addPaise(collected, order.codFinance.collectedPaise)) stat(id(order.deliveryPartnerId)).cod.subtotal += order.codFinance.collectedPaise; else stat(id(order.deliveryPartnerId)).cod.invalid++;
  }
  for await (const order of Order.find({ paymentMethod: 'cod', 'codFinance.events': { $elemMatch: { action: 'verify', at: { $gte: range.from, $lt: range.to } } } }).select('codFinance.events.action codFinance.events.at codFinance.verifiedPaise').lean().cursor()) {
    const last = order.codFinance.events.filter(event => event.action === 'verify').at(-1);
    if (last && last.at >= range.from && last.at < range.to) addPaise(verified, order.codFinance.verifiedPaise);
  }
  const reported = measure();
  for (const order of await Order.find({ paymentMethod: 'cod', 'codFinance.status': 'remittance_reported' }).select('codFinance.reportedPaise').lean()) addPaise(reported, order.codFinance.reportedPaise);
  const discrepancies = await Order.countDocuments({ paymentMethod: 'cod', 'codFinance.status': { $in: ['disputed', 'discrepancy'] } });
  const filter = params.status && params.status !== 'all' ? { status: params.status } : {};
  let partners = await DeliveryPartner.find(filter).select('userId vehicleType status').populate('userId', 'name phone').lean();
  if (params.search) { const rx = new RegExp(escapeRegex(params.search), 'i'), digits = params.search.replace(/\D/g, ''); partners = partners.filter(p => rx.test(p.userId?.name || '') || (digits.length >= 4 && String(p.userId?.phone || '').includes(digits))); }
  const outstanding = await riderCodCashBalances((await DeliveryPartner.find({}).select('_id').lean()).map(p => p._id));
  const average = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
  let list = partners.map(p => {
    const s = stats.get(id(p._id)) || stat(id(p._id));
    return { id: id(p._id), name: p.userId?.name || 'Unnamed partner', phone: maskPhone(p.userId?.phone), vehicle: p.vehicleType || '', status: p.status || 'incomplete',
      assigned: s.assigned, delivered: s.delivered, failed: s.failed, rejected: s.rejected, inProgress: s.inProgress,
      successRate: s.delivered + s.failed ? s.delivered / (s.delivered + s.failed) : null, avgDurationMinutes: average(s.durations),
      earningsPaise: s.earnings.invalid ? null : s.earnings.subtotal, codCollectedPaise: s.cod.invalid ? null : s.cod.subtotal, cashOutstandingPaise: outstanding.get(id(p._id)) || 0 };
  });
  const key = { delivered: 'delivered', assigned: 'assigned', successRate: 'successRate', cod: 'codCollectedPaise', outstanding: 'cashOutstandingPaise', name: 'name' }[params.sort];
  list.sort(sorter(key, params.dir));
  const outstandingTotal = [...outstanding.values()].reduce((a, b) => a + b, 0);
  const table = all ? { rows: list, meta: { page: 1, limit: list.length, total: list.length, pages: 1 } } : page(list, params);
  return envelope('delivery', range, {
    totals: { ...totals, successRate: totals.delivered + totals.failed ? totals.delivered / (totals.delivered + totals.failed) : null, avgDurationMinutes: average(durations),
      totalPartners: await DeliveryPartner.countDocuments({}), activePartners: await DeliveryPartner.countDocuments({ status: 'approved' }) },
    cash: { collected: result(collected, 'COD cash riders recorded as collected in the period (collection time).'), verified: result(verified, 'COD cash finance verified in the period (verification time).'),
      reportedAwaitingVerification: result(reported, 'Cash handovers riders reported that finance has not yet verified (current state).'),
      outstandingPaise: outstandingTotal, outstandingBasis: 'Cash riders currently hold: collected minus verified minus approved write-offs (current state).', discrepancies },
    ...table, definitions: { assigned: 'Delivery trips created (assigned) in the period, including return pickups.', successRate: 'Delivered ÷ (delivered + failed) for trips assigned in the period. Rider-rejected trips are reassigned and shown separately.',
      duration: 'Average minutes from trip start to completion, for delivered trips with both timestamps.', earnings: 'Trip earnings recorded on delivered trips assigned in the period. Not payouts.' } });
}

// ---- Order Payments -----------------------------------------------------------
// One row per order placed in the period (payment secured), showing where the customer's money goes:
// seller earning, delivery partner earning, platform commission and taxes, and what the platform keeps.
//
// Figures come from the order's frozen checkout snapshot ("expected"). Once the order's finance is
// posted at delivery, seller, commission, tax and delivery figures are read from the ledger instead
// ("posted"), so later refund reversals are included. Cancelled orders earn nothing.
const sumPaise = (lines, key) => lines.reduce((n, line) => n + (Number.isSafeInteger(line[key]) ? line[key] : 0), 0);
const orderMoney = value => { try { return moneyPaise(value || 0); } catch { return null; } };
const LEDGER_FIELDS = { seller_payable: 'seller', commission_revenue: 'commission', tax_liability: 'commissionGst', tcs_liability: 'tcs', tds_liability: 'tds', platform_discount_expense: 'platformDiscount', customer_delivery: 'deliveryIncome' };
async function inBatches(ids, size, load) { const out = []; for (let i = 0; i < ids.length; i += size) out.push(...await load(ids.slice(i, i + size))); return out; }

export async function ordersReport(params, { all = false } = {}) {
  const { range } = params;
  const orders = [];
  for await (const order of placedOrders(range, { orderNo: 1, createdAt: 1, status: 1, paymentMethod: 1, userId: 1, pricing: 1, items: { _id: 1, sellerId: 1, name: 1, qty: 1, price: 1 },
    financialSnapshot: 1, financialPosting: 1, paymentId: 1, 'delivery.riderPayoutQuoted': 1, 'codFinance.status': 1 }).cursor()) orders.push(order);
  const ids = orders.map(order => order._id);

  // Ledger nets per order and account (signed; held→eligible moves cancel out).
  const ledger = new Map();
  for (const entry of await inBatches(ids, 500, batch => Ledger.find({ orderId: { $in: batch }, account: { $in: Object.keys(LEDGER_FIELDS) } }).select('orderId account direction amount').lean())) {
    const key = id(entry.orderId), field = LEDGER_FIELDS[entry.account], sums = ledger.get(key) || {};
    try { sums[field] = (sums[field] || 0) + signedPaise(entry); } catch { sums.invalid = true; }
    ledger.set(key, sums);
  }
  // Delivery partner pay from the completed forward trip; the tip is the customer's money for the rider.
  const riders = new Map();
  for (const trip of await inBatches(ids, 500, batch => Delivery.find({ orderId: { $in: batch }, status: 'delivered', direction: { $ne: 'return_pickup' } }).select('orderId partnerId partnerEarnings partnerTip').lean())) {
    const earned = orderMoney(trip.partnerEarnings), tip = orderMoney(trip.partnerTip);
    if (earned !== null && tip !== null) riders.set(id(trip.orderId), { payPaise: earned - tip, tipPaise: tip, partnerId: id(trip.partnerId) });
  }
  // Refunds: completed item returns, verified whole-order online refunds, and cancellation refunds to the wallet.
  const refunds = new Map(), addRefundTo = (orderId, paise) => { if (Number.isSafeInteger(paise) && paise > 0) refunds.set(id(orderId), (refunds.get(id(orderId)) || 0) + paise); };
  for (const ret of await inBatches(ids, 500, batch => Return.find({ orderId: { $in: batch }, status: 'REFUNDED' }).select('orderId refundAmount').lean())) addRefundTo(ret.orderId, orderMoney(ret.refundAmount));
  const paymentIds = orders.map(order => order.paymentId).filter(Boolean);
  for (const payment of await inBatches(paymentIds, 500, batch => Payment.find({ _id: { $in: batch } }).select('orderId refundObligations').lean())) {
    for (const refund of payment.refundObligations || []) if (refund.status === 'processed' && !refund.returnId && refund.currency === 'INR') addRefundTo(refund.orderId || payment.orderId, refund.amountPaise);
  }
  const { default: WalletLedger } = await import('../models/WalletLedger.js');
  for (const credit of await inBatches(ids.map(String), 500, batch => WalletLedger.find({ referenceType: 'ORDER', referenceId: { $in: batch }, direction: 'credit', type: { $in: ['REFUND', 'CANCELLATION_REFUND'] }, status: 'completed' }).select('referenceId amount').lean())) addRefundTo(credit.referenceId, orderMoney(credit.amount));

  const [sellers, customers, partners] = await Promise.all([
    Seller.find({ _id: { $in: [...new Set(orders.flatMap(order => (order.items || []).map(item => id(item.sellerId))))].filter(key => mongoose.isValidObjectId(key)) } }).select('businessName storeDetails.name').lean(),
    User.find({ _id: { $in: [...new Set(orders.map(order => id(order.userId)))].filter(key => mongoose.isValidObjectId(key)) } }).select('name phone').lean(),
    DeliveryPartner.find({ _id: { $in: [...new Set([...riders.values()].map(rider => rider.partnerId))].filter(key => mongoose.isValidObjectId(key)) } }).select('userId').populate('userId', 'name').lean(),
  ]);
  const sellerName = new Map(sellers.map(seller => [id(seller._id), seller.storeDetails?.name || seller.businessName || 'Unnamed seller']));
  const customerOf = new Map(customers.map(user => [id(user._id), user]));
  const partnerName = new Map(partners.map(partner => [id(partner._id), partner.userId?.name || 'Delivery partner']));

  let list = orders.map(order => {
    const key = id(order._id), p = order.pricing || {}, snapshot = order.financialSnapshot?.version === 2 && Array.isArray(order.financialSnapshot.lines) && order.financialSnapshot.components ? order.financialSnapshot : null;
    const cancelled = order.status === 'cancelled', delivered = order.status === 'delivered';
    const lines = snapshot ? snapshot.lines.map(line => {
      const productGstPaise = Number.isSafeInteger(line.taxableValuePaise) ? line.grossPaise - line.taxableValuePaise : null;
      return { itemId: line.itemId, name: (order.items || []).find(item => id(item._id) === line.itemId)?.name || 'Item', seller: sellerName.get(line.sellerId) || 'Removed seller', qty: line.qty,
        grossPaise: line.grossPaise, discountPaise: line.grossPaise - line.eligiblePaise, productGstPaise, gstRatePercent: line.gstRatePercent ?? null,
        commissionPaise: line.commissionPaise ?? null, commissionGstPaise: line.taxPaise ?? null, tcsPaise: line.tcsPaise ?? 0, tdsPaise: line.tdsPaise ?? 0, sellerNetPaise: line.netPaise ?? null, ruleMissing: !line.rule };
    }) : [];
    const expected = snapshot && !lines.some(line => line.ruleMissing) ? {
      seller: sumPaise(lines, 'sellerNetPaise') + (snapshot.components.sellerIncentivePaise || 0), commission: sumPaise(lines, 'commissionPaise'), commissionGst: sumPaise(lines, 'commissionGstPaise'),
      tcs: sumPaise(lines, 'tcsPaise'), tds: sumPaise(lines, 'tdsPaise'), platformDiscount: snapshot.discountFunding === 'platform' ? sumPaise(lines, 'discountPaise') : 0, deliveryIncome: snapshot.components.deliveryPaise,
    } : null;
    const posted = order.financialPosting && ledger.has(key) && !ledger.get(key).invalid ? { seller: 0, commission: 0, commissionGst: 0, tcs: 0, tds: 0, platformDiscount: 0, deliveryIncome: 0, ...ledger.get(key) } : null;
    const split = cancelled ? { seller: 0, commission: 0, commissionGst: 0, tcs: 0, tds: 0, platformDiscount: 0, deliveryIncome: 0 } : posted || expected;
    const basis = cancelled ? 'cancelled' : posted ? 'posted' : expected ? 'expected' : 'unavailable';
    const rider = riders.get(key), quoted = order.delivery?.riderPayoutQuoted == null ? null : orderMoney(order.delivery.riderPayoutQuoted);
    const riderPaise = cancelled ? 0 : rider ? rider.payPaise : quoted;
    const adminPaise = split && riderPaise !== null ? split.commission + split.deliveryIncome - riderPaise - split.platformDiscount : null;
    const user = customerOf.get(id(order.userId)) || {};
    return { id: key, orderNo: order.orderNo || key.slice(-8).toUpperCase(), placedAt: order.createdAt, status: order.status, paymentMethod: order.paymentMethod || 'unknown', basis,
      customer: user.name || 'Customer', customerPhone: maskPhone(user.phone), sellers: [...new Set(lines.length ? lines.map(line => line.seller) : (order.items || []).map(item => sellerName.get(id(item.sellerId)) || 'Removed seller'))],
      riderName: rider ? partnerName.get(rider.partnerId) || 'Delivery partner' : null, riderBasis: cancelled ? 'cancelled' : rider ? 'paid on delivery' : quoted !== null ? 'quoted' : 'not assigned',
      paidPaise: orderMoney(p.totalAmount), merchandisePaise: orderMoney(p.subtotal), deliveryFeePaise: orderMoney(p.deliveryCharge), tipPaise: orderMoney(p.tipAmount), donationPaise: orderMoney(p.donationAmount),
      discountPaise: lines.length ? sumPaise(lines, 'discountPaise') : null, productGstPaise: lines.length && lines.every(line => line.productGstPaise !== null) ? sumPaise(lines, 'productGstPaise') : null,
      sellerEarningPaise: split ? split.seller : null, commissionPaise: split ? split.commission : null, commissionGstPaise: split ? split.commissionGst : null, tcsPaise: split ? split.tcs : null, tdsPaise: split ? split.tds : null,
      platformDiscountPaise: split ? split.platformDiscount : null, deliveryIncomePaise: split ? split.deliveryIncome : null, riderEarningPaise: riderPaise, riderTipPaise: cancelled ? 0 : rider ? rider.tipPaise : orderMoney(p.tipAmount),
      adminEarningPaise: adminPaise, refundsPaise: refunds.get(key) || 0, delivered, lines };
  });

  const completed = list.filter(row => row.status === 'delivered');
  // Totals add up the orders that have the figure; orders without one are counted in incompleteOrders.
  const total = (rows, key) => rows.reduce((n, row) => n + (row[key] ?? 0), 0);
  const totals = { orders: list.length, completedOrders: completed.length, cancelledOrders: list.filter(row => row.status === 'cancelled').length,
    paidPaise: total(list, 'paidPaise'), refundsPaise: total(list, 'refundsPaise'),
    ...Object.fromEntries(['sellerEarningPaise', 'riderEarningPaise', 'commissionPaise', 'commissionGstPaise', 'tcsPaise', 'tdsPaise', 'productGstPaise', 'adminEarningPaise'].map(key => [key, total(completed, key)])),
    incompleteOrders: list.filter(row => row.basis === 'unavailable' || row.adminEarningPaise === null).length };
  if (params.status === 'completed') list = list.filter(row => row.status === 'delivered');
  if (params.status === 'cancelled') list = list.filter(row => row.status === 'cancelled');
  if (params.status === 'open') list = list.filter(row => !['delivered', 'cancelled'].includes(row.status));
  if (params.search) { const rx = new RegExp(escapeRegex(params.search), 'i'); list = list.filter(row => rx.test(row.orderNo) || rx.test(row.customer) || row.sellers.some(name => rx.test(name))); }
  const sortKey = { placed: 'placedAt', paid: 'paidPaise', admin: 'adminEarningPaise', commission: 'commissionPaise', seller: 'sellerEarningPaise', rider: 'riderEarningPaise', refunds: 'refundsPaise' }[params.sort];
  list.sort(sorter(sortKey, params.dir));
  const table = all ? { rows: list, meta: { page: 1, limit: list.length, total: list.length, pages: 1 } } : page(list, params);
  return envelope('orders', range, { totals, ...table, definitions: {
    customerPaid: 'The order total the customer paid (after discounts and coins, including delivery fee, tip and donation).',
    sellerEarning: 'What the seller(s) earn: item prices minus commission, GST on commission, TCS and TDS, plus any same-day incentive. Posted orders include later refund reversals.',
    deliveryPartnerEarning: 'The delivery partner’s trip pay for the order, excluding the customer’s tip (shown separately and paid to the rider in full). Before delivery this is the quoted pay.',
    commission: 'Platform commission on the order’s items. GST on commission is collected by the platform and owed to the government.',
    taxes: 'Product GST is included in item prices and is the seller’s tax. TCS and TDS are withheld from the seller’s payout and deposited with the government.',
    adminEarning: 'What the platform keeps: commission + delivery fee income − delivery partner pay − discounts funded by Bulkimart. Excludes GST, TCS/TDS, tips and donations, which belong to others.',
    basis: 'Posted: read from the finance ledger after delivery. Expected: from the order’s checkout snapshot, before delivery or posting. Cancelled orders earn nothing.',
    totals: 'Earning, commission and tax totals cover completed (delivered) orders only.' } });
}

// ---- CSV ----------------------------------------------------------------------
// Text cells that a spreadsheet could execute are prefixed with an apostrophe;
// numbers are written as plain numbers (so negatives stay numeric).
export const csvCell = value => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};
export const toCsv = (header, rows) => `${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const inr = paise => paise === null || paise === undefined ? null : Number((paise / 100).toFixed(2));
const date = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const pct = value => value === null ? null : Number((value * 100).toFixed(1));

export async function exportReport(report, params) {
  const stamp = `${params.range.fromDay}-to-${params.range.toDay}`;
  if (report === 'overview') {
    const data = await overviewReport(params);
    const rows = data.series.map(p => [p.day, p.ordersPlaced, inr(p.orderValuePaise), p.completedOrders, inr(p.completedSalesPaise), p.refundCount, inr(p.refundsPaise)]);
    rows.push(['Total', data.counts.totalOrders, inr(data.kpis.grossOrderValue.amountPaise), data.counts.completedOrders, inr(data.kpis.completedSales.amountPaise), data.kpis.refunds.count, inr(data.kpis.refunds.amountPaise)]);
    return { filename: `bulkimart-platform-report-${stamp}.csv`, csv: toCsv(['Date (IST)', 'Orders placed', 'Order value placed (INR)', 'Orders completed', 'Completed sales (INR)', 'Refunds completed', 'Refund amount (INR)'], rows) };
  }
  if (report === 'customers') {
    const data = await customersReport(params, { all: true });
    return { filename: `bulkimart-customers-report-${stamp}.csv`, csv: toCsv(['Customer', 'Phone (masked)', 'Registered (IST)', 'New in period', 'Orders placed', 'Orders completed', 'Completed spend (INR)', 'Last order (IST)', 'Account active'],
      data.rows.map(r => [r.name, r.phone, date(r.registeredAt), r.isNew ? 'Yes' : 'No', r.ordersPlaced, r.completedOrders, inr(r.spendPaise), date(r.lastOrderAt), r.active ? 'Yes' : 'No'])) };
  }
  if (report === 'vendors') {
    const data = await vendorsReport(params, { all: true });
    return { filename: `bulkimart-vendors-report-${stamp}.csv`, csv: toCsv(['Vendor', 'Status', 'Orders placed', 'Orders completed', 'Completed sales (INR)', 'Refunds (INR)', 'Platform commission (INR)', 'Seller earnings (INR)', 'Settlements paid (INR)', 'Settlements pending (INR)', 'Incomplete data'],
      data.rows.map(r => [r.name, r.status, r.ordersPlaced, r.completedOrders, inr(r.salesPaise), inr(r.refundsPaise), inr(r.commissionPaise), inr(r.earningsPaise), inr(r.settlementsPaidPaise), inr(r.settlementsPendingPaise), r.incomplete ? 'Yes' : 'No'])) };
  }
  if (report === 'delivery') {
    const data = await deliveryReport(params, { all: true });
    return { filename: `bulkimart-delivery-report-${stamp}.csv`, csv: toCsv(['Delivery partner', 'Phone (masked)', 'Vehicle', 'Status', 'Trips assigned', 'Delivered', 'Failed', 'Rejected', 'In progress', 'Success rate (%)', 'Avg duration (min)', 'Recorded earnings (INR)', 'COD collected (INR)', 'Cash outstanding now (INR)'],
      data.rows.map(r => [r.name, r.phone, r.vehicle, r.status, r.assigned, r.delivered, r.failed, r.rejected, r.inProgress, pct(r.successRate), r.avgDurationMinutes, inr(r.earningsPaise), inr(r.codCollectedPaise), inr(r.cashOutstandingPaise)])) };
  }
  if (report === 'orders') {
    const data = await ordersReport(params, { all: true });
    return { filename: `bulkimart-order-payments-${stamp}.csv`, csv: toCsv(['Order', 'Placed (IST)', 'Status', 'Payment method', 'Customer', 'Sellers', 'Delivery partner', 'Customer paid (INR)', 'Items (INR)', 'Discounts (INR)', 'Delivery fee (INR)', 'Tip (INR)', 'Donation (INR)',
      'Product GST in prices (INR)', 'Seller earning (INR)', 'Delivery partner earning (INR)', 'Platform commission (INR)', 'GST on commission (INR)', 'TCS (INR)', 'TDS (INR)', 'Discounts funded by Bulkimart (INR)', 'Admin earning (INR)', 'Refunds (INR)', 'Figures'],
      data.rows.map(r => [r.orderNo, date(r.placedAt), r.status, r.paymentMethod, r.customer, r.sellers.join('; '), r.riderName || r.riderBasis, inr(r.paidPaise), inr(r.merchandisePaise), inr(r.discountPaise), inr(r.deliveryFeePaise), inr(r.tipPaise), inr(r.donationPaise),
        inr(r.productGstPaise), inr(r.sellerEarningPaise), inr(r.riderEarningPaise), inr(r.commissionPaise), inr(r.commissionGstPaise), inr(r.tcsPaise), inr(r.tdsPaise), inr(r.platformDiscountPaise), inr(r.adminEarningPaise), inr(r.refundsPaise), r.basis])) };
  }
  throw httpError(400, 'Unknown report');
}
