import ReferralConfig from '../models/ReferralConfig.js';
import { REFERRAL_DEFAULTS } from '../constants/enums.js';

/**
 * Admin-configurable Referral Program rules — cached the same way
 * radiusSetting.service.js / coinConfig.service.js cache their own
 * settings row. Read on every signup (to snapshot into a new Referral)
 * and every sweeper tick — a hot-ish path, so no DB query per call.
 */

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const DEFAULTS = () => ({
  isEnabled: true,
  perReferralCoins: REFERRAL_DEFAULTS.PER_REFERRAL_COINS,
  milestones: REFERRAL_DEFAULTS.MILESTONES,
  minQualifyingOrderValue: REFERRAL_DEFAULTS.MIN_QUALIFYING_ORDER_VALUE,
  refereeRewardCoins: REFERRAL_DEFAULTS.REFEREE_REWARD_COINS,
  referralValidityDays: REFERRAL_DEFAULTS.REFERRAL_VALIDITY_DAYS,
  maxReferralsPerUserPerMonth: REFERRAL_DEFAULTS.MAX_REFERRALS_PER_USER_PER_MONTH,
  monthlyBudgetCoins: REFERRAL_DEFAULTS.MONTHLY_BUDGET_COINS,
  requireManualApprovalAbove: REFERRAL_DEFAULTS.REQUIRE_MANUAL_APPROVAL_ABOVE,
});

export const loadReferralConfig = async () => {
  const row = await ReferralConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? {
        _id: row._id,
        isEnabled: row.isEnabled,
        perReferralCoins: row.perReferralCoins,
        milestones: (row.milestones || []).slice().sort((a, b) => a.count - b.count),
        minQualifyingOrderValue: row.minQualifyingOrderValue,
        refereeRewardCoins: row.refereeRewardCoins,
        referralValidityDays: row.referralValidityDays,
        maxReferralsPerUserPerMonth: row.maxReferralsPerUserPerMonth,
        monthlyBudgetCoins: row.monthlyBudgetCoins,
        requireManualApprovalAbove: row.requireManualApprovalAbove,
      }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

export const invalidateReferralConfig = () => { cache = null; cachedAt = 0; };

/** Synchronous — never blocks a hot-path check on a stale cache. */
export const getReferralConfig = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};
