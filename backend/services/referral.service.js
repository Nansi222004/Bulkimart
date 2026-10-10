import crypto from 'crypto';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import Referral from '../models/Referral.js';
import ReferralMilestone from '../models/ReferralMilestone.js';
import CoinTransaction from '../models/CoinTransaction.js';
import { httpError } from '../utils/response.js';
import { creditEarnedCoins } from './coin.service.js';
import { getReferralConfig } from './referralConfig.service.js';
import { getCoinConfig } from './coinConfig.service.js';
import { notifyUser, NOTIFICATION_EVENT } from './notification.service.js';
import {
  COIN_REFERENCE_TYPE, ORDER_STATUS,
  REFERRAL_STATUS, REFERRAL_BLOCKED_REASON,
} from '../constants/enums.js';

/**
 * NHCONE Referral Program — the one place Referral business logic lives,
 * mirroring the "controllers stay thin, one service owns the rules" shape
 * coin.service.js already established.
 *
 * The whole reward is funded by Admin: every Coin credited here carries
 * `metadata.fundedBy: 'ADMIN'` on its CoinTransaction row, so the ledger can
 * always answer "who paid for this" — there is no separate treasury/float
 * concept in this codebase, this tag is the audit trail for that cost.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids misread codes
const CODE_LENGTH = 8;

const randomCode = () => {
  let out = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
};

/** Non-terminal Return statuses — mirrors coin.service.js's own ACTIVE_RETURN_STATUSES list. */
const ACTIVE_RETURN_STATUSES = [
  'RETURN_REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_RETURN', 'RETURN_RECEIVED',
  'REFUND_PENDING', 'REFUND_FAILED',
];

/* ============================================================================
 * REFERRAL CODE
 * ========================================================================== */

/** Lazily generates and persists a unique code the first time a user needs one. */
export const getOrCreateReferralCode = async (userId) => {
  const user = await User.findById(userId).select('referralCode');
  if (!user) throw httpError(404, 'User not found');
  if (user.referralCode) return user.referralCode;

  // Retry on the (astronomically rare) unique-index collision rather than
  // pre-checking existence — same "let the DB enforce it" convention used
  // everywhere else in this codebase.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await User.updateOne({ _id: userId, referralCode: { $exists: false } }, { $set: { referralCode: code } });
      const fresh = await User.findById(userId).select('referralCode');
      if (fresh.referralCode) return fresh.referralCode;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw httpError(500, 'Could not generate a referral code — please try again');
};

/** Public lookup — used by the signup screen to show "Referred by Amit" before the account exists. */
export const validateReferralCode = async (code) => {
  if (!code) return { valid: false };
  const referrer = await User.findOne({ referralCode: String(code).toUpperCase().trim() }).select('name referralCode');
  if (!referrer) return { valid: false };
  return { valid: true, referrerName: referrer.name || 'a Bulkimart member' };
};

/* ============================================================================
 * ATTRIBUTION — called ONLY from auth.controller.js::verifyAndLogin's
 * `if (!user)` branch, i.e. exactly once, on a brand-new phone number.
 * ========================================================================== */

/**
 * Creates the Referral row for a brand-new signup, if a valid code was
 * supplied. Never throws — a referral-code problem must never block a
 * signup; the caller gets `null` back on any non-qualifying outcome.
 */
