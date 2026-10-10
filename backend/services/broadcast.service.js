import mongoose from 'mongoose';
import NotificationBroadcast from '../models/NotificationBroadcast.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import SHGStore from '../models/SHGStore.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { httpError } from '../utils/response.js';
import { notifyUser, notifySeller, notifyShg, notifyRider, NOTIFICATION_EVENT } from './notification.service.js';

/**
 * Admin Push Notifications Broadcaster — the send-side engine. Reuses the
 * existing per-recipient notifyUser/notifySeller/notifyShg/notifyRider
 * (Notification row + socket + FCM) exactly the way any other business
 * event does; this file's only job is CAMPAIGN management: audience
 * resolution, batching, counts and the DRAFT->...->SENT lifecycle. It does
 * NOT introduce a second notification pipeline.
 */

const BATCH_SIZE = 50;
const LOCK_STALE_MS = 5 * 60 * 1000;

/* ============================================================================
 * DEEP LINK — server-side normalisation, never trusted verbatim (Section 15)
 * ========================================================================== */

const AUDIENCE_ROUTE_PREFIXES = {
  ALL_CUSTOMERS: ['/orders', '/subscriptions', '/returns', '/'],
  ALL_SELLERS: ['/seller/'],
  ALL_SHG: ['/shg/'],
  ALL_DELIVERY_PARTNERS: ['/delivery/'],
};

/** Rejects anything that isn't a same-origin path — the one thing that can never become an open redirect. */
export const sanitizeDeepLink = (link, audience) => {
  if (!link) return undefined;
  const trimmed = String(link).trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /^[a-z]+:/i.test(trimmed)) {
    throw httpError(400, 'Deep link must be a same-site path starting with /');
  }
  const allowed = AUDIENCE_ROUTE_PREFIXES[audience] || [];
  if (!allowed.some((p) => trimmed.startsWith(p))) {
    throw httpError(400, `That deep link doesn't look like a valid route for ${audience}`);
  }
  return trimmed;
};

/* ============================================================================
 * AUDIENCE RESOLUTION — always server-side, never a client-supplied id list
 * ========================================================================== */

/** @returns {Promise<import('mongoose').Types.ObjectId[]>} the underlying User ids for this audience */
export const resolveAudienceUserIds = async (targetAudience) => {
  switch (targetAudience) {
    case 'ALL_CUSTOMERS': {
      const users = await User.find({ roles: 'buyer' }).select('_id').lean();
      return users.map((u) => u._id);
    }
    case 'ALL_SELLERS': {
      const sellers = await Seller.find({ status: 'approved' }).select('userId').lean();
      return sellers.map((s) => s.userId).filter(Boolean);
    }
    case 'ALL_SHG': {
      const stores = await SHGStore.find({ status: 'approved' }).select('userId').lean();
      return stores.map((s) => s.userId).filter(Boolean);
    }
    case 'ALL_DELIVERY_PARTNERS': {
      const partners = await DeliveryPartner.find({ status: 'approved' }).select('userId').lean();
      return partners.map((p) => p.userId).filter(Boolean);
    }
    default:
      throw httpError(400, `Unknown target audience: ${targetAudience}`);
  }
};

/**
 * The vendor-record id (Seller/SHGStore/DeliveryPartner _id) for each
 * userId in this audience, when the audience is vendor-shaped — so sending
 * can call notifySeller/notifyShg/notifyRider (which target the vendor's
 * own socket room, e.g. `seller:<id>`) rather than the generic user room,
 * exactly matching how every other business event already notifies them.
 */
const resolveVendorSenders = async (targetAudience) => {
  if (targetAudience === 'ALL_CUSTOMERS') {
    const ids = await resolveAudienceUserIds('ALL_CUSTOMERS');
    return ids.map((userId) => ({ userId, send: (opts) => notifyUser(userId, opts) }));
  }
  if (targetAudience === 'ALL_SELLERS') {
    const rows = await Seller.find({ status: 'approved' }).select('_id userId').lean();
    return rows.filter((r) => r.userId).map((r) => ({ userId: r.userId, send: (opts) => notifySeller(r._id, opts) }));
  }
  if (targetAudience === 'ALL_SHG') {
    const rows = await SHGStore.find({ status: 'approved' }).select('_id userId').lean();
    return rows.filter((r) => r.userId).map((r) => ({ userId: r.userId, send: (opts) => notifyShg(r._id, opts) }));
  }
  if (targetAudience === 'ALL_DELIVERY_PARTNERS') {
    const rows = await DeliveryPartner.find({ status: 'approved' }).select('_id userId').lean();
    return rows.filter((r) => r.userId).map((r) => ({ userId: r.userId, send: (opts) => notifyRider(r._id, opts) }));
  }
  throw httpError(400, `Unknown target audience: ${targetAudience}`);
};

