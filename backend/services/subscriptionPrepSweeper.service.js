import Subscription from '../models/Subscription.js';
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_DELIVERY_STATUS } from '../constants/enums.js';
import { prepAlertTimeFor, combineDeliveryDateAndTime } from './subscription.service.js';
import { notifySeller, notifyShg, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Tells the seller "prepare this" a fixed window before each scheduled
 * subscription delivery. Same poll-the-database shape as
 * subscriptionAcceptSweeper.service.js / orderSweeper.service.js — nothing
 * here is a per-delivery timer, since a restart must not lose track of
 * thirty scheduled dates spread across a month.
 *
 * The alert moment is `date + timeSlot start - leadMinutes`, computed by
 * `prepAlertTimeFor` (subscription.service.js) — never the raw
 * `deliverySchedule.date` alone, which is always midnight. Comparing
 * against midnight would fire the alert near midnight the night before
 * instead of near the actual delivery time, which is exactly the bug this
 * rewrite closes.
 */

const SWEEP_INTERVAL_MS = 60 * 1000;

const alertWindowMs = () =>
  (Number(process.env.SUBSCRIPTION_PREP_ALERT_MINUTES) || 30) * 60 * 1000;

let timer = null;

// Exported so a test (or a manual trigger) can run one pass immediately,
// without waiting up to SWEEP_INTERVAL_MS for the timer.
export const sweepOnce = async () => {
  const now = new Date();

  /**
   * A loose DB-level pre-filter, not the actual eligibility check.
   *
   * `deliverySchedule.date` is always midnight, so the true alert moment
   * (date + timeSlot start - lead time) always falls within the same
   * calendar day as `date`, or very close to it. Filtering on `date` up to
   * two days out safely catches every row that could possibly be due —
   * including one whose alert time has already passed while the process
   * was down, so a restart never silently loses it — without pulling in
   * every future delivery of every active subscription. The precise
   * decision happens per-row in JS below, via `prepAlertTimeFor`.
   */
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 2);

  const candidates = await Subscription.find({
    status: SUBSCRIPTION_STATUS.ACTIVE,
    deliverySchedule: {
      $elemMatch: {
        status: SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED,
        date: { $lte: horizon },
        prepAlertSentAt: null,
      },
    },
  }).select('_id sellerId shgStoreId userId timeSlot deliverySchedule');

  if (candidates.length === 0) return;

  const { emitToSeller, emitToShg } = await import('../socket/rooms.js');

  for (const sub of candidates) {
    const due = sub.deliverySchedule.filter((d) => {
      if (d.status !== SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED || d.prepAlertSentAt) return false;
      const alertAt = prepAlertTimeFor(d.date, sub.timeSlot, alertWindowMs() / 60000);
      return alertAt && alertAt <= now;
    });
    if (due.length === 0) continue;

    for (const row of due) {
      // Stamped one row at a time, atomically, so a concurrent tick (or a
      // slow previous tick still finishing) cannot alert the same row
      // twice — the filter re-checks prepAlertSentAt is still null at
      // write time, not just at the read above.
      const result = await Subscription.updateOne(
        { _id: sub._id, 'deliverySchedule._id': row._id, 'deliverySchedule.prepAlertSentAt': null },
        { $set: { 'deliverySchedule.$.prepAlertSentAt': new Date() } }
      );
      if (result.modifiedCount !== 1) continue; // another tick already claimed it

      try {
        const alert = {
          subscriptionId: sub._id,
          deliveryEntryId: row._id,
          // The actual promised moment (date + slot start), not the raw
          // midnight-anchored schedule date — this is what the vendor's
          // alert banner displays.
          deliveryDate: combineDeliveryDateAndTime(row.date, sub.timeSlot) || row.date,
        };
        if (sub.sellerId) emitToSeller(String(sub.sellerId), 'subscription_prep_alert', alert);
        else if (sub.shgStoreId) emitToShg(String(sub.shgStoreId), 'subscription_prep_alert', alert);

        // Durable copy + FCM, through the central service — same reasoning
        // as before (the socket toast above is only seen if the vendor is
        // online at that exact moment): now that FCM is real, this is also
        // what actually rings/pushes to their device if they're not.
        const notifyOpts = {
          event: NOTIFICATION_EVENT.SUBSCRIPTION_PREP,
          title: 'Upcoming subscription delivery',
          message: `A subscription delivery is scheduled within the next ${alertWindowMs() / 60000} minutes — please prepare it.`,
          metadata: { subscriptionId: sub._id },
          route: '/subscriptions',
        };
        if (sub.sellerId) await notifySeller(String(sub.sellerId), notifyOpts);
        else if (sub.shgStoreId) await notifyShg(String(sub.shgStoreId), notifyOpts);
      } catch (e) {
        console.error('[SUBSCRIPTION PREP SWEEPER] notify failed:', e.message);
      }
    }
  }
};

/**
 * Marks a `SCHEDULED` delivery entry `FAILED` (shown to admin as "Missed")
 * once its whole calendar day has passed with nobody ever having packed,
 * delivered, or skipped it. Before this, a `deliverySchedule` entry's
 * status was written in exactly two places — `buildSchedule` at creation
 * (always `scheduled`) and `verifyDeliveryOtp` on an actual completed
 * delivery (`delivered`) — so a delivery that simply never happened sat
 * showing "Scheduled" forever, even years later, which is exactly the bug
 * the admin Subscriptions screen was showing.
 *
 * Deliberately keyed off the whole DAY having passed (`date < startOfToday`),
 * not the slot's end time — `deliverySchedule.date` is always midnight-
 * anchored and this is a monitoring label, not a payout/refund trigger, so
 * the coarser, simpler cutoff is the right amount of precision here. A
 * delivery scheduled for later *today* is never touched.
 */
export const sweepMissedDeliveriesOnce = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const result = await Subscription.updateMany(
    { deliverySchedule: { $elemMatch: { status: SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED, date: { $lt: startOfToday } } } },
    { $set: { 'deliverySchedule.$[row].status': SUBSCRIPTION_DELIVERY_STATUS.FAILED } },
    { arrayFilters: [{ 'row.status': SUBSCRIPTION_DELIVERY_STATUS.SCHEDULED, 'row.date': { $lt: startOfToday } }] }
  );

  if (result.modifiedCount > 0) {
    console.log(`[SUBSCRIPTION MISSED SWEEPER] ${result.modifiedCount} subscription(s) had one or more past deliveries marked missed`);
  }
  return result;
};

export const startSubscriptionPrepSweeper = () => {
  if (timer) return;

  timer = setInterval(() => {
    sweepOnce().catch((err) => console.error('[SUBSCRIPTION PREP SWEEPER] failed:', err.message));
    sweepMissedDeliveriesOnce().catch((err) => console.error('[SUBSCRIPTION MISSED SWEEPER] failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  timer.unref?.();

  console.log(`Subscription prep sweeper started — sellers are alerted ${alertWindowMs() / 60000} min before each scheduled delivery`);
};

export const stopSubscriptionPrepSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
