import mongoose from 'mongoose';
import { REFERRAL_STATUSES, REFERRAL_STATUS } from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One row per referred person — created exactly once, inside
 * auth.controller.js::verifyAndLogin's `if (!user)` branch, the instant a
 * brand-new phone number signs up with a valid `referralCode`. Never
 * created for an existing account (self-referral / re-signup cannot back-
 * date a referral).
 *
 * `rewardConfigSnapshot` freezes the ReferralConfig that was live AT
 * SIGNUP TIME — same discipline as Order.items[].returnPolicy. If Admin
 * changes `perReferralCoins` tomorrow, a referral created today still pays
 * out what was promised when the friend actually signed up, never a
 * silently-changed number.
 */
const referralSchema = new Schema(
  {
    referrerId: { type: ObjectId, ref: 'User', required: true, index: true },
    // Unique — one referee can ever be attributed to exactly one referrer,
    // for their whole account lifetime.
    refereeId:  { type: ObjectId, ref: 'User', required: true, unique: true },

    referralCodeUsed: { type: String, required: true },

    status: { type: String, enum: REFERRAL_STATUSES, default: REFERRAL_STATUS.PENDING, index: true },

    // Filled in once the sweeper finds+claims a qualifying first order.
    qualifyingOrderId:    { type: ObjectId, ref: 'Order' },
    qualifyingOrderValue: Number,
    qualifiedAt:          Date,

    // Filled in once the Coin payout actually lands. `rewardCoins` is the
    // REFERRER's (A) side; `refereeRewardCoins` is the REFEREE's (B) side —
    // both paid at the same instant, by payoutReferral(), gated by the same
    // eligibility check. `coinTransactionId` points at A's own transaction;
    // B's transaction is looked up separately via its own idempotencyKey
    // (`REFERRAL_REFEREE:<referralId>`) if ever needed.
    rewardCoins:         Number,
    refereeRewardCoins:  Number,
    creditedAt:          Date,
    coinTransactionId:   { type: ObjectId, ref: 'CoinTransaction' },

    // Frozen at signup — see file comment above.
    rewardConfigSnapshot: {
      perReferralCoins:        Number,
      refereeRewardCoins:      Number,
      minQualifyingOrderValue: Number,
      coinValue:               Number,
      referralConfigId:        { type: ObjectId, ref: 'ReferralConfig' },
    },

    // Fraud signals — surfaced to the admin monitoring queue, never an
    // automatic block by themselves (families genuinely share devices/
    // addresses). Only `SELF_REFERRAL`, budget and velocity actually block.
    fraudFlags: [{ type: String }],

    blockedReason: String,
    reviewedBy:    { type: ObjectId, ref: 'Admin' },
    reviewedAt:    Date,

    // PENDING referrals past this instant with no qualifying order are
    // swept to EXPIRED — see referral.service.js::sweepReferralRewardsOnce.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

referralSchema.index({ referrerId: 1, status: 1 });
referralSchema.index({ status: 1, expiresAt: 1 });

const Referral = model('Referral', referralSchema);
export default Referral;
