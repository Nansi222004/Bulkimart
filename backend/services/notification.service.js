// notification.service.js — the single entry point for a business event to
// reach a user: persist it (source of truth), fan it out over Socket.io
// (real-time, best-effort) and FCM (background/offline push, best-effort).
//
// Callers already wrap their business writes in their own try/catch outside
// the DB transaction (see order.controller.js, deliveryPartner.controller.js,
// etc.) — this service follows the exact same discipline internally, so a
// controller can call notifyUser/notifySeller/notifyRider unguarded without
// risking the business transaction that triggered it. Nothing in here ever
// throws back to the caller.
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { sendPushNotification, sendBulkNotification } from './fcm.service.js';

// Fine-grained business-event constants — stored on Notification.event.
export const NOTIFICATION_EVENT = {
  PARCEL_UPDATED: 'PARCEL_UPDATED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_STATUS_UPDATED: 'ORDER_STATUS_UPDATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  RIDER_ASSIGNED: 'RIDER_ASSIGNED',
  OTP_READY: 'OTP_READY',
  DELIVERY_DELAYED: 'DELIVERY_DELAYED',
  NO_RIDER_FOUND: 'NO_RIDER_FOUND',
  RIDER_PING: 'RIDER_PING',
  // Seller picked a specific rider for an order / that rider turned it down.
  RIDER_REQUESTED: 'RIDER_REQUESTED',
  RIDER_DECLINED: 'RIDER_DECLINED',
  CAMPAIGN_UPDATE: 'CAMPAIGN_UPDATE',
  SELLER_PROMOTION_UPDATE: 'SELLER_PROMOTION_UPDATE',
  SYSTEM: 'SYSTEM',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_REPLY: 'TICKET_REPLY',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  TICKET_RESOLVED: 'TICKET_RESOLVED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  TICKET_REOPENED: 'TICKET_REOPENED',
  PAYOUT_REQUESTED: 'PAYOUT_REQUESTED',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  PAYOUT_REJECTED: 'PAYOUT_REJECTED',
  PACKAGING_ORDER_CREATED: 'PACKAGING_ORDER_CREATED',
  PACKAGING_PAYMENT_CONFIRMED: 'PACKAGING_PAYMENT_CONFIRMED',
  PACKAGING_ORDER_PROCESSING: 'PACKAGING_ORDER_PROCESSING',
  PACKAGING_ORDER_CANCELLED: 'PACKAGING_ORDER_CANCELLED',
  COINS_EARNED: 'COINS_EARNED',
  COINS_USED: 'COINS_USED',
  COINS_REFUNDED: 'COINS_REFUNDED',
  COINS_REVERSED: 'COINS_REVERSED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURN_UNDER_REVIEW: 'RETURN_UNDER_REVIEW',
  RETURN_APPROVED: 'RETURN_APPROVED',
  RETURN_REJECTED: 'RETURN_REJECTED',
  RETURN_RECEIVED: 'RETURN_RECEIVED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REFUND_FAILED: 'REFUND_FAILED',
  // Quick Commerce reverse-pickup (customer -> rider -> seller) — additive,
  // reuses this same notifyUser/notifySeller/notifyRider entry point.
  RETURN_PICKUP_OFFERED: 'RETURN_PICKUP_OFFERED',
  RETURN_PICKUP_NO_RIDER: 'RETURN_PICKUP_NO_RIDER',
  RETURN_PICKUP_ASSIGNED: 'RETURN_PICKUP_ASSIGNED',
  RETURN_PICKUP_OTP_READY: 'RETURN_PICKUP_OTP_READY',
  RETURN_PICKED_UP: 'RETURN_PICKED_UP',
  RETURN_DELIVERED_TO_SELLER: 'RETURN_DELIVERED_TO_SELLER',
  // Rider COD cash handover: reported to admins, settled back to the rider.
  COD_HANDOVER_REPORTED: 'COD_HANDOVER_REPORTED',
  COD_CASH_SETTLED: 'COD_CASH_SETTLED',
  // Admin Push Notifications Broadcaster — a marketing/informational
  // message an admin composed, never a business event.
  ADMIN_BROADCAST: 'ADMIN_BROADCAST',
};

