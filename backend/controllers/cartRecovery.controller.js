import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { httpError } from '../utils/response.js';
import CartReminderSetting from '../models/CartReminderSetting.js';
import {
  listAbandonedCarts, abandonedCartDetail, cartRecoveryStats, sendCartReminders, abandonedCartUserIds,
  getCartReminderSetting, validateCartReminderSetting,
} from '../services/cartRecovery.service.js';

const filtersFrom = (src = {}) => ({
  inactiveHours: src.inactiveHours, channel: src.channel || undefined, minValue: src.minValue,
  reminded: ['yes', 'no'].includes(src.reminded) ? src.reminded : undefined, q: src.q,
});

// GET /api/admin/abandoned-carts?inactiveHours&channel&minValue&reminded&q&page&limit
export const listAbandonedCartsAdmin = asyncHandler(async (req, res) => {
  return ok(res, await listAbandonedCarts({ ...filtersFrom(req.query), page: req.query.page, limit: req.query.limit }));
});

// GET /api/admin/abandoned-carts/stats?inactiveHours
export const abandonedCartStatsAdmin = asyncHandler(async (req, res) => {
  return ok(res, await cartRecoveryStats({ inactiveHours: req.query.inactiveHours }));
});

// GET /api/admin/abandoned-carts/:userId -> cart items, add/remove history, reminders, recent orders
export const abandonedCartDetailAdmin = asyncHandler(async (req, res) => ok(res, await abandonedCartDetail(req.params.userId)));

// POST /api/admin/abandoned-carts/remind { userIds:[...] | filters:{...}, title?, message? }
export const remindAbandonedCartsAdmin = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let userIds = Array.isArray(body.userIds) ? body.userIds : [];
  if (!userIds.length && body.filters && typeof body.filters === 'object') userIds = await abandonedCartUserIds(filtersFrom(body.filters));
  if (!userIds.length) throw httpError(400, 'No customers to remind');
  const result = await sendCartReminders({ userIds, title: body.title, message: body.message, source: 'admin', adminId: req.user?._id });
  const skipped = result.skipped.length;
  return ok(res, result, `${result.sent} reminder${result.sent === 1 ? '' : 's'} sent${skipped ? ` · ${skipped} skipped` : ''}`);
});

// GET / POST /api/admin/abandoned-carts/settings
export const getCartReminderSettingAdmin = asyncHandler(async (_req, res) => ok(res, await getCartReminderSetting()));
export const setCartReminderSettingAdmin = asyncHandler(async (req, res) => {
  const values = validateCartReminderSetting(req.body);
  await CartReminderSetting.updateMany({ isActive: true }, { $set: { isActive: false } });
  await CartReminderSetting.create({ ...values, isActive: true, updatedBy: req.user?._id });
  return ok(res, await getCartReminderSetting(), 'Reminder settings saved');
});
