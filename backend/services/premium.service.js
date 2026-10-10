import PremiumMembership from '../models/PremiumMembership.js';
import { httpError } from '../utils/response.js';

/**
 * The one place "does this customer hold Premium right now" gets decided.
 *
 * Never trust a stored `status: 'active'` alone — nothing sweeps memberships
 * to `expired` on the stroke of midnight, so a row can read active well past
 * its expiry. Every caller (the /me endpoint, the Product Subscription
 * creation gate) re-derives this from status + expiresAt, exactly as
 * shgSubscription.service.js does for the seller-side plan.
 */
export const getActivePremiumMembership = async (userId) => {
  const now = new Date();
  return PremiumMembership.findOne({
    userId,
    status: 'active',
    expiresAt: { $gte: now },
  }).sort({ expiresAt: -1 });
};

/**
 * Throws the 403 the customer UI keys off to open the plan chooser.
 *
 * `code` is what the frontend switches on — the sentence is for the person
 * reading it, same split SUBSCRIPTION_REQUIRED already uses for SHG sellers.
 */
export const assertActivePremiumMembership = async (userId) => {
  const membership = await getActivePremiumMembership(userId);
  if (!membership) {
    throw httpError(403, 'A Premium Membership is required to create a subscription.', {
      code: 'PREMIUM_MEMBERSHIP_REQUIRED',
    });
  }
  return membership;
};

/**
 * Calendar-month expiry, not 30-day arithmetic.
 *
 * Anchored to the 1st and then set, so a short month cannot overflow —
 * `setMonth` on the 31st of January silently becomes the 2nd or 3rd of
 * March, which would hand out days nobody paid for. Clamping to the last
 * day of the target month is what "one month from the 31st" means to the
 * person who bought it. Same reasoning, same shape as buildSchedule's
 * monthly branch in subscription.service.js.
 *
 * The time of day is preserved, so a membership bought at 14:30 expires at
 * 14:30 rather than at midnight.
 */
export const expiryFrom = (startsAt, durationMonths) => {
  const start = new Date(startsAt);
  const day = start.getDate();

  const expires = new Date(start.getFullYear(), start.getMonth() + Number(durationMonths), 1);
  const lastDayOfMonth = new Date(expires.getFullYear(), expires.getMonth() + 1, 0).getDate();
  expires.setDate(Math.min(day, lastDayOfMonth));
  expires.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());

  return expires;
};
