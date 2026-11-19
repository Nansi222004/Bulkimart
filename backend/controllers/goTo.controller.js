import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import GoToSetting from '../models/GoToSetting.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { getGoToSetting, loadGoToSetting, validateGoToSetting, goToView, startGoTo, stopGoTo } from '../services/goTo.service.js';

// ---------------------------------------------------------------- rider
// GET /api/delivery/go-to -> settings, today's uses and the active destination (if any)
export const getMyGoTo = asyncHandler(async (req, res) => {
  const rider = await DeliveryPartner.findById(req.partner._id).select('goTo goToUsage').lean();
  return ok(res, goToView(rider, await loadGoToSetting()));
});

// POST /api/delivery/go-to { origin:{lat,lng}, destination:{lat,lng}, address }
export const startMyGoTo = asyncHandler(async (req, res) => {
  const { origin, destination, address } = req.body || {};
  const view = await startGoTo(req.partner._id, { origin, destination, address });
  return ok(res, view, 'Go To is on. You will get orders along your route.');
});

// DELETE /api/delivery/go-to
export const stopMyGoTo = asyncHandler(async (req, res) => ok(res, await stopGoTo(req.partner._id), 'Go To is off.'));

// ---------------------------------------------------------------- admin
export const getGoToSettingForAdmin = asyncHandler(async (_req, res) => {
  const active = await GoToSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await GoToSetting.find().populate('updatedBy', 'name email').sort({ createdAt: -1 }).limit(20).lean();
  return ok(res, { active: active || getGoToSetting(), history });
});

export const setGoToSettingForAdmin = asyncHandler(async (req, res) => {
  const values = validateGoToSetting(req.body);
  await GoToSetting.updateMany({ isActive: true }, { $set: { isActive: false } });
  const row = await GoToSetting.create({ ...values, isActive: true, updatedBy: req.user?._id });
  await loadGoToSetting();
  return ok(res, row, 'Go To settings saved');
});
