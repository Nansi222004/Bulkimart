import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import Return from '../models/Return.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { financeFlags } from './financeSafety.service.js';
import { getFinancePolicy } from './financePolicy.service.js';
import { postOrderFinance, releaseOrderFinance, releaseDeliveryEarning, reverseRefundedReturn } from './orderFinance.service.js';
import { createSellerPayoutRequest } from './sellerPayout.service.js';
import { requestVerifiedRiderPayout } from './deliveryPayout.service.js';

/**
 * Moves money through the normal path without an admin clicking each order:
 *   delivered + payment/COD cash settled → seller & rider earnings "on hold"
 *   return window over, no open return    → seller earnings "available to pay"
 *   payment settled                        → rider earning "available to pay"
 *   refund completed                       → seller earning reduced
 *   weekly schedule day                    → payout requests created
 * Every step calls the same idempotent, transactional service an admin would,
 * so all existing checks still apply. An order that fails a check is left for
 * the admin with the reason recorded in `financeAutomation.lastError`, and is
 * retried after RETRY_MS.
 */
const TICK_MS = 2 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const BATCH = 50;
let lastRun = 0, running = false;

const operationsEnabled = flags => flags.operations && flags.policyApproved && flags.testsApproved;
const payoutsEnabled = flags => flags.payouts && flags.policyApproved && flags.testsApproved;
const due = now => ({ $or: [{ 'financeAutomation.lastError': { $exists: false } }, { 'financeAutomation.lastAttemptAt': { $lt: new Date(now - RETRY_MS) } }] });
const cashSettled = { $or: [{ paymentMethod: { $ne: 'cod' } }, { 'codFinance.status': { $in: ['verified', 'allocated'] } }] };

const attempt = async (orderId, step, work, summary) => {
  try {
    await work();
    await Order.updateOne({ _id: orderId, 'financeAutomation.lastError': { $exists: true } }, { $unset: { financeAutomation: 1 } });
    summary[step] = (summary[step] || 0) + 1;
    return true;
  } catch (error) {
    await Order.updateOne({ _id: orderId }, { $set: { financeAutomation: { step, lastError: error.message, status: error.status || 500, lastAttemptAt: new Date() } } });
    summary.failed = (summary.failed || 0) + 1;
    return false;
  }
};

// The payout day is judged in India time so "Monday" means Monday for sellers.
const indiaDay = (now) => { const ist = new Date(now + 5.5 * 3600 * 1000); return { weekday: ist.getUTCDay(), key: ist.toISOString().slice(0, 10) }; };

const createWeeklyPayouts = async (policy, now, summary) => {
  const { weekday, key } = indiaDay(now);
  if (policy.payoutSchedule !== 'weekly' || weekday !== policy.payoutWeekday) return;
  const runs = mongoose.connection.collection('finance_automation_runs');
  const runId = `WEEKLY-PAYOUTS-${key}`;
  if (await runs.findOne({ _id: runId })) return;
  const paise = { $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } };
  const balance = (account, field) => SellerLedgerEntry.aggregate([
    { $match: { account, bucket: 'eligible', [field]: { $exists: true } } },
    { $group: { _id: `$${field}`, paise: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, paise, { $multiply: [paise, -1] }] } } } },
    { $match: { paise: { $gt: 0 } } },
  ]);
  for (const row of await balance('seller_payable', 'sellerId')) {
    const amount = row.paise / 100;
    if (amount < policy.sellerMinPayout) continue;
    try { await createSellerPayoutRequest({ sellerId: row._id, amount, key: `weekly-${key}`, automatic: true }); summary.sellerPayouts = (summary.sellerPayouts || 0) + 1; }
    catch (error) { console.warn(`[FINANCE] Weekly seller payout skipped for ${row._id}: ${error.message}`); }
  }
  for (const row of await balance('rider_payable', 'partnerId')) {
    const partner = await DeliveryPartner.findById(row._id).select('userId').lean();
    const amount = row.paise / 100;
    if (!partner || amount <= 0 || amount < policy.riderMinPayout) continue;
    try { await requestVerifiedRiderPayout({ partnerId: row._id, userId: partner.userId, amount, key: `weekly-${key}`, automatic: true }); summary.riderPayouts = (summary.riderPayouts || 0) + 1; }
    catch (error) { console.warn(`[FINANCE] Weekly rider payout skipped for ${row._id}: ${error.message}`); }
  }
  await runs.updateOne({ _id: runId }, { $set: { completedAt: new Date() } }, { upsert: true });
};

