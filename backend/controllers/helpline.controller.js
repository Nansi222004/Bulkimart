import { asyncHandler } from "../middlewares/error.middleware.js";
import { ok, httpError } from "../utils/response.js";
import {
  getActiveHelplineSetting,
  getHelplineSettingForAdmin,
  saveHelplineSettingFromAdmin,
} from "../services/helpline.service.js";

/**
 * @desc    Get active platform helpline & emergency settings (Public for Rider/Seller/Customer apps)
 * @route   GET /api/helpline
 * @access  Public
 */
export const getPublicHelpline = asyncHandler(async (req, res) => {
  const data = await getActiveHelplineSetting();
  return ok(res, data);
});

/**
 * @desc    Get helpline settings and version history (For Admin panel)
 * @route   GET /api/admin/helpline-setting
 * @access  Private/Admin
 */
export const getAdminHelpline = asyncHandler(async (req, res) => {
  const data = await getHelplineSettingForAdmin();
  return ok(res, data);
});

/**
 * @desc    Update platform helpline & SOS settings (Admin)
 * @route   POST /api/admin/helpline-setting
 * @access  Private/Admin
 */
export const updateAdminHelpline = asyncHandler(async (req, res) => {
  const {
    sosEmergencyNumber,
    bulkimartHelplineNumber,
    sellerHelplineNumber,
    riderHelplineNumber,
    description,
  } = req.body || {};

  try {
    const updated = await saveHelplineSettingFromAdmin({
      sosEmergencyNumber,
      bulkimartHelplineNumber,
      sellerHelplineNumber,
      riderHelplineNumber,
      description,
      adminUserId: req.admin?._id || req.user?._id,
    });
    return ok(res, updated, "Helpline settings updated successfully");
  } catch (err) {
    throw httpError(400, err.message || "Failed to update helpline settings");
  }
});