// Maps a fine-grained event to the model's existing (pre-established) coarse
// `type` enum, so every already-written row and any query against `type`
// keeps working unchanged.
const EVENT_CATEGORY = {
  PARCEL_UPDATED: 'delivery',
  ORDER_CREATED: 'order',
  ORDER_STATUS_UPDATED: 'order',
  ORDER_CANCELLED: 'order',
  ORDER_DELIVERED: 'order',
  RIDER_ASSIGNED: 'delivery',
  OTP_READY: 'delivery',
  DELIVERY_DELAYED: 'delivery',
  NO_RIDER_FOUND: 'delivery',
  RIDER_PING: 'delivery',
  RIDER_REQUESTED: 'delivery',
  RIDER_DECLINED: 'delivery',
  CAMPAIGN_UPDATE: 'promotion',
  SELLER_PROMOTION_UPDATE: 'promotion',
  SYSTEM: 'system',
  TICKET_CREATED: 'system',
  TICKET_ASSIGNED: 'system',
  TICKET_REPLY: 'system',
  TICKET_STATUS_CHANGED: 'system',
  TICKET_RESOLVED: 'system',
  TICKET_CLOSED: 'system',
  TICKET_REOPENED: 'system',
  PAYOUT_REQUESTED: 'delivery',
  PAYOUT_COMPLETED: 'delivery',
  PAYOUT_REJECTED: 'delivery',
  PACKAGING_ORDER_CREATED: 'system',
  PACKAGING_PAYMENT_CONFIRMED: 'system',
  PACKAGING_ORDER_PROCESSING: 'system',
  PACKAGING_ORDER_CANCELLED: 'system',
  COINS_EARNED: 'system',
  COINS_USED: 'system',
  COINS_REFUNDED: 'system',
  COINS_REVERSED: 'system',
  RETURN_REQUESTED: 'system',
  RETURN_UNDER_REVIEW: 'system',
  RETURN_APPROVED: 'system',
  RETURN_REJECTED: 'system',
  RETURN_RECEIVED: 'system',
  REFUND_PENDING: 'system',
  REFUND_COMPLETED: 'system',
  REFUND_FAILED: 'system',
  RETURN_PICKUP_OFFERED: 'delivery',
  RETURN_PICKUP_NO_RIDER: 'delivery',
  RETURN_PICKUP_ASSIGNED: 'delivery',
  RETURN_PICKUP_OTP_READY: 'delivery',
  RETURN_PICKED_UP: 'delivery',
  RETURN_DELIVERED_TO_SELLER: 'delivery',
  COD_HANDOVER_REPORTED: 'delivery',
  COD_CASH_SETTLED: 'delivery',
  ADMIN_BROADCAST: 'broadcast',
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** FCM `data` payload values must be strings. */
const stringifyData = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
};

const deactivateToken = async (userId, token, Model = User) => {
  try {
    await Model.updateOne(
      { _id: userId, 'pushTokens.token': token },
      { $set: { 'pushTokens.$.active': false } }
    );
    await Model.updateOne({ _id: userId, fcmToken: token }, { $unset: { fcmToken: '' } });
    console.log(`[NOTIFICATION] deactivated invalid token for user ${userId}`);
  } catch (err) {
    console.error('[NOTIFICATION] failed to deactivate invalid token:', err.message);
  }
};

