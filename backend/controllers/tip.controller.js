import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import TipSetting from '../models/TipSetting.js';
import { getTipSetting, loadTipSetting, invalidateTipSetting } from '../services/tip.service.js';

/**
 * @desc    Get active tip settings for Customer Checkout Page
 * @route   GET /api/tip-setting
 * @access  Public
 */
export const getTipSettingPublic = asyncHandler(async (req, res) => {
  const setting = await loadTipSetting();
  res.json({
    success: true,
    data: setting,
  });
});

/**
 * @desc    Get current active tip settings + audit history for Admin Panel
 * @route   GET /api/admin/tip-setting
 * @access  Private (Admin)
 */
export const getTipSettingForAdmin = asyncHandler(async (req, res) => {
  const active = await TipSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await TipSetting.find()
    .populate('updatedBy', 'name email role')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const live = getTipSetting();

  res.json({
    success: true,
    data: {
      active: active || live,
      history,
    },
  });
});

/**
 * @desc    Update active tip settings from Admin Panel
 * @route   POST /api/admin/tip-setting
 * @access  Private (Admin)
 */
export const setTipSettingForAdmin = asyncHandler(async (req, res) => {
  const {
    isEnabled,
    title,
    subtitle,
    options,
    allowCustom,
    minCustomAmount,
    maxCustomAmount,
  } = req.body;

  // Sanitize and validate options
  let sanitizedOptions = Array.isArray(options)
    ? options
        .map((n) => Math.max(1, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [10, 20, 30, 40, 50];

  // Remove duplicates and sort ascending
  sanitizedOptions = [...new Set(sanitizedOptions)].sort((a, b) => a - b);

  if (isEnabled && sanitizedOptions.length === 0) {
    res.status(400);
    throw new Error('At least one valid tip amount option is required when tip section is enabled.');
  }

  const minAmt = Math.max(1, Math.floor(Number(minCustomAmount) || 1));
  const maxAmt = Math.max(minAmt + 1, Math.floor(Number(maxCustomAmount) || 1000));

  const adminId = req.user?._id;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Deactivate older settings
      await TipSetting.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });

      // Create new active setting
      await TipSetting.create(
        [
          {
            isEnabled: Boolean(isEnabled),
            title: title?.trim() || 'Tip your delivery partner',
            subtitle: subtitle?.trim() || "100% of your tip goes to them. We don't take a cut.",
            options: sanitizedOptions,
            allowCustom: Boolean(allowCustom),
            minCustomAmount: minAmt,
            maxCustomAmount: maxAmt,
            isActive: true,
            updatedBy: adminId,
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  // Refresh service cache immediately
  invalidateTipSetting();
  const updatedSetting = await loadTipSetting();

  res.json({
    success: true,
    message: 'Tip settings updated successfully.',
    data: updatedSetting,
  });
});