export const captureReferralSignup = async ({ refereeId, referralCode }) => {
  if (!referralCode) return null;
  try {
    const config = getReferralConfig();
    if (!config.isEnabled) return null;

    const referrer = await User.findOne({ referralCode: String(referralCode).toUpperCase().trim() }).select('_id');
    if (!referrer) return null;
    if (String(referrer._id) === String(refereeId)) return null; // structurally impossible here (referee is new), kept as a defensive guard

    const coinConfig = getCoinConfig();
    const expiresAt = new Date(Date.now() + config.referralValidityDays * 24 * 60 * 60 * 1000);

    const referral = await Referral.create({
      referrerId: referrer._id,
      refereeId,
      referralCodeUsed: String(referralCode).toUpperCase().trim(),
      status: REFERRAL_STATUS.PENDING,
      rewardConfigSnapshot: {
        perReferralCoins: config.perReferralCoins,
        refereeRewardCoins: config.refereeRewardCoins,
        minQualifyingOrderValue: config.minQualifyingOrderValue,
        coinValue: coinConfig.coinValue,
        referralConfigId: config._id,
      },
      expiresAt,
    });

    await User.updateOne({ _id: refereeId }, { $set: { referredBy: referrer._id } });

    // NOTE: the referee's own reward is deliberately NOT credited here.
    // It is paid alongside the referrer's, inside payoutReferral() below,
    // gated by the exact same eligibility check (delivered + above minimum
    // + return window closed) — never an instant signup bonus, for the
    // same reason the referrer's reward waits: a friend who returns their
    // first order must never leave Admin having paid out on either side.

    // Confirms to the REFEREE (B) that the code was actually applied — until
    // now B had no visibility into this at all; only A's own referral list
    // ever showed anything. Best-effort, never blocks signup.
    const refereeReward = config.refereeRewardCoins;
    notifyUser(refereeId, {
      event: NOTIFICATION_EVENT.REFERRAL_SIGNUP,
      title: 'Referral code applied 🎉',
      message: refereeReward > 0
        ? `You joined via a referral! Complete your first eligible order to earn ${refereeReward} Coins.`
        : "You joined via a referral! Complete your first order to help your friend earn their reward.",
      metadata: { referralId: referral._id },
      route: '/profile/refer',
    }).catch(() => {});

    return referral;
  } catch (err) {
    // Duplicate refereeId (already attributed) or any other failure —
    // signup must proceed regardless.
    console.error('[REFERRAL] captureReferralSignup failed:', err.message);
    return null;
  }
};

/* ============================================================================
 * QUALIFICATION + PAYOUT — called from orderSweeper.service.js's existing tick.
 * ========================================================================== */

/** The referee's chronologically first-ever order — the only order a referral can ever qualify on. */
const findFirstOrder = (refereeId) =>
  Order.findOne({ userId: refereeId }).sort({ createdAt: 1 }).lean();

/** True once every item on a delivered order is past its own return-window instant, per Order.js's own computed field. */
const isOrderMatured = (order) => {
  const now = new Date();
  const items = order.items || [];
  if (items.length === 0) return false;
  return items.every((it) => {
    const at = it.coinRewardEligibleAt || it.returnEligibleUntil || it.deliveredAt;
    return at && new Date(at) <= now;
  });
};

const hasActiveReturn = (orderId) =>
  Return.exists({ orderId, status: { $in: ACTIVE_RETURN_STATUSES } });

