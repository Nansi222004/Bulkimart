import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One row per (user, milestone count) EVER credited — e.g. userId=X,
 * milestoneCount=5. Separate from `Referral` on purpose: a milestone bonus
 * is earned by a COUNT of successful referrals, not by any single one of
 * them, so it needs its own idempotent payout record rather than being
 * bolted onto whichever referral happened to be the Nth.
 *
 * The unique compound index IS the idempotency guard at the DB level —
 * `referral.service.js` also uses a matching CoinTransaction.idempotencyKey
 * (`REFERRAL_MILESTONE:<userId>:<count>`), so a milestone can never be
 * paid twice even under a concurrent double-run of the sweeper.
 */
const referralMilestoneSchema = new Schema(
  {
    userId:          { type: ObjectId, ref: 'User', required: true },
    milestoneCount:  { type: Number, required: true }, // 5, 10, 25, 50, ...
    bonusCoins:       { type: Number, required: true },
    coinTransactionId: { type: ObjectId, ref: 'CoinTransaction' },
    creditedAt:       { type: Date, default: Date.now },
  },
  { timestamps: true }
);

referralMilestoneSchema.index({ userId: 1, milestoneCount: 1 }, { unique: true });

const ReferralMilestone = model('ReferralMilestone', referralMilestoneSchema);
export default ReferralMilestone;
