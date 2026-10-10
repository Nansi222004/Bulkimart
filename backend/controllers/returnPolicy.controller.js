import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { listReturnPolicies as listPolicies, upsertReturnPolicy as upsertPolicy } from '../services/returnPolicy.service.js';

/**
 * Admin — Category Return Policy (Phase 2 foundation). Thin controller;
 * all resolution/validation logic lives in returnPolicy.service.js.
 */

// @desc    Every header category with its configured return policy (or null)
// @route   GET /api/admin/return-policies
// @access  Private/Admin
export const listReturnPolicies = asyncHandler(async (req, res) => {
  const rows = await listPolicies();
  return ok(res, rows);
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
