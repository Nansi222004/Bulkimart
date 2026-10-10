import mongoose from 'mongoose';
import ReferralConfig from '../models/ReferralConfig.js';
import Referral from '../models/Referral.js';
import ReferralMilestone from '../models/ReferralMilestone.js';
import CoinTransaction from '../models/CoinTransaction.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, paginated, getPagination, httpError } from '../utils/response.js';
import { getReferralConfig, loadReferralConfig } from '../services/referralConfig.service.js';
import { getCoinConfig } from '../services/coinConfig.service.js';
import { approveReferralPayout, blockReferral } from '../services/referral.service.js';
import { COIN_REFERENCE_TYPE, REFERRAL_STATUSES } from '../constants/enums.js';

/**
 * Admin — Referral Program. Two screens: Referral Settings (the
 * ReferralConfig insert-not-edit pattern, identical to Radius Settings)
 * and a Referrals monitoring queue with block/approve actions and a cost
 * report — the visible half of "Admin bears the full coin cost".
 */

// @desc    Current + historical Referral Program configuration
// @route   GET /api/admin/referral-settings
// @access  Private/Admin
export const getReferralConfigForAdmin = asyncHandler(async (req, res) => {
  const active = await ReferralConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await ReferralConfig.find().sort({ createdAt: -1 }).limit(50)
    .populate('updatedBy', 'name email').lean();

  const live = getReferralConfig();
  const current = active ? { ...active, source: 'configured' } : { ...live, source: 'default' };

  return ok(res, { current, history }, 'Referral settings');
});

/**
 * @desc    Save new Referral Program settings. Same insert-not-edit
 *          pattern as setRadiusSettingForAdmin — the previous row is
 *          deactivated and kept, never edited in place, so a past change
 *          stays auditable.
 * @route   POST /api/admin/referral-settings
 * @access  Private/Admin
 */
export const setReferralConfigForAdmin = asyncHandler(async (req, res) => {
  const {
    isEnabled, perReferralCoins, milestones, minQualifyingOrderValue,
    refereeRewardCoins, referralValidityDays, maxReferralsPerUserPerMonth,
    monthlyBudgetCoins, requireManualApprovalAbove, note,
  } = req.body;

  const positiveInt = (label, raw, { min = 0, required = true } = {}) => {
    if (raw === undefined || raw === null || raw === '') {
      if (!required) return undefined;
      throw httpError(400, `${label} is required`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw httpError(400, `${label} must be a whole number`);
    if (n < min) throw httpError(400, `${label} must be at least ${min}`);
    return n;
  };

  const parsedMilestones = Array.isArray(milestones)
    ? milestones.map((m) => ({
        count: positiveInt('Milestone count', m.count, { min: 1 }),
        bonusCoins: positiveInt('Milestone bonus coins', m.bonusCoins, { min: 1 }),
      })).sort((a, b) => a.count - b.count)
    : [];

  const payload = {
    isEnabled: Boolean(isEnabled),
    perReferralCoins: positiveInt('Per-referral coins', perReferralCoins, { min: 1 }),
    milestones: parsedMilestones,
    minQualifyingOrderValue: positiveInt('Minimum qualifying order value', minQualifyingOrderValue, { min: 0 }),
    refereeRewardCoins: positiveInt('Referee reward coins', refereeRewardCoins ?? 0, { min: 0 }),
    referralValidityDays: positiveInt('Referral validity (days)', referralValidityDays, { min: 1 }),
    maxReferralsPerUserPerMonth: positiveInt('Max referrals per user per month', maxReferralsPerUserPerMonth ?? 0, { min: 0 }),
    monthlyBudgetCoins: positiveInt('Monthly budget (coins)', monthlyBudgetCoins ?? 0, { min: 0 }),
    requireManualApprovalAbove: positiveInt('Manual approval threshold (coins)', requireManualApprovalAbove ?? 0, { min: 0 }),
    isActive: true,
    effectiveFrom: new Date(),
    updatedBy: req.user?._id,
    note,
  };

  const session = await mongoose.startSession();
  let createdRow;
  try {
    await session.withTransaction(async () => {
      await ReferralConfig.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });
      const [row] = await ReferralConfig.create([payload], { session });
      createdRow = row;
    });
  } finally {
    await session.endSession();
  }

  await loadReferralConfig();

  return ok(res, createdRow, 'Referral settings updated');
});

