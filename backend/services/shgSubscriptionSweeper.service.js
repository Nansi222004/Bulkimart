import SHGSubscription from '../models/SHGSubscription.js';
import { notifyShg, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Two jobs, same poll-the-database shape as the other sweepers in this
 * codebase (orderSweeper.service.js, subscriptionPrepSweeper.service.js) —
 * setInterval + .unref(), not node-cron (installed but unused project-wide):
 *
 *  1. Flip `status: 'active'` rows whose `endDate` has passed to `'expired'`.
 *     This is a CACHE REFRESH ONLY — access is never gated by this flip
 *     alone. requireActiveSHGSubscription / assertActiveShgSubscription
 *     always re-check status + endDate together, so even if this sweeper is
 *     stalled or down, an expired subscription is still denied.
 *
 *  2. Send one daily reminder to any SHG whose active subscription expires
 *     within the next 2 days and hasn't already been reminded today —
 *     through the central notification service (persists + sockets to the
 *     shg:<id> room + FCM push), same as every other business event now.
 */

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h — no minute-level precision needed for a day-granularity reminder
const REMINDER_WINDOW_DAYS = 2;

const isSameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

let timer = null;

export const sweepOnce = async () => {
  const now = new Date();

  // 1. Expiry — a display/admin cache refresh, not the security boundary.
  await SHGSubscription.updateMany(
    { status: 'active', endDate: { $lt: now } },
    { $set: { status: 'expired' } }
  );

  // 2. Reminders — active subscriptions expiring within the window, not
  // already reminded today.
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + REMINDER_WINDOW_DAYS);

  const candidates = await SHGSubscription.find({
    status: 'active',
    endDate: { $gte: now, $lte: horizon },
  });

  for (const sub of candidates) {
    if (isSameDay(sub.lastReminderSentOn, now)) continue; // already reminded today

    // Atomic, conditioned on the same "not already reminded today" check at
    // write time — a concurrent tick cannot double-send.
    const result = await SHGSubscription.updateOne(
      {
        _id: sub._id,
        $or: [
          { lastReminderSentOn: null },
          { lastReminderSentOn: { $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
        ],
      },
      { $set: { lastReminderSentOn: now } }
    );
    if (result.modifiedCount !== 1) continue; // another tick already claimed it

    try {
      const daysLeft = Math.ceil((sub.endDate - now) / (24 * 60 * 60 * 1000));
      await notifyShg(String(sub.shgStoreId), {
        event: NOTIFICATION_EVENT.PREMIUM_UPDATE,
        title: 'Subscription expiring soon',
        message: `Your ${sub.planName} plan expires on ${sub.endDate.toDateString()} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Renew to keep listing products.`,
        route: '/shg/account',
      });
    } catch (err) {
      console.error('[SHG SUBSCRIPTION SWEEPER] reminder notify failed:', err.message);
    }
  }
};

export const startShgSubscriptionSweeper = () => {
  if (timer) return;

  timer = setInterval(() => {
    sweepOnce().catch((err) => console.error('[SHG SUBSCRIPTION SWEEPER] failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  timer.unref?.();

  console.log('SHG subscription sweeper started — expiring subscriptions are flagged and reminded daily');
};

export const stopShgSubscriptionSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
