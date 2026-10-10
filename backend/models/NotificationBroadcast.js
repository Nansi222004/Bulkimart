import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin Push Notifications Broadcaster — a marketing/informational message
 * an admin composes and fans out to a whole audience, as opposed to the
 * per-user event-driven Notification rows services/notification.service.js
 * already creates for order/return/delivery/etc. business events.
 *
 * Deliberately its OWN model, not fields bolted onto Notification: this
 * document is the CAMPAIGN (one row per broadcast, tracking counts/status/
 * schedule); the fan-out itself still produces ordinary Notification rows
 * (one per recipient, via the existing notifyUser/notifySeller/notifyShg/
 * notifyRider), each carrying `metadata.broadcastId` back to this
 * document — so read/delivered/failed counts are counted from the real
 * per-recipient rows, never a second, hand-maintained tally that could
 * drift from what actually happened.
 *
 * Only IMAGE media is supported (see Notification.js's `media` field
 * comment) — the only type the notification drawers and FCM's own
 * `notification.image` can actually render today.
 */
const notificationBroadcastSchema = new Schema(
  {
    title:   { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    media: {
      mediaType: { type: String, enum: ["IMAGE"] },
      url: String,
      publicId: String,
      mimeType: String,
      size: Number,
    },

    /**
     * Server-resolved at send time, NEVER a client-supplied recipient list
     * (Section 18) — only these four real, existing roles are supported;
     * ALL_ADMINS is deliberately absent (a marketing broadcast has no
     * reason to target the platform's own admins).
     */
    targetAudience: {
      type: String,
      enum: ["ALL_CUSTOMERS", "ALL_SELLERS", "ALL_SHG", "ALL_DELIVERY_PARTNERS"],
      required: true,
    },

    /**
     * What the admin INTENDED to send on. PUSH and SOCKET are real
     * (services/notification.service.js). EMAIL and SMS are included so
     * the architecture is provider-ready, but no email/SMS provider
     * exists in this codebase today — `channelResults.EMAIL`/`SMS` is
     * always recorded as NOT_CONFIGURED, never faked as sent.
     */
    channels: {
      type: [{ type: String, enum: ["PUSH", "SOCKET", "EMAIL", "SMS"] }],
      default: ["PUSH", "SOCKET"],
    },

    // Frontend deep-link, validated/normalised server-side against the
    // audience's own known route prefixes before it's ever saved (Section 15).
    deepLink: String,

    status: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "PROCESSING", "SENT", "PARTIALLY_SENT", "FAILED", "CANCELLED"],
      default: "DRAFT",
    },

    scheduledAt: Date,
    sentAt: Date,

    createdBy: { type: ObjectId, ref: "Admin", required: true },

    // Counted from the real Notification rows this broadcast produced —
    // never incremented speculatively before the send actually happens.
    recipientCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 }, // Notification row + at least one channel accepted it
    failedCount:    { type: Number, default: 0 },

    /**
     * Per-channel outcome, recorded honestly rather than assumed. PUSH/
     * SOCKET carry real sent/failed tallies; EMAIL/SMS are always
     * `{ status: 'NOT_CONFIGURED' }` in this codebase (Section 9/19).
     */
    channelResults: {
      PUSH:   { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
      SOCKET: { sent: { type: Number, default: 0 } },
      EMAIL:  { status: { type: String, enum: ["NOT_CONFIGURED", "SENT", "FAILED"], default: "NOT_CONFIGURED" } },
      SMS:    { status: { type: String, enum: ["NOT_CONFIGURED", "SENT", "FAILED"], default: "NOT_CONFIGURED" } },
    },

    errorMessage: String,

    /**
     * Atomic send-lock (same discipline as return.service.js's
     * `refundLockedAt`) — guards against a double-click on "Send Now", an
     * API retry, or the scheduled sweeper and a manual retry racing each
     * other. Reclaimable after 5 minutes if a process died mid-send.
     */
    processingLockedAt: Date,
  },
  { timestamps: true }
);

notificationBroadcastSchema.index({ status: 1, createdAt: -1 });
notificationBroadcastSchema.index({ status: 1, scheduledAt: 1 });

const NotificationBroadcast = model("NotificationBroadcast", notificationBroadcastSchema);
export default NotificationBroadcast;
