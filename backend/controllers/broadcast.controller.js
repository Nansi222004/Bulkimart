import mongoose from 'mongoose';
import NotificationBroadcast from '../models/NotificationBroadcast.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { uploadFileWithMeta } from '../services/cloudinary.service.js';
import {
  createBroadcast, sendBroadcastNow, listBroadcasts, cancelScheduledBroadcast, deleteDraftBroadcast,
} from '../services/broadcast.service.js';

/**
 * Admin Push Notifications Broadcaster — thin controller; the actual
 * audience resolution/fan-out/idempotency lives in services/broadcast.service.js.
 */

// @desc    Create (and, unless scheduled, immediately send) a broadcast
// @route   POST /api/admin/broadcasts
// @access  Private/Admin
export const createBroadcastAdmin = asyncHandler(async (req, res) => {
  const { title, message, targetAudience, channels, deepLink, scheduledAt } = req.body;

  let media;
  if (req.file) {
    const meta = await uploadFileWithMeta(req.file.buffer, 'notifications');
    media = { mediaType: 'IMAGE', url: meta.url, publicId: meta.publicId, mimeType: req.file.mimetype, size: req.file.size };
  }

  const parsedChannels = channels ? (typeof channels === 'string' ? JSON.parse(channels) : channels) : undefined;

  const broadcast = await createBroadcast({
    title, message, media, targetAudience, channels: parsedChannels, deepLink, scheduledAt, adminId: req.user._id,
  });

  return created(res, broadcast, broadcast.status === 'SCHEDULED' ? 'Broadcast scheduled' : 'Broadcast is being sent');
});

// @desc    List broadcasts — searchable/filterable
// @route   GET /api/admin/broadcasts
// @access  Private/Admin
export const listBroadcastsAdmin = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req.query);
  const { status, audience, channel, search } = req.query;
  const { rows, total } = await listBroadcasts({ page, limit, status, audience, channel, search });
  return paginated(res, rows, { page, limit, total });
});

// @desc    One broadcast, in detail
// @route   GET /api/admin/broadcasts/:id
// @access  Private/Admin
export const getBroadcastAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid broadcast id');
  const broadcast = await NotificationBroadcast.findById(req.params.id).populate('createdBy', 'name email').lean();
  if (!broadcast) throw httpError(404, 'Broadcast not found');
  return ok(res, broadcast);
});

// @desc    Manually (re)send a Draft/Scheduled/Failed/Partially-sent broadcast
// @route   POST /api/admin/broadcasts/:id/send
// @access  Private/Admin
export const sendBroadcastAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid broadcast id');
  const broadcast = await sendBroadcastNow(req.params.id);
  return ok(res, broadcast, `Broadcast is now ${broadcast.status}`);
});

// @desc    Cancel a Draft/Scheduled broadcast before it sends
// @route   PATCH /api/admin/broadcasts/:id/cancel
// @access  Private/Admin
export const cancelBroadcastAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid broadcast id');
  const broadcast = await cancelScheduledBroadcast(req.params.id);
  return ok(res, broadcast, 'Broadcast cancelled');
});

// @desc    Delete a Draft broadcast
// @route   DELETE /api/admin/broadcasts/:id
// @access  Private/Admin
export const deleteBroadcastAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid broadcast id');
  await deleteDraftBroadcast(req.params.id);
  return ok(res, {}, 'Draft deleted');
});

// @desc    CSV export of broadcast records (backend-owned dataset, not
//          just whatever rows the frontend currently has loaded)
// @route   GET /api/admin/broadcasts/export
// @access  Private/Admin
export const exportBroadcastsCsvAdmin = asyncHandler(async (req, res) => {
  const { status, audience, channel, search } = req.query;
  const { rows } = await listBroadcasts({ page: 1, limit: 1000, status, audience, channel, search });

  const header = ['Broadcast ID', 'Title', 'Audience', 'Channels', 'Status', 'Created At', 'Scheduled At', 'Sent At', 'Recipient Count', 'Delivered Count', 'Failed Count', 'Read Count', 'Open Rate'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const b of rows) {
    lines.push([
      b._id, escape(b.title), b.targetAudience, escape((b.channels || []).join('|')), b.status,
      b.createdAt ? new Date(b.createdAt).toISOString() : '', b.scheduledAt ? new Date(b.scheduledAt).toISOString() : '',
      b.sentAt ? new Date(b.sentAt).toISOString() : '', b.recipientCount, b.deliveredCount, b.failedCount, b.readCount, b.openRate,
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="broadcasts.csv"');
  res.status(200).send(lines.join('\n'));
});