// @desc    Monitoring queue — every Referral, filterable by status/search
// @route   GET /api/admin/referrals?status=&search=&page=&limit=
// @access  Private/Admin
export const listReferralsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, search } = req.query;

  const filter = {};
  if (status && REFERRAL_STATUSES.includes(status)) filter.status = status;

  let referrerIds;
  if (search) {
    const matches = await User.find({
      $or: [{ name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }],
    }).select('_id').lean();
    referrerIds = matches.map((u) => u._id);
    filter.referrerId = { $in: referrerIds };
  }

  const [rows, total] = await Promise.all([
    Referral.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('referrerId', 'name phone')
      .populate('refereeId', 'name phone')
      .lean(),
    Referral.countDocuments(filter),
  ]);

  return paginated(res, rows, { page, limit, total });
});

// @desc    One referral's full detail
// @route   GET /api/admin/referrals/:id
// @access  Private/Admin
export const getReferralAdmin = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id)
    .populate('referrerId', 'name phone')
    .populate('refereeId', 'name phone')
    .populate('qualifyingOrderId', 'orderNo pricing status')
    .lean();
  if (!referral) throw httpError(404, 'Referral not found');
  return ok(res, referral);
});

// @desc    Reject a PENDING/QUALIFIED referral outright (fraud, duplicate, policy violation)
// @route   PATCH /api/admin/referrals/:id/block
// @access  Private/Admin
export const blockReferralAdmin = asyncHandler(async (req, res) => {
  const referral = await blockReferral(req.params.id, req.user?._id, req.body?.reason);
  return ok(res, referral, 'Referral blocked');
});

// @desc    Release a QUALIFIED referral held for manual approval — credits it now
// @route   PATCH /api/admin/referrals/:id/approve
// @access  Private/Admin
export const approveReferralAdmin = asyncHandler(async (req, res) => {
  const referral = await approveReferralPayout(req.params.id, req.user?._id);
  return ok(res, referral, 'Referral approved and credited');
});

/**
 * @desc    Admin's coin liability for the Referral Program — every coin
 *          issued under COIN_REFERENCE_TYPE.REFERRAL, this month and
 *          all-time, converted to ₹ via the live CoinConfig.coinValue.
 *          This is the visible half of "Admin bears the full cost".
 * @route   GET /api/admin/referrals/cost-report
 * @access  Private/Admin
 */
export const getReferralCostReport = asyncHandler(async (req, res) => {
  const coinConfig = getCoinConfig();
  const referralConfig = getReferralConfig();

  const startOfMonth = new Date();
  startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

  const [allTime, thisMonth, milestoneCount, successfulCount] = await Promise.all([
    CoinTransaction.aggregate([
      { $match: { referenceType: COIN_REFERENCE_TYPE.REFERRAL } },
      { $group: { _id: null, coins: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    CoinTransaction.aggregate([
      { $match: { referenceType: COIN_REFERENCE_TYPE.REFERRAL, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, coins: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    ReferralMilestone.countDocuments({}),
    Referral.countDocuments({ status: 'CREDITED' }),
  ]);

  const allTimeCoins = allTime[0]?.coins || 0;
  const thisMonthCoins = thisMonth[0]?.coins || 0;

  return ok(res, {
    coinValue: coinConfig.coinValue,
    monthlyBudgetCoins: referralConfig.monthlyBudgetCoins,
    allTime: { coins: allTimeCoins, rupees: allTimeCoins * coinConfig.coinValue, payoutCount: allTime[0]?.count || 0 },
    thisMonth: {
      coins: thisMonthCoins,
      rupees: thisMonthCoins * coinConfig.coinValue,
      payoutCount: thisMonth[0]?.count || 0,
      budgetRemainingCoins: referralConfig.monthlyBudgetCoins > 0 ? Math.max(0, referralConfig.monthlyBudgetCoins - thisMonthCoins) : null,
    },
    successfulReferrals: successfulCount,
    milestonesPaid: milestoneCount,
  });
});
