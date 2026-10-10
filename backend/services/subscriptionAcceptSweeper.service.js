import Subscription from '../models/Subscription.js';
import { SUBSCRIPTION_STATUS } from '../constants/enums.js';

/**
 * Enforces the seller-acceptance window on new subscription requests.
 *
 * Same shape as orderSweeper.service.js on purpose: no timer is armed when
 * the request is created (see the comment on that in createSubscription's
 * own emit block) — a `setTimeout` per subscription would die on a server
 * restart and nobody would notice, whereas a poll against the database
 * doesn't care how many times the process has restarted since. This asks
 * Mongo what's overdue every tick instead of trying to remember.
 */

const SWEEP_INTERVAL_MS = 30 * 1000;

let timer = null;

const sweepOnce = async () => {
  const overdue = await Subscription.find({
    status: SUBSCRIPTION_STATUS.PENDING_SELLER_ACCEPTANCE,
    sellerAcceptDeadline: { $lt: new Date() },
  }).select('_id').limit(50);

  if (overdue.length === 0) return;

  console.log(`[SUBSCRIPTION SWEEPER] ${overdue.length} request(s) unaccepted past the window`);

  // Imported lazily to avoid a require-cycle at module load — the
  // controller doesn't import this sweeper, but keeping the direction
  // consistent (sweeper -> controller, never the reverse) costs nothing.
  const { cancelSubscriptionAndRestore } = await import('../controllers/subscription.controller.js');

  for (const sub of overdue) {
    const res = await cancelSubscriptionAndRestore(sub._id, {
      reason: `Auto-cancelled: the store did not accept this subscription request in time`,
    });
    if (!res.ok) console.log(`[SUBSCRIPTION SWEEPER] skipped ${sub._id}: ${res.reason}`);
  }
};

export const startSubscriptionAcceptSweeper = () => {
  if (timer) return;

  timer = setInterval(() => {
    sweepOnce().catch((err) => console.error('[SUBSCRIPTION SWEEPER] failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  timer.unref?.();

  console.log('Subscription accept sweeper started — unaccepted requests are auto-cancelled after their window');
};

export const stopSubscriptionAcceptSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
