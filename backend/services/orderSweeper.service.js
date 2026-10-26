import { sweepSellerPickupSync } from './sellerPickupSync.service.js';
import { sweepParcelsOnce } from './parcelAssignment.service.js';
import Order from '../models/Order.js';
import { cancelOrderAndRestore } from '../controllers/order.controller.js';
import { processReturnWindowRewards } from './coin.service.js';
import { sweepScheduledBroadcastsOnce } from './broadcast.service.js';
import { ORDER_STATUS, CHANNEL } from '../constants/enums.js';

/**
 * Cancels orders no shop ever picked up.
 *
 * This replaces a `setTimeout` armed inside checkout. That worked exactly once
 * per process: restart the server — which happens constantly in development and
 * on every deploy in production — and every pending timer vanished with it. The
 * orders it was watching stayed `placed` for ever, holding stock nobody could
 * buy and a coupon nobody could reuse, with no timer left to release them.
 *
 * A sweep asks the database instead of remembering, so it does not matter how
 * many times the process dies: the next tick picks up whatever is overdue.
 *
 * Only Quick Commerce is swept. A quick order is a promise of minutes, so a shop
 * that has not answered in a few has effectively declined. A Shop All order is
 * a different bargain — a seller may reasonably take until the next morning to
 * look at it, and auto-cancelling that would destroy real business.
 */

import { sweepEligibleSellerOrders } from './sellerOrderNotification.service.js';
import { sweepAdvertisingLifecycle } from './advertisingBilling.service.js';
import { sweepFinanceAutomation } from './financeAutomation.service.js';
const SWEEP_INTERVAL_MS = 30 * 1000;

/** How long a Quick order may sit unaccepted before it is given up on. */
const acceptWindowMs = () =>
  (Number(process.env.SELLER_ACCEPT_WINDOW_MINUTES) || 5) * 60 * 1000;

let timer = null;

export const sweepUnacceptedOrdersOnce = async () => {
  const cutoff = new Date(Date.now() - acceptWindowMs());

  // Sellers cannot accept an unpaid online order. Their acceptance window
  // starts at verified payment, while COD keeps its creation-time window.
  const stale = await Order.aggregate([
    { $match: { status: ORDER_STATUS.PLACED, type: CHANNEL.GROCERY } },
    { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id',
      pipeline: [{ $project: { status: 1, paidAt: 1 } }], as: '_acceptancePayment' } },
    { $match: { $or: [{ paymentMethod: 'cod', createdAt: { $lt: cutoff } },
      { paymentMethod: { $ne: 'cod' }, '_acceptancePayment.status': 'paid',
        $expr: { $lt: [{ $ifNull: [{ $arrayElemAt: ['$_acceptancePayment.paidAt', 0] }, '$createdAt'] }, cutoff] } }] } },
    { $limit: 50 }, { $project: { _id: 1, orderNo: 1 } },
  ]);

  if (stale.length === 0) return;

  console.log(`[SWEEPER] ${stale.length} Quick order(s) unaccepted past the window`);

  for (const order of stale) {
    // cancelOrderAndRestore re-checks the status itself, so an order accepted
    // between the query and this line is left alone rather than pulled back.
    const res = await cancelOrderAndRestore(order._id, {
      reason: `Auto-cancelled: the store did not accept this order within ${acceptWindowMs() / 60000} minutes`,
      allowedFrom: [ORDER_STATUS.PLACED],
      cancelledBy: 'system',
    });
    if (!res.ok) console.log(`[SWEEPER] skipped ${order.orderNo}: ${res.reason}`);
  }
};

/**
 * NHCONE Coins — return-window reward evaluation (Phase 7). Reuses this
 * exact timer rather than a second scheduler; kept in its own try/catch so
 * a Coins bug can never block or delay the order-cancellation sweep above,
 * and vice versa.
 */
const sweepCoinRewardsOnce = async () => {
  const { processed } = await processReturnWindowRewards({ limit: 100 });
  if (processed > 0) console.log(`[COINS SWEEPER] ${processed} order item(s) resolved this tick`);
};

export const startOrderSweeper = () => {
  if (timer) return;

  timer = setInterval(() => {
    sweepAdvertisingLifecycle().catch(()=>console.warn('[ADVERTISING] Service lifecycle reconciliation will retry.'));
    sweepParcelsOnce().catch(() => console.warn('[PARCEL] Durable assignment sweep will retry.'));
    sweepEligibleSellerOrders().catch(() => console.warn('[NOTIFICATION] Eligible order reconciliation will retry.'));
    sweepSellerPickupSync().catch(() => console.warn('[PICKUP SYNC] Worker unavailable; durable jobs retained.'));
    sweepUnacceptedOrdersOnce().catch((err) => console.error('[SWEEPER] failed:', err.message));
    sweepCoinRewardsOnce().catch((err) => console.error('[COINS SWEEPER] failed:', err.message));
    // Admin Push Notifications Broadcaster — scheduled sends. Same sibling-
    // job pattern as the two above: its own try/catch, so a broadcast bug
    // can never block order cancellation or Coins.
    sweepScheduledBroadcastsOnce().catch((err) => console.error('[BROADCAST SWEEPER] failed:', err.message));
    // Finance automation throttles itself and only runs once the finance
    // release flags are on; its own catch keeps it from blocking the others.
    sweepFinanceAutomation().catch((err) => console.error('[FINANCE SWEEPER] failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  // Do not hold the process open on its own account — a shutdown should not
  // have to wait for the next tick.
  timer.unref?.();

  console.log(`Order sweeper started — Quick orders unaccepted after ${acceptWindowMs() / 60000} min are cancelled`);
};

export const stopOrderSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