export const pushToUser = async (userId, { title, message, data, image }, Model = User) => {
  try {
    const user = await Model.findById(userId).select(Model === Admin ? '+pushTokens' : 'pushTokens fcmToken fcmPlatform');
    if (!user) return;

    const role = { user: 'buyer', buyer: 'buyer', customer: 'buyer', seller: 'seller', rider: 'delivery', delivery: 'delivery', admin: 'admin' }[data?.audience];
    const allTokens = (user.pushTokens || []).filter(t => t.active
      && (!Array.isArray(t.sessionRoles) || t.sessionRoles.includes(role)));

    // Deduplicate tokens by deviceId when available (keeping latest lastUsedAt per device)
    const deviceMap = new Map();
    const untracked = [];
    for (const t of allTokens) {
      if (t.deviceId) {
        const prev = deviceMap.get(t.deviceId);
        if (!prev || new Date(t.lastUsedAt || 0) > new Date(prev.lastUsedAt || 0)) {
          deviceMap.set(t.deviceId, t);
        }
      } else {
        untracked.push(t);
      }
    }
    const eligible = [...deviceMap.values(), ...untracked];
    eligible.sort((a, b) => new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0));

    // Cap active web tokens to at most 1 most recently used to eliminate duplicate tab alerts
    const webTokens = eligible.filter(t => t.platform === 'web').slice(0, 1);
    const appTokens = eligible.filter(t => t.platform !== 'web');

    let tokens = [...new Set([...webTokens, ...appTokens].map(t => t.token))];
    if (tokens.length === 0 && user.fcmToken && !user.pushTokens?.some(t => t.token === user.fcmToken)) tokens = [user.fcmToken];
    if (tokens.length === 0) return;

    const fcmData = stringifyData({ ...data, recipientId: String(userId) });

    for (const web of [true, false]) {
      const group = tokens.filter(token => (user.pushTokens?.find(t => t.token === token)?.platform === 'web' || (!user.pushTokens?.length && user.fcmPlatform === 'web')) === web);
      if (!group.length) continue;
      if (group.length === 1) {
        const result = await sendPushNotification(group[0], { title, body: message, data: fcmData, image, web });
        if (!result.success) {
          console.error('[NOTIFICATION] FCM send failed:', result.errorCode || 'delivery_failed');
          if (INVALID_TOKEN_CODES.has(result.errorCode)) await deactivateToken(userId, group[0], Model);
        }
      } else {
        const result = await sendBulkNotification(group, { title, body: message, data: fcmData, image, web });
        if (!result.success) {
          console.error('[NOTIFICATION] FCM bulk send failed:', result.errorCode || 'delivery_failed');
        } else if (result.responses) {
          result.responses.forEach((r, i) => {
            if (!r.success && INVALID_TOKEN_CODES.has(r.errorCode)) deactivateToken(userId, group[i], Model).catch(() => {});
          });
        }
      }
    }
  } catch (err) {
    console.error('[NOTIFICATION] push delivery failed:', err.message || err.code || 'delivery_failed');
  }
};

const emitBestEffort = async (roomKind, roomId, socketEvent, payload) => {
  if (!roomKind || !roomId || !socketEvent) return;
  try {
    const { emitToUser, emitToSeller, emitToRider, emitToAdmins } = await import('../socket/rooms.js');
    if (roomKind === 'admin') return emitToAdmins(socketEvent, payload); // shared admin:all room, no per-recipient id
    const emit = { user: emitToUser, seller: emitToSeller, rider: emitToRider }[roomKind];
    if (emit) emit(String(roomId), socketEvent, payload);
  } catch (err) {
    console.error('[NOTIFICATION] socket emit failed:', err.message);
  }
};

const recentNotifications = new Map();

const isRecentDuplicate = (key) => {
  if (!key) return false;
  const now = Date.now();
  const last = recentNotifications.get(key);
  if (last && now - last < 4000) {
    return true;
  }
  recentNotifications.set(key, now);
  if (recentNotifications.size > 500) {
    const oldest = recentNotifications.keys().next().value;
    recentNotifications.delete(oldest);
  }
  return false;
};

/**
 * Core primitive: persist a Notification against a User, then best-effort
 * fan out to a socket room and to that user's FCM tokens.
 *
 * `roomKind`/`roomId` are usually just 'user'/userId, but notifySeller and
 * friends (below) target the vendor's own room (seller:<id>, etc.) while
 * still persisting + pushing against the underlying User — the Notification
 * model and FCM tokens are always keyed by User, never by vendor record.
 */
