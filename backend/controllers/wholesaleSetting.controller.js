import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import WholesaleSetting from '../models/WholesaleSetting.js';
import { loadWholesaleSetting, parseWholesaleSettingInput } from '../services/wholesaleMinimum.service.js';

// GET /api/admin/wholesale/settings -> the active rule (default ₹5,000 until first saved) and recent changes
export const getWholesaleSettingForAdmin = asyncHandler(async (_req, res) => {
  const [active, history] = await Promise.all([
    loadWholesaleSetting(),
    WholesaleSetting.find().populate('updatedBy', 'name email').sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return ok(res, { active, history });
});

// POST /api/admin/wholesale/settings { minOrderValue } (0 = no minimum)
export const setWholesaleSettingForAdmin = asyncHandler(async (req, res) => {
  const values = parseWholesaleSettingInput(req.body);
  await WholesaleSetting.updateMany({ isActive: true }, { $set: { isActive: false } });
  await WholesaleSetting.create({ ...values, isActive: true, updatedBy: req.user?._id });
  return ok(res, await loadWholesaleSetting(), values.minOrderValue > 0 ? `Wholesale minimum order value set to ₹${values.minOrderValue}` : 'Wholesale minimum order value removed');
});
