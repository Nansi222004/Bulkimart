import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { listReturnPolicies as listPolicies, upsertReturnPolicy as upsertPolicy } from '../services/returnPolicy.service.js';
import { getGlobalReturnPolicy, saveGlobalReturnPolicy } from '../services/returnPolicy.service.js';
import { RETURN_POLICY_MAX_WINDOW_DAYS } from '../constants/enums.js';

/**
 * Admin — Category Return Policy (Phase 2 foundation). Thin controller;
 * all resolution/validation logic lives in returnPolicy.service.js.
 */

// @desc    Every header category with its configured return policy (or null)
// @route   GET /api/admin/return-policies
// @access  Private/Admin
export const listReturnPolicies = asyncHandler(async (req, res) => {
  const rows = await listPolicies();
  return ok(res, rows, '', { globalPolicy: await getGlobalReturnPolicy(), maxWindowDays: RETURN_POLICY_MAX_WINDOW_DAYS });
});

export const updateGlobalReturnPolicy = asyncHandler(async (req, res) => {
  const policy = await saveGlobalReturnPolicy({ returnWindowDays: req.body.returnWindowDays, isActive: req.body.isActive, version: req.body.version, adminId: req.user._id });
  return ok(res, policy, 'Global return window saved. Categories with no policy can use this limit when the seller enables returns. Existing orders are unchanged.');
});

// @desc    Create/update the return-window policy for one header category
// @route   PATCH /api/admin/return-policies/:categoryId
// @access  Private/Admin
export const upsertReturnPolicy = asyncHandler(async (req, res) => {
  const policy = await upsertPolicy({
    categoryId: req.params.categoryId,
    returnWindowDays: req.body.returnWindowDays,
    isActive: req.body.isActive,
    adminId: req.user._id,
  });
  return ok(res, policy, 'Return policy saved — this applies to new orders only; existing orders keep their original policy.');
});