const notifyCore = async (userId, roomKind, roomId, opts = {}) => {
  const { event, title, message, metadata = {}, route, expiresAt, media, dedupeKey } = opts;
  if (event === 'SELLER_PROMOTION_UPDATE') return null;
  if (!userId || !title || !message) return null;

  const entityId = metadata?.orderId || metadata?.returnId || metadata?.ticketId || metadata?.parcelDeliveryId || metadata?.applicationId || '';
  const statusPart = metadata?.status ? `:${metadata.status}` : '';
  const effectiveDedupeKey = dedupeKey || (entityId && event ? `${roomKind}:${userId}:${event}:${entityId}${statusPart}` : null);

  const debounceKey = `${userId}:${roomKind}:${event}:${title}:${message}:${entityId}${statusPart}`;
  if (isRecentDuplicate(debounceKey)) {
    return null;
  }

  const type = EVENT_CATEGORY[event] || 'system';
  let record = null;
  try {
    record = await Notification.create({
      userId,
      audience: roomKind,
      type,
      event,
      title,
      message,
      metadata,
      route,
      expiresAt,
      media,
      ...(effectiveDedupeKey ? { dedupeKey: effectiveDedupeKey } : {}),
    });
  } catch (err) {
    if ((dedupeKey || effectiveDedupeKey) && err.code === 11000) return null;
    console.error('[NOTIFICATION] persist failed:', err.message);
  }
  if ((dedupeKey || effectiveDedupeKey) && !record) return null;

  // A lightweight, uniform signal the notification drawer/unread-count
  // listens for — separate from whatever specific event (new_order,
  // rider_ping, ...) already drives the existing toasts/modals. Those keep
  // firing exactly as before; this is additive, not a replacement.
  emitBestEffort(roomKind, roomId, 'notification_new', {
    _id: record?._id,
    event,
    type,
    title,
    message,
    route,
    metadata,
    media,
    createdAt: record?.createdAt || new Date(),
  });

  pushToUser(userId, { title: roomKind === 'seller' && event === 'ORDER_CREATED' ? 'New Bulkimart Order' : title,
    message, data: { event, route, ...metadata, notificationId: record?._id, audience: roomKind }, image: media?.url });

  return record;
};

/**
 * Notifies every active Admin — the one case in this codebase where a
 * business event has no single User recipient (Admin is a separate model,
 * see models/Admin.js). One Notification row per admin (recipientModel:
 * 'Admin'), so each admin's own read/unread state is independent — one
 * admin opening a ticket must not silently mark it read for the rest of
 * the team. Socket is a single shared `admin:all` broadcast (every admin
 * connection joins it — see socket/socket.js's `join_admin`), since the
 * live ping is just "something changed, maybe refresh" and doesn't need a
 * per-admin room.
 *
 * Admin devices use the same authenticated token lifecycle, stored on Admin.
 */
export const notifyAllAdmins = async (opts = {}) => {
  const { event, title, message, metadata = {}, route, dedupeKey } = opts;
  if (event === 'SELLER_PROMOTION_UPDATE') return [];
  if (!title || !message) return [];

  const entityId = metadata?.orderId || metadata?.returnId || metadata?.ticketId || metadata?.parcelDeliveryId || metadata?.applicationId || '';
  const debounceKey = `admin:all:${event}:${title}:${message}:${entityId}`;
  if (isRecentDuplicate(debounceKey)) {
    return [];
  }

  const type = EVENT_CATEGORY[event] || 'system';
  let records = [];
  let admins = [];
  try {
    admins = await Admin.find({ isActive: true }).select('_id');
    if (admins.length === 0) return [];
    const entries = admins.map(a => ({ userId: a._id, recipientModel: 'Admin', audience: 'admin', type, event, title, message, metadata, route }));
    if (dedupeKey) {
      for (const entry of entries) {
        try { records.push(await Notification.create({ ...entry, dedupeKey: dedupeKey + ':' + entry.userId })); }
        catch (error) { if (error.code !== 11000) throw error; }
      }
    } else records = await Notification.insertMany(entries);
  } catch (err) {
    console.error('[NOTIFICATION] admin persist failed:', err.message);
  }

  if (dedupeKey && !records.length) return [];
  const eventId = dedupeKey || records[0]?._id?.toString();
  for (const record of records) {
    void pushToUser(record.userId, { title, message, data: { event, eventId, route, ...metadata, notificationId: record._id, audience: 'admin' } }, Admin);
  }
  emitBestEffort('admin', 'all', 'notification_new', {
    event, eventId, type, title, message, route, metadata, createdAt: new Date(),
  });

  return records;
};

/**
 * The single place a device token is written. `PUT /api/users/fcm-token`
 * (legacy) and `POST /api/notifications/tokens` (canonical) both call this
 * instead of each upserting the User document themselves.
 */
