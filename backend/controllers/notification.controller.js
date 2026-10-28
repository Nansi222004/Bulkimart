import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import { asyncHandler } from "../middlewares/error.middleware.js";
import { ok, paginated, getPagination, httpError } from "../utils/response.js";
import { registerPushToken, removePushToken } from "../services/notification.service.js";

// Historical rows remain untouched, but retired-program messages no longer
// appear in customer notification lists or unread badges.
const RETIRED_EVENT_TYPES = [
  'SELLER_PROMOTION_UPDATE',
  'REFERRAL_SIGNUP',
  'REFERRAL_REWARD_CREDITED',
  'REFERRAL_MILESTONE_REACHED',
];

// One login can shop, sell and ride. Each app lists only what was sent to it: by `audience`,
// or, for rows written before that field existed, by the app the route opens.
const CUSTOMER_ONLY_ROUTE = /^\/(?:parcel-delivery|legal-services|coins|profile|wallet)(?:[/?#]|$)/i;
const PARTNER_ROUTE = /^\/(?:seller|delivery|admin)(?:[/?#]|$)/i;

// Filter historical seller-program messages without changing stored records.
const visibleNotifications = req => ({
  userId: req.user._id,
  event: { $nin: RETIRED_EVENT_TYPES },
  ...(req.tokenRole === 'delivery' ? { route: /^\/delivery(?:\/|$)/ } : {}),
  ...(req.tokenRole === 'seller' ? { $nor: [
    { event: { $in: ['CAMPAIGN_UPDATE', 'SELLER_PROMOTION_UPDATE'] } },
    { type: 'promotion' },
    { route: /^\/(?:seller\/)?(?:promotions|campaigns|deals|advertisements|grow)(?:[/?#]|$)/i },
    { audience: { $in: ['user', 'rider'] } },
    { audience: { $exists: false }, route: CUSTOMER_ONLY_ROUTE },
  ] } : {}),
  ...(req.userType === 'user' && !['seller', 'delivery'].includes(req.tokenRole) ? { $nor: [
    { audience: { $in: ['seller', 'rider'] } },
    { audience: { $exists: false }, route: PARTNER_ROUTE },
  ] } : {}),
});

async function visibleNotificationFilter(req) {
  const filter = visibleNotifications(req);
  if (req.tokenRole !== 'seller') return filter;
  const seller = await Seller.findOne({ userId: req.user._id }).select('_id').lean();
  if (!seller) return filter;
  // Old builds may have persisted premature alerts. Do not delete history,
  // but prevent those rows inflating the seller badge or reappearing as work.
  const unpaid = await Order.aggregate([
    { $match: { 'items.sellerId': seller._id, paymentMethod: { $ne: 'cod' } } },
    { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id', as: 'payment' } },
    { $match: { 'payment.status': { $nin: ['paid', 'partial_refund', 'refunded'] } } }, { $project: { _id: 1 } },
  ]);
  if (unpaid.length) filter.$nor.push({ event: 'ORDER_CREATED', 'metadata.orderId': { $in: unpaid.map(o => o._id) } });
  return filter;
}

// @desc    Register/refresh the caller's device push token (upserts by token
//          value, so re-registering the same device just bumps lastUsedAt
//          instead of creating a duplicate entry). Multi-device: a user may
//          hold several active tokens at once.
// @route   POST /api/notifications/tokens
// @access  Private
export const saveFcmToken = asyncHandler(async (req, res) => {
  const { token, platform } = req.body;
  if (!token) {
    res.status(400);
    throw new Error("Please provide a push token");
  }
  const tokenPlatform = await registerPushToken(req.user._id, token, platform, req.tokenRole || (req.userType === 'user' ? 'buyer' : undefined));
  ok(res, { platform: tokenPlatform }, "Push token saved");
});

// @desc    Remove/deactivate one of the caller's device tokens (e.g. on
//          logout for that device — other devices' tokens are untouched).
// @route   DELETE /api/notifications/tokens/:token
// @access  Private
export const deleteFcmToken = asyncHandler(async (req, res) => {
  await removePushToken(req.user._id, req.params.token, req.tokenRole || (req.userType === 'user' ? 'buyer' : undefined));
  ok(res, {}, "Push token removed");
});

// @desc    List the caller's own notifications, newest first, paginated.
// @route   GET /api/notifications
// @access  Private
export const getMyNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, 20, 50);
  // req.user._id — never a client-supplied id — is the only identity this
  // query is ever scoped to, so one user can never page into another's list.
  const filter = await visibleNotificationFilter(req);
  if (req.query.isRead === "true") filter.isRead = true;
  if (req.query.isRead === "false") filter.isRead = false;
  if (req.query.event) {
    if (req.query.event !== 'ORDER_CREATED') throw httpError(400, 'Unsupported notification event filter');
    filter.event = 'ORDER_CREATED';
  }

  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  paginated(res, items, { page, limit, total });
});

// @desc    Count of the caller's unread notifications.
// @route   GET /api/notifications/unread-count
// @access  Private
export const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({
    ...await visibleNotificationFilter(req),
    isRead: false,
  });
  ok(res, { count });
});

// @desc    Mark one of the caller's own notifications read.
// @route   PATCH /api/notifications/:id/read
// @access  Private
export const markNotificationRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Invalid notification id");

  // Scoped to the caller's own userId in the filter itself, not checked
  // after the fact — a ownership mismatch simply matches nothing, the same
  // way a not-found row would, so no other user's notification is ever
  // revealed to exist by a differently-shaped error.
  const notification = await Notification.findOneAndUpdate(
    { _id: id, userId: req.user._id },
    { $set: { isRead: true } },
    { returnDocument: 'after' }
  );
  if (!notification) throw httpError(404, "Notification not found");

  ok(res, notification, "Marked as read");
});

// @desc    Mark all of the caller's own notifications read.
// @route   PATCH /api/notifications/read-all
// @access  Private
export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    // Only this app's list: "mark all read" in the seller app leaves the customer app's unread badge alone.
    { ...await visibleNotificationFilter(req), isRead: false },
    { $set: { isRead: true } }
  );
  ok(res, { modified: result.modifiedCount }, "All notifications marked as read");
});

// @desc    Delete one of the caller's own notifications.
// @route   DELETE /api/notifications/:id
// @access  Private
export const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Invalid notification id");

  const result = await Notification.deleteOne({ _id: id, userId: req.user._id });
  if (result.deletedCount === 0) throw httpError(404, "Notification not found");

  ok(res, {}, "Notification deleted");
});
