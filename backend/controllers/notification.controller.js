import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import { asyncHandler } from "../middlewares/error.middleware.js";
import { ok, paginated, getPagination, httpError } from "../utils/response.js";
import { registerPushToken, removePushToken } from "../services/notification.service.js";

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
  const tokenPlatform = await registerPushToken(req.user._id, token, platform);
  ok(res, { platform: tokenPlatform }, "Push token saved");
});

// @desc    Remove/deactivate one of the caller's device tokens (e.g. on
//          logout for that device — other devices' tokens are untouched).
// @route   DELETE /api/notifications/tokens/:token
// @access  Private
export const deleteFcmToken = asyncHandler(async (req, res) => {
  await removePushToken(req.user._id, req.params.token);
  ok(res, {}, "Push token removed");
});

// @desc    List the caller's own notifications, newest first, paginated.
// @route   GET /api/notifications
// @access  Private
export const getMyNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, 20, 50);
  // req.user._id — never a client-supplied id — is the only identity this
  // query is ever scoped to, so one user can never page into another's list.
  const filter = { userId: req.user._id };
  if (req.query.isRead === "true") filter.isRead = true;
  if (req.query.isRead === "false") filter.isRead = false;

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
  const count = await Notification.countDocuments({ userId: req.user._id, isRead: false });
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
    { new: true }
  );
  if (!notification) throw httpError(404, "Notification not found");

  ok(res, notification, "Marked as read");
});

// @desc    Mark all of the caller's own notifications read.
// @route   PATCH /api/notifications/read-all
// @access  Private
export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { userId: req.user._id, isRead: false },
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