/* ============================================================================
 * CREATE
 * ========================================================================== */

export const createBroadcast = async ({ title, message, media, targetAudience, channels, deepLink, scheduledAt, adminId }) => {
  if (!title?.trim()) throw httpError(400, 'Title is required');
  if (!message?.trim()) throw httpError(400, 'Message is required');

  const safeChannels = (Array.isArray(channels) && channels.length ? channels : ['PUSH', 'SOCKET'])
    .filter((c) => ['PUSH', 'SOCKET', 'EMAIL', 'SMS'].includes(c));
  if (safeChannels.length === 0) throw httpError(400, 'At least one channel must be selected');

  const safeDeepLink = sanitizeDeepLink(deepLink, targetAudience);

  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduled && Number.isNaN(scheduled.getTime())) throw httpError(400, 'Invalid scheduledAt');

  const broadcast = await NotificationBroadcast.create({
    title: title.trim(),
    message: message.trim(),
    media: media || undefined,
    targetAudience,
    channels: safeChannels,
    deepLink: safeDeepLink,
    scheduledAt: scheduled || undefined,
    status: scheduled && scheduled > new Date() ? 'SCHEDULED' : 'DRAFT',
    createdBy: adminId,
  });

  // "Send Now" (no future schedule) fires immediately — a Draft otherwise
  // sits until an explicit send/schedule action.
  if (!scheduled) {
    sendBroadcastNow(broadcast._id).catch((e) => console.error('[BROADCAST] send failed:', e.message));
  }

  return broadcast;
};

/* ============================================================================
 * SEND — atomic claim, batched fan-out, idempotent
 * ========================================================================== */

/** Claim the send-lock, or return null if another attempt is already in flight (or already terminal). */
const claimForSending = async (broadcastId) => {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_STALE_MS);
  return NotificationBroadcast.findOneAndUpdate(
    {
      _id: broadcastId,
      status: { $in: ['DRAFT', 'SCHEDULED', 'FAILED', 'PARTIALLY_SENT'] },
      $or: [{ processingLockedAt: null }, { processingLockedAt: { $exists: false } }, { processingLockedAt: { $lt: staleCutoff } }],
    },
    { $set: { status: 'PROCESSING', processingLockedAt: now } },
    { new: true }
  );
};

/**
 * Sends (or safely retries) one broadcast. A retry re-resolves the
 * audience but SKIPS any recipient who already has a Notification row for
 * this broadcastId (Section 17/21) — so a retry after a partial failure
 * can never duplicate a copy for someone who already received one.
 */
export const sendBroadcastNow = async (broadcastId) => {
  if (!mongoose.Types.ObjectId.isValid(broadcastId)) throw httpError(400, 'Invalid broadcast id');

  const claimed = await claimForSending(broadcastId);
  if (!claimed) {
    const existing = await NotificationBroadcast.findById(broadcastId).lean();
    if (!existing) throw httpError(404, 'Broadcast not found');
    if (['SENT', 'CANCELLED'].includes(existing.status)) return existing; // idempotent no-op
    throw httpError(409, 'This broadcast is already being sent', { code: 'BROADCAST_IN_PROGRESS' });
  }

  try {
    const senders = await resolveVendorSenders(claimed.targetAudience);

    const alreadySent = new Set(
      (await Notification.find({ 'metadata.broadcastId': claimed._id }).select('userId').lean())
        .map((n) => String(n.userId))
    );
    const pending = senders.filter((s) => !alreadySent.has(String(s.userId)));

    let delivered = claimed.deliveredCount || 0;
    let failed = claimed.failedCount || 0;
    let pushSent = claimed.channelResults?.PUSH?.sent || 0;
    let pushFailed = claimed.channelResults?.PUSH?.failed || 0;
    let socketSent = claimed.channelResults?.SOCKET?.sent || 0;

    const media = claimed.media?.url ? { mediaType: claimed.media.mediaType, url: claimed.media.url, publicId: claimed.media.publicId, mimeType: claimed.media.mimeType, size: claimed.media.size } : undefined;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (recipient) => {
        try {
          const record = await recipient.send({
            event: NOTIFICATION_EVENT.ADMIN_BROADCAST,
            title: claimed.title,
            message: claimed.message,
            route: claimed.deepLink,
            media,
            metadata: { broadcastId: claimed._id },
          });
          return { ok: Boolean(record) };
        } catch (err) {
          console.error('[BROADCAST] recipient send failed:', err.message);
          return { ok: false };
        }
      }));

      for (const r of results) {
        if (r.ok) {
          delivered += 1;
          if (claimed.channels.includes('PUSH')) pushSent += 1;
          if (claimed.channels.includes('SOCKET')) socketSent += 1;
        } else {
          failed += 1;
          if (claimed.channels.includes('PUSH')) pushFailed += 1;
        }
      }
    }

    const recipientCount = senders.length;
    const status = failed === 0 ? 'SENT' : (delivered === 0 ? 'FAILED' : 'PARTIALLY_SENT');

    const updated = await NotificationBroadcast.findByIdAndUpdate(
      claimed._id,
      {
        $set: {
          status,
          recipientCount,
          deliveredCount: delivered,
          failedCount: failed,
          sentAt: new Date(),
          'channelResults.PUSH': claimed.channels.includes('PUSH') ? { sent: pushSent, failed: pushFailed } : claimed.channelResults?.PUSH,
          'channelResults.SOCKET': claimed.channels.includes('SOCKET') ? { sent: socketSent } : claimed.channelResults?.SOCKET,
          // Never faked — this codebase has no real email/SMS provider
          // (Section 9/19). Recorded honestly rather than claimed as sent.
          'channelResults.EMAIL': claimed.channels.includes('EMAIL') ? { status: 'NOT_CONFIGURED' } : claimed.channelResults?.EMAIL,
          'channelResults.SMS': claimed.channels.includes('SMS') ? { status: 'NOT_CONFIGURED' } : claimed.channelResults?.SMS,
        },
        $unset: { processingLockedAt: 1 },
      },
      { new: true }
    );

    return updated;
  } catch (err) {
    await NotificationBroadcast.findByIdAndUpdate(broadcastId, {
      $set: { status: 'FAILED', errorMessage: err.message },
      $unset: { processingLockedAt: 1 },
    });
    throw err;
  }
};

