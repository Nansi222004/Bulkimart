import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-attached media (Push Notifications Broadcaster only). A referenced
 * schema, not an inline object — the same reason geoPoint.schema.js gives:
 * Mongoose only materialises a nested schema once something is actually
 * assigned to it, so a plain event-driven notification keeps no `media`
 * field at all rather than `{ mediaType: undefined, url: undefined, ... }`.
 * Only IMAGE is supported today — the only media type the notification
 * drawers (and FCM's own `notification.image`) can actually render.
 */
const notificationMediaSchema = new Schema(
  {
    mediaType: { type: String, enum: ["IMAGE"] },
    url: String,
    publicId: String,
    mimeType: String,
    size: Number,
  },
  { _id: false }
);

const notificationSchema = new Schema(
  {
    // Who this notification belongs to. Almost always a User (buyer, or the
    // User behind a seller/shg/rider account — see notification.service.js).
    // `recipientModel` lets it also target an Admin (a genuinely separate
    // model, not a User) — e.g. TICKET_CREATED, which has no User recipient
    // at all — without a second notification collection: `refPath` resolves
    // populate()/the conceptual "which collection" per-document from
    // `recipientModel`, defaulting to "User" so every pre-existing row
    // (written before this field existed) keeps meaning exactly what it did.
    userId: { type: ObjectId, required: true, refPath: "recipientModel" },
    recipientModel: { type: String, enum: ["User", "Admin"], default: "User" },
    type:    {
      type: String,
      enum: ["order", "delivery", "subscription", "promotion", "membership", "system", "broadcast"],
      required: true,
    },
    // Fine-grained business-event constant (see NOTIFICATION_EVENT in
    // services/notification.service.js), e.g. "ORDER_CREATED". `type` above
    // stays the coarse category so every pre-existing row/query keeps working.
    event:   { type: String },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    isRead:  { type: Boolean, default: false },
    // Frontend deep-link path, e.g. "/orders/<id>" — resolved client-side.
    route:   { type: String },
    media: { type: notificationMediaSchema, default: undefined },
    metadata:{
      orderId:        { type: ObjectId, ref: "Order" },
      subscriptionId: { type: ObjectId, ref: "Subscription" },
      productId:      { type: ObjectId, ref: "Product" },
      campaignId:     { type: ObjectId, ref: "Campaign" },
      promotionId:    { type: ObjectId, ref: "SellerPromotion" },
      ticketId:       { type: ObjectId, ref: "Ticket" },
      // Admin Push Notifications Broadcaster — links each fanned-out
      // Notification row back to the one NotificationBroadcast that sent
      // it, so read/open-rate stats can be counted without a second,
      // duplicated tracking table.
      broadcastId:    { type: ObjectId, ref: "NotificationBroadcast" },
      // Referral Program — links a reward/milestone notification back to
      // the Referral row that earned it.
      referralId:     { type: ObjectId, ref: "Referral" },
    },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, recipientModel: 1, isRead: 1, createdAt: -1 });

const Notification = model("Notification", notificationSchema);
export default Notification;
