import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Audit trail of every Shiprocket tracking event Bulkimart received or polled — including ones that were
 * rejected, duplicates, out of order or matched nothing — and of admin decisions on shipment exceptions.
 * Only tracking fields are kept (no names, addresses or phone numbers). Old rows expire after 180 days;
 * the order's own `shiprocket.webhookEvents` / timeline keep the applied history permanently.
 */
const courierEventLogSchema = new Schema({
  provider: { type: String, default: 'shiprocket' },
  kind: { type: String, enum: ['webhook', 'reconciliation', 'admin_action'], required: true },
  direction: { type: String, enum: ['forward', 'return', 'unknown'], default: 'unknown' },
  environment: String,
  awb: String,
  shipmentId: String,
  statusId: Number,
  status: String,
  eventId: String,
  // applied | duplicate | stale | unmatched | identity_mismatch | rejected | setup_locked | tracking_only | error | <admin decision>
  outcome: { type: String, required: true },
  detail: String,
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  returnId: { type: Schema.Types.ObjectId, ref: 'Return' },
  adminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
  // Whitelisted, non-personal provider fields (see courierTracking.service.js::safePayload).
  payload: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

courierEventLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
courierEventLogSchema.index({ orderId: 1, createdAt: -1 });
courierEventLogSchema.index({ awb: 1, createdAt: -1 });

export default model('CourierEventLog', courierEventLogSchema);