export const registerPushToken = async (userId, token, platform, sessionRole, Model = User, deviceId = null) => {
  const tokenPlatform = platform === 'web' ? 'web' : 'app';

  // One browser/app installation must belong to only the currently signed-in
  // account. This prevents a stale token from receiving another account's
  // notifications after logout/account switching on the same device.
  await Model.updateMany(
    { _id: { $ne: userId }, 'pushTokens.token': token },
    { $pull: { pushTokens: { token } } },
  );
  await Model.updateMany(
    { _id: { $ne: userId }, fcmToken: token },
    { $unset: { fcmToken: '', fcmPlatform: '' } },
  );
  if (deviceId) {
    await Model.updateMany(
      { _id: { $ne: userId }, 'pushTokens.deviceId': deviceId },
      { $pull: { pushTokens: { deviceId } } },
    );
  }

  const user = await Model.findById(userId).select('+pushTokens');
  if (!user) return null;

  user.pushTokens = user.pushTokens || [];

  // If a deviceId is supplied, replace/deactivate any existing token for that device.
  if (deviceId) {
    for (const t of user.pushTokens) {
      if (t.deviceId === deviceId && t.token !== token) {
        t.active = false;
      }
    }
  }

  const existing = user.pushTokens.find((t) => t.token === token);
  if (existing) {
    existing.active = true;
    existing.platform = tokenPlatform;
    existing.lastUsedAt = new Date();
    if (deviceId) existing.deviceId = deviceId;
    if (sessionRole) existing.sessionRoles = [...new Set([...(existing.sessionRoles || []), sessionRole])];
  } else {
    user.pushTokens.push({
      token,
      platform: tokenPlatform,
      active: true,
      lastUsedAt: new Date(),
      ...(deviceId ? { deviceId } : {}),
      ...(sessionRole ? { sessionRoles: [sessionRole] } : {}),
    });
  }

  // Deactivate older duplicate tokens to prevent duplicate push notifications
  const activeWeb = user.pushTokens.filter(t => t.active && t.platform === 'web');
  if (activeWeb.length > 1) {
    activeWeb.sort((a, b) => new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0));
    for (let i = 1; i < activeWeb.length; i++) {
      activeWeb[i].active = false;
    }
  }

  if (Model === User) { user.fcmToken = token; user.fcmPlatform = tokenPlatform; }
  // Validate only what changed: an older account document missing some field must not block push registration.
  await user.save({ validateModifiedOnly: true });
  return tokenPlatform;
};

/** Remove one device's token — logout for that device, other devices unaffected. */
export const removePushToken = async (userId, token, sessionRole, Model = User) => {
  // Atomic updates avoid restoring tokens from a stale document while a
  // different device signs in or out at the same time.
  if (sessionRole) {
    await Model.updateOne({ _id: userId }, { $pull: { 'pushTokens.$[device].sessionRoles': sessionRole } }, { arrayFilters: [{ 'device.token': token }] });
    await Model.updateOne({ _id: userId }, { $pull: { pushTokens: { token, $or: [
      { sessionRoles: { $exists: false } }, { sessionRoles: { $size: 0 } },
    ] } } });
  } else {
    await Model.updateOne({ _id: userId }, { $pull: { pushTokens: { token } } });
  }
  await Model.updateOne({ _id: userId, fcmToken: token }, { $unset: { fcmToken: '', fcmPlatform: '' } });
};

export const notifyUser = (userId, opts) => notifyCore(userId, 'user', userId, opts);

export const notifySeller = async (sellerId, opts) => {
  if (!sellerId) return null;
  const sellerKey = sellerId._id || sellerId;
  const seller = await Seller.findById(sellerKey).select('userId').lean().catch(() => null);
  if (!seller?.userId) return null;
  const orderId = String(opts.metadata?.orderId || '');
  const marketplaceOrderRoute = !opts.route || /^\/(?:seller\/)?orders(?:\/|$)/.test(opts.route);
  const options = /^[a-f\d]{24}$/i.test(orderId) ? { ...opts,
    route: marketplaceOrderRoute ? `/seller/orders/${orderId}` : opts.route,
    metadata: { ...opts.metadata, sellerId: String(sellerKey) } } : opts;
  return notifyCore(seller.userId, 'seller', sellerKey, options);
};

export const notifyRider = async (partnerId, opts) => {
  if (!partnerId) return null;
  const partner = await DeliveryPartner.findById(partnerId).select('userId').lean().catch(() => null);
  if (!partner?.userId) return null;
  return notifyCore(partner.userId, 'rider', partnerId, opts);
};
