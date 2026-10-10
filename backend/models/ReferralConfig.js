import mongoose from 'mongoose';
import { REFERRAL_DEFAULTS } from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-configurable Referral Program rules — same "never edited, a new
 * row supersedes the old one, history kept for audit" pattern as
 * RadiusSetting.js/CoinConfig.js/DeliveryChargeSetting.js. Exactly one row
 * has `isActive: true` at a time; services/referral.service.js caches it
 * the same way radiusSetting.service.js caches RadiusSetting.
 *
 * Every reward amount here is in COINS, not rupees — the rupee value is
 * `coins * CoinConfig.coinValue`, resolved at display/report time, never
 * stored here. Admin bears the full cost of every coin issued under this
 * program (see referral.service.js — every credit is tagged
 * `metadata.fundedBy: 'ADMIN'`).
 */
const milestoneSchema = new Schema(
  {
    count:      { type: Number, required: true, min: 1 },
    bonusCoins: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const referralConfigSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: true },

    /** Coins credited to the REFERRER when one referral becomes CREDITED. */
    perReferralCoins: { type: Number, required: true, min: 1, default: REFERRAL_DEFAULTS.PER_REFERRAL_COINS },

    /** Extra one-time coins at 5/10/25/50 (etc.) successful referrals — sorted ascending by `count`. */
    milestones: { type: [milestoneSchema], default: () => REFERRAL_DEFAULTS.MILESTONES },

    /** Referee's first order must be at least this ₹ value for the referral to qualify at all. */
    minQualifyingOrderValue: { type: Number, required: true, min: 0, default: REFERRAL_DEFAULTS.MIN_QUALIFYING_ORDER_VALUE },

    /**
     * Two-sided reward — coins credited to the REFEREE (B). Paid at the
     * SAME moment and gated by the SAME eligibility check as the
     * referrer's own reward (delivered, above minimum, return window
     * closed) — never an instant signup bonus. 0 = disabled.
     */
    refereeRewardCoins: { type: Number, required: true, min: 0, default: REFERRAL_DEFAULTS.REFEREE_REWARD_COINS },

    /** How many days the referee has to place a qualifying first order before the referral EXPIREs. */
    referralValidityDays: { type: Number, required: true, min: 1, default: REFERRAL_DEFAULTS.REFERRAL_VALIDITY_DAYS },

    /** Per-referrer velocity cap — a fraud/cost guard, not a business promise. 0 = unlimited. */
    maxReferralsPerUserPerMonth: { type: Number, required: true, min: 0, default: REFERRAL_DEFAULTS.MAX_REFERRALS_PER_USER_PER_MONTH },

    /** Admin's monthly coin liability ceiling for this program. 0 = unlimited. */
    monthlyBudgetCoins: { type: Number, required: true, min: 0, default: REFERRAL_DEFAULTS.MONTHLY_BUDGET_COINS },

    /** A single payout at/above this many coins is held for manual admin approval instead of auto-crediting. 0 = never require manual approval. */
    requireManualApprovalAbove: { type: Number, required: true, min: 0, default: REFERRAL_DEFAULTS.REQUIRE_MANUAL_APPROVAL_ABOVE },

    isActive:      { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy:     { type: ObjectId, ref: 'Admin' },
    note:          String,
  },
  { timestamps: true }
);

referralConfigSchema.index({ isActive: 1 });
referralConfigSchema.index({ createdAt: -1 });

const ReferralConfig = model('ReferralConfig', referralConfigSchema);
export default ReferralConfig;