export const runFinanceAutomationOnce = async ({ now = Date.now() } = {}) => {
  const flags = financeFlags(), summary = {};
  if (!operationsEnabled(flags)) return { skipped: 'operations disabled' };
  const snapshot = { 'financialSnapshot.version': 2 };

  const toPost = await Order.find({ ...snapshot, 'financialSnapshot.state': 'configured', status: 'delivered', financialPosting: { $exists: false }, $and: [cashSettled, due(now)] }).select('_id').limit(BATCH).lean();
  for (const { _id } of toPost) await attempt(_id, 'post', () => postOrderFinance(_id, null), summary);

  // Refunds before release, so an order with a completed return can release
  // its remaining earnings in the same run.
  // Every completed refund not yet reconciled, however old. Refunds on orders
  // with no finance snapshot are marked once so they are not scanned again.
  const refunds = await Return.find({ status: 'REFUNDED', financeReconciledAt: { $exists: false }, financeSkipReason: { $exists: false },
    $or: [{ financeRetryAfter: { $exists: false } }, { financeRetryAfter: { $lte: new Date(now) } }] }).select('_id orderId').sort({ _id: 1 }).limit(BATCH * 4).lean();
  if (refunds.length) {
    const orders = await Order.find({ _id: { $in: refunds.map(row => row.orderId) } }).select('_id financialSnapshot.version financialPosting').lean();
    const byId = new Map(orders.map(order => [String(order._id), order]));
    for (const ret of refunds) {
      const order = byId.get(String(ret.orderId));
      if (!order || order.financialSnapshot?.version !== 2) { await Return.updateOne({ _id: ret._id }, { $set: { financeSkipReason: 'no_finance_snapshot' } }); continue; }
      // Earnings not added yet; check again later rather than crowding the queue.
      if (!order.financialPosting) { await Return.updateOne({ _id: ret._id }, { $set: { financeRetryAfter: new Date(now + RETRY_MS) } }); continue; }
      if (!await attempt(order._id, 'refund', () => reverseRefundedReturn(ret._id, null), summary)) await Return.updateOne({ _id: ret._id }, { $set: { financeRetryAfter: new Date(now + RETRY_MS) } });
    }
  }

  const toRelease = await Order.find({ ...snapshot, financialPosting: 'held', status: 'delivered', ...due(now) }).sort({ 'financeAutomation.lastAttemptAt': 1, _id: 1 }).select('_id').limit(BATCH).lean();
  for (const { _id } of toRelease) await attempt(_id, 'release', () => releaseOrderFinance(_id, null), summary);

  const heldRides = await Delivery.find({ financialEarningStatus: 'held' }).select('orderId').limit(BATCH * 4).lean();
  const riderOrders = await Order.find({ _id: { $in: heldRides.map(row => row.orderId) }, ...snapshot, status: 'delivered', $and: [cashSettled, due(now)] }).select('_id').limit(BATCH).lean();
  for (const { _id } of riderOrders) await attempt(_id, 'rider_release', () => releaseDeliveryEarning(_id, null), summary);

  if (payoutsEnabled(flags)) await createWeeklyPayouts(await getFinancePolicy(), now, summary);
  return summary;
};

export const sweepFinanceAutomation = async () => {
  if (running || Date.now() - lastRun < TICK_MS) return;
  running = true; lastRun = Date.now();
  try {
    const summary = await runFinanceAutomationOnce();
    const moved = Object.entries(summary).filter(([key]) => key !== 'skipped');
    if (moved.length) console.log('[FINANCE] Automation:', Object.fromEntries(moved));
  } finally { running = false; }
};