/** This calendar month's already-credited referral coin total — the live figure `monthlyBudgetCoins` is checked against. */
const creditedCoinsThisMonth = async () => {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const rows = await CoinTransaction.aggregate([
    { $match: { referenceType: COIN_REFERENCE_TYPE.REFERRAL, createdAt: { $gte: start } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total || 0;
};

const successfulReferralCountThisMonth = async (referrerId) => {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  return Referral.countDocuments({ referrerId, status: REFERRAL_STATUS.CREDITED, creditedAt: { $gte: start } });
};

/**
 * Actually pays out one QUALIFIED referral's reward — to BOTH sides,
 * at the SAME instant, gated by the SAME eligibility the sweeper already
 * confirmed (delivered, above minimum, return window closed):
 *   - referrer (A): `perReferralCoins`
 *   - referee  (B): `refereeRewardCoins` — never an instant signup bonus,
 *     see the comment in captureReferralSignup for why
 * Then checks for a newly-reached milestone. Idempotent via
 * CoinTransaction.idempotencyKey on both sides independently.
 */
const payoutReferral = async (referral) => {
  const referrerAmount = referral.rewardConfigSnapshot?.perReferralCoins || 0;
  const refereeAmount = referral.rewardConfigSnapshot?.refereeRewardCoins || 0;

  if (referrerAmount <= 0 && refereeAmount <= 0) {
    await Referral.updateOne({ _id: referral._id }, { $set: { status: REFERRAL_STATUS.BLOCKED, blockedReason: REFERRAL_BLOCKED_REASON.ZERO_REWARD } });
    return;
  }

  let transaction = null;
  if (referrerAmount > 0) {
    ({ transaction } = await creditEarnedCoins({
      userId: referral.referrerId,
      amount: referrerAmount,
      referenceType: COIN_REFERENCE_TYPE.REFERRAL,
      referenceId: String(referral._id),
      idempotencyKey: `REFERRAL:${referral._id}`,
      description: 'Referral reward — a friend you invited completed their first order',
      metadata: { fundedBy: 'ADMIN', referralId: String(referral._id), refereeId: String(referral.refereeId) },
    }));

    await notifyUser(referral.referrerId, {
      event: NOTIFICATION_EVENT.REFERRAL_REWARD_CREDITED,
      title: '🎉 Referral reward credited!',
      message: `Your friend completed their first order — ${referrerAmount} Coins added to your wallet.`,
      metadata: { referralId: referral._id },
      route: '/profile/refer',
    });
  }

  if (refereeAmount > 0) {
    await creditEarnedCoins({
      userId: referral.refereeId,
      amount: refereeAmount,
      referenceType: COIN_REFERENCE_TYPE.REFERRAL,
      referenceId: String(referral._id),
      idempotencyKey: `REFERRAL_REFEREE:${referral._id}`,
      description: 'Referral reward — your first order qualified',
      metadata: { fundedBy: 'ADMIN', referralId: String(referral._id), referrerId: String(referral.referrerId) },
    });

    await notifyUser(referral.refereeId, {
      event: NOTIFICATION_EVENT.REFERRAL_REWARD_CREDITED,
      title: '🎉 Referral reward credited!',
      message: `Your first order qualified — ${refereeAmount} Coins added to your wallet.`,
      metadata: { referralId: referral._id },
      route: '/profile/refer',
    });
  }

  await Referral.updateOne(
    { _id: referral._id, status: REFERRAL_STATUS.QUALIFIED },
    {
      $set: {
        status: REFERRAL_STATUS.CREDITED,
        rewardCoins: referrerAmount,
        refereeRewardCoins: refereeAmount,
        creditedAt: new Date(),
        coinTransactionId: transaction?._id,
      },
    }
  );

  await checkAndCreditMilestone(referral.referrerId);
};

const checkAndCreditMilestone = async (referrerId) => {
  const config = getReferralConfig();
  if (!config.milestones?.length) return;

  const successfulCount = await Referral.countDocuments({ referrerId, status: REFERRAL_STATUS.CREDITED });
  for (const milestone of config.milestones) {
    if (successfulCount < milestone.count) continue;
    const already = await ReferralMilestone.exists({ userId: referrerId, milestoneCount: milestone.count });
    if (already) continue;

    try {
      const { transaction } = await creditEarnedCoins({
        userId: referrerId,
        amount: milestone.bonusCoins,
        referenceType: COIN_REFERENCE_TYPE.REFERRAL,
        referenceId: `MILESTONE:${milestone.count}`,
        idempotencyKey: `REFERRAL_MILESTONE:${referrerId}:${milestone.count}`,
        description: `Referral milestone bonus — ${milestone.count} successful referrals`,
        metadata: { fundedBy: 'ADMIN', milestoneCount: milestone.count },
      });
      await ReferralMilestone.create({
        userId: referrerId, milestoneCount: milestone.count, bonusCoins: milestone.bonusCoins, coinTransactionId: transaction._id,
      });
      await notifyUser(referrerId, {
        event: NOTIFICATION_EVENT.REFERRAL_MILESTONE_REACHED,
        title: `🏆 ${milestone.count} referrals milestone!`,
        message: `You've referred ${milestone.count} friends — ${milestone.bonusCoins} bonus Coins added.`,
        metadata: {},
        route: '/profile/refer',
      });
    } catch (err) {
      if (err.code === 11000) continue; // already credited by a concurrent tick — no-op
      console.error(`[REFERRAL] milestone ${milestone.count} for ${referrerId} failed:`, err.message);
    }
  }
};

/**
 * One evaluation pass over every PENDING referral — called from the
 * existing orderSweeper.service.js tick (no new scheduler), same shape as
 * coin.service.js::processReturnWindowRewards.
 */
export const sweepReferralRewardsOnce = async ({ limit = 100 } = {}) => {
  const config = getReferralConfig();
  if (!config.isEnabled) return { expired: 0, qualified: 0, credited: 0 };

  const now = new Date();

  // 1. Expire anything past its signup-to-first-order window.
  const expiredResult = await Referral.updateMany(
    { status: REFERRAL_STATUS.PENDING, expiresAt: { $lte: now } },
    { $set: { status: REFERRAL_STATUS.EXPIRED } }
  );

  const pending = await Referral.find({ status: REFERRAL_STATUS.PENDING, expiresAt: { $gt: now } }).limit(limit);

  let qualified = 0;
  let credited = 0;

  for (const referral of pending) {
    try {
      const order = await findFirstOrder(referral.refereeId);
      if (!order || order.status !== ORDER_STATUS.DELIVERED) continue; // not yet — re-checked next tick

      const value = order.pricing?.totalAmount ?? 0;
      if (value < (referral.rewardConfigSnapshot?.minQualifyingOrderValue ?? 0)) {
        // The referee's ONE first order is final and already delivered — it
        // will never grow, so this referral can never qualify.
        await Referral.updateOne(
          { _id: referral._id, status: REFERRAL_STATUS.PENDING },
          { $set: { status: REFERRAL_STATUS.BLOCKED, blockedReason: REFERRAL_BLOCKED_REASON.BELOW_MINIMUM_ORDER_VALUE } }
        );
        continue;
      }

      if (await hasActiveReturn(order._id)) continue; // still resolving — re-checked next tick
      if (!isOrderMatured(order)) continue; // return window not yet closed

      // Atomic claim — PENDING -> QUALIFIED, guarded in the filter, same
      // "condition embedded in the query" convention as coin.service.js.
      const claim = await Referral.updateOne(
        { _id: referral._id, status: REFERRAL_STATUS.PENDING },
        { $set: { status: REFERRAL_STATUS.QUALIFIED, qualifyingOrderId: order._id, qualifyingOrderValue: value, qualifiedAt: now } }
      );
      if (claim.modifiedCount !== 1) continue; // lost the race to another worker/tick
      qualified++;

      const fresh = await Referral.findById(referral._id);

      // Cost + fraud guards — checked AFTER qualification (the referral is
      // real either way) but BEFORE money moves.
      const cfg = getReferralConfig();
      if (cfg.monthlyBudgetCoins > 0) {
        const spent = await creditedCoinsThisMonth();
        if (spent + (fresh.rewardConfigSnapshot?.perReferralCoins || 0) > cfg.monthlyBudgetCoins) {
          await Referral.updateOne({ _id: fresh._id }, { $set: { status: REFERRAL_STATUS.BLOCKED, blockedReason: REFERRAL_BLOCKED_REASON.BUDGET_EXHAUSTED } });
          continue;
        }
      }
      if (cfg.maxReferralsPerUserPerMonth > 0) {
        const count = await successfulReferralCountThisMonth(fresh.referrerId);
        if (count >= cfg.maxReferralsPerUserPerMonth) {
          await Referral.updateOne({ _id: fresh._id }, { $set: { status: REFERRAL_STATUS.BLOCKED, blockedReason: REFERRAL_BLOCKED_REASON.VELOCITY_LIMIT } });
          continue;
        }
      }
      if (cfg.requireManualApprovalAbove > 0 && (fresh.rewardConfigSnapshot?.perReferralCoins || 0) >= cfg.requireManualApprovalAbove) {
        continue; // left QUALIFIED — an admin must call approveReferral()
      }

      await payoutReferral(fresh);
      credited++;
    } catch (err) {
      console.error(`[REFERRAL SWEEPER] referral ${referral._id} failed:`, err.message);
    }
  }

  return { expired: expiredResult.modifiedCount || 0, qualified, credited };
};

/** Admin action — releases a QUALIFIED referral held for manual approval. */
export const approveReferralPayout = async (referralId, adminId) => {
  const referral = await Referral.findById(referralId);
  if (!referral) throw httpError(404, 'Referral not found');
  if (referral.status !== REFERRAL_STATUS.QUALIFIED) throw httpError(400, `Cannot approve a referral in status ${referral.status}`);

  await payoutReferral(referral);
  await Referral.updateOne({ _id: referralId }, { $set: { reviewedBy: adminId, reviewedAt: new Date() } });
  return Referral.findById(referralId);
};

/** Admin action — rejects a PENDING/QUALIFIED referral outright (fraud, duplicate, etc.). */
export const blockReferral = async (referralId, adminId, reason) => {
  const referral = await Referral.findOneAndUpdate(
    { _id: referralId, status: { $in: [REFERRAL_STATUS.PENDING, REFERRAL_STATUS.QUALIFIED] } },
    { $set: { status: REFERRAL_STATUS.BLOCKED, blockedReason: reason || REFERRAL_BLOCKED_REASON.ADMIN_REJECTED, reviewedBy: adminId, reviewedAt: new Date() } },
    { new: true }
  );
  if (!referral) throw httpError(400, 'Referral is not in a blockable state');
  return referral;
};

/* ============================================================================
 * CUSTOMER-FACING READS
 * ========================================================================== */

export const getMyReferralSummary = async (userId) => {
  const code = await getOrCreateReferralCode(userId);
  const config = getReferralConfig();
  const coinConfig = getCoinConfig();

  const [total, pending, credited, blocked, expired, milestoneRows] = await Promise.all([
    Referral.countDocuments({ referrerId: userId }),
    Referral.countDocuments({ referrerId: userId, status: { $in: [REFERRAL_STATUS.PENDING, REFERRAL_STATUS.QUALIFIED] } }),
    Referral.countDocuments({ referrerId: userId, status: REFERRAL_STATUS.CREDITED }),
    Referral.countDocuments({ referrerId: userId, status: REFERRAL_STATUS.BLOCKED }),
    Referral.countDocuments({ referrerId: userId, status: REFERRAL_STATUS.EXPIRED }),
    ReferralMilestone.find({ userId }).lean(),
  ]);

  const coinsFromReferrals = await Referral.aggregate([
    { $match: { referrerId: userId, status: REFERRAL_STATUS.CREDITED } },
    { $group: { _id: null, total: { $sum: '$rewardCoins' } } },
  ]);
  const coinsFromMilestones = milestoneRows.reduce((sum, m) => sum + (m.bonusCoins || 0), 0);
  // This user's OWN reward as a referee (B) — earned on a different
  // referral than the ones counted above (those are the ones where this
  // user is the REFERRER). Both sides of the coin count toward "coins
  // earned from this program", so both are added together here.
  const coinsAsReferee = await Referral.aggregate([
    { $match: { refereeId: userId, status: REFERRAL_STATUS.CREDITED } },
    { $group: { _id: null, total: { $sum: '$refereeRewardCoins' } } },
  ]);
  const totalCoinsEarned = (coinsFromReferrals[0]?.total || 0) + coinsFromMilestones + (coinsAsReferee[0]?.total || 0);

  const nextMilestone = (config.milestones || []).find((m) => m.count > credited) || null;

  // The OTHER side of this same screen — was I (this user) referred by
  // someone, and where does that referral currently stand? Previously this
  // user (B) had no visibility at all into their own referral's status;
  // only A's list ever showed anything.
  const asReferee = await Referral.findOne({ refereeId: userId }).populate('referrerId', 'name').lean();

  return {
    referralCode: code,
    perReferralCoins: config.perReferralCoins,
    refereeRewardCoins: config.refereeRewardCoins,
    coinValue: coinConfig.coinValue,
    minQualifyingOrderValue: config.minQualifyingOrderValue,
    referralValidityDays: config.referralValidityDays,
    stats: { total, pending, successful: credited, blocked, expired },
    totalCoinsEarned,
    nextMilestone,
    milestonesReached: milestoneRows.map((m) => m.milestoneCount),
    referredBy: asReferee
      ? {
          referrerName: maskName(asReferee.referrerId?.name),
          status: asReferee.status,
          rewardCoins: asReferee.refereeRewardCoins ?? asReferee.rewardConfigSnapshot?.refereeRewardCoins ?? 0,
        }
      : null,
  };
};

/** Masks a name/phone for another user's referral list — "Amit M." / "+91 98••••10". */
const maskName = (name) => {
  if (!name) return 'Bulkimart user';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};
const maskPhone = (phone) => {
  if (!phone || phone.length < 8) return phone || '';
  return `${phone.slice(0, 2)}${'•'.repeat(phone.length - 6)}${phone.slice(-4)}`;
};

export const listMyReferrals = async (userId, { status } = {}) => {
  const filter = { referrerId: userId };
  if (status) filter.status = status;
  const rows = await Referral.find(filter).sort({ createdAt: -1 }).populate('refereeId', 'name phone').lean();
  return rows.map((r) => ({
    _id: r._id,
    refereeName: maskName(r.refereeId?.name),
    refereePhone: maskPhone(r.refereeId?.phone),
    status: r.status,
    rewardCoins: r.rewardCoins || r.rewardConfigSnapshot?.perReferralCoins,
    createdAt: r.createdAt,
    creditedAt: r.creditedAt,
    expiresAt: r.expiresAt,
  }));
};
