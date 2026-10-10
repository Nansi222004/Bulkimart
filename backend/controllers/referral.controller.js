import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import {
  getMyReferralSummary, listMyReferrals, validateReferralCode,
} from '../services/referral.service.js';

/**
 * NHCONE Referral Program — customer-facing endpoints. Thin by design,
 * same shape as coin.controller.js: everything that resolves/pays a
 * referral lives in referral.service.js's sweeper, never on a route a
 * browser calls directly.
 */

// @desc    My referral code, stats, and coins earned
// @route   GET /api/referrals/me
// @access  Private
export const getMyReferral = asyncHandler(async (req, res) => {
  const summary = await getMyReferralSummary(req.user._id);
  return ok(res, summary);
});

// @desc    My list of referred friends (masked names/phones), optionally filtered by status
// @route   GET /api/referrals/list?status=
// @access  Private
export const getMyReferralsList = asyncHandler(async (req, res) => {
  const rows = await listMyReferrals(req.user._id, { status: req.query.status });
  return ok(res, rows);
});

// @desc    Check a referral code before signup — public, no auth (the referee doesn't have an account yet)
// @route   POST /api/referrals/validate
// @access  Public
export const validateCode = asyncHandler(async (req, res) => {
  const result = await validateReferralCode(req.body.referralCode);
  return ok(res, result);
});
