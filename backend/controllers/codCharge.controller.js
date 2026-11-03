import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import CodChargeSetting from '../models/CodChargeSetting.js';
import { loadCodChargeSetting, parseCodChargeInput, publicCodCharge } from '../services/codCharge.service.js';

// @desc    Active COD fee rule, for checkout to explain the fee before ordering
// @route   GET /api/cod-charge
// @access  Public
export const getCodChargePublic = asyncHandler(async (req, res) => ok(res, publicCodCharge(await loadCodChargeSetting())));

// @desc    Active COD fee rule + change history
// @route   GET /api/admin/cod-charge
// @access  Admin (finance)
export const getCodChargeForAdmin = asyncHandler(async (req, res) => {
  const [active, history] = await Promise.all([
    loadCodChargeSetting(),
    CodChargeSetting.find().populate('updatedBy', 'name email').sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  return ok(res, { active, history });
});

// @desc    Save a new COD fee rule (new version; existing orders keep their own snapshot)
// @route   POST /api/admin/cod-charge
// @access  Admin (finance)
export const setCodChargeForAdmin = asyncHandler(async (req, res) => {
  const input = parseCodChargeInput(req.body);
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      await CodChargeSetting.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });
      [created] = await CodChargeSetting.create([{ ...input, isActive: true, updatedBy: req.user?._id, note: String(req.body.note || '').trim().slice(0, 300) || undefined }], { session });
    });
  } finally {
    await session.endSession();
  }
  // The next checkout must use the new rule immediately, not after the cache TTL.
  const active = await loadCodChargeSetting();
  return ok(res, { active, savedId: created._id }, input.isEnabled ? 'COD charges updated' : 'COD charges switched off');
});