/* ============================================================================
 * SWEEPER — scheduled broadcasts whose time has come (reuses orderSweeper's timer)
 * ========================================================================== */

export const sweepScheduledBroadcastsOnce = async () => {
  const due = await NotificationBroadcast.find({ status: 'SCHEDULED', scheduledAt: { $lte: new Date() } })
    .select('_id').limit(20).lean();
  for (const b of due) {
    await sendBroadcastNow(b._id).catch((e) => console.error('[BROADCAST SWEEP] send failed:', e.message));
  }
};

/* ============================================================================
 * READ/OPEN TRACKING
 * ========================================================================== */

/**
 * `openRate` here means exactly what the rest of this product means by
 * "read" — `Notification.isRead`, flipped when the recipient opens/taps the
 * notification in their own drawer (services/notification.controller.js's
 * markNotificationRead). There is no separate click/impression tracker
 * anywhere in this codebase, so this is the honest, real metric — never a
 * fabricated analytics number.
 */
export const getBroadcastStats = async (broadcastId) => {
  const readCount = await Notification.countDocuments({ 'metadata.broadcastId': broadcastId, isRead: true });
  return { readCount };
};

/* ============================================================================
 * LIST / CANCEL / DELETE
 * ========================================================================== */

export const listBroadcasts = async ({ page = 1, limit = 20, status, audience, channel, search }) => {
  const filter = {};
  if (status) filter.status = status;
  if (audience) filter.targetAudience = audience;
  if (channel) filter.channels = channel;
  if (search) filter.title = new RegExp(search, 'i');

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    NotificationBroadcast.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name email').lean(),
    NotificationBroadcast.countDocuments(filter),
  ]);

  const withStats = await Promise.all(rows.map(async (b) => {
    const { readCount } = await getBroadcastStats(b._id);
    const openRate = b.deliveredCount > 0 ? Math.round((readCount / b.deliveredCount) * 1000) / 10 : 0;
    return { ...b, readCount, openRate };
  }));

  return { rows: withStats, total };
};

export const cancelScheduledBroadcast = async (broadcastId) => {
  const updated = await NotificationBroadcast.findOneAndUpdate(
    { _id: broadcastId, status: { $in: ['DRAFT', 'SCHEDULED'] } },
    { $set: { status: 'CANCELLED' } },
    { new: true }
  );
  if (!updated) throw httpError(400, 'Only a Draft or Scheduled broadcast can be cancelled', { code: 'INVALID_BROADCAST_TRANSITION' });
  return updated;
};

export const deleteDraftBroadcast = async (broadcastId) => {
  const result = await NotificationBroadcast.deleteOne({ _id: broadcastId, status: 'DRAFT' });
  if (result.deletedCount === 0) throw httpError(400, 'Only a Draft broadcast can be deleted', { code: 'INVALID_BROADCAST_TRANSITION' });
};
