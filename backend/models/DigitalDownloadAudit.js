import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const digitalDownloadAuditSchema = new Schema({
  entitlementId: { type: Schema.Types.ObjectId, ref: 'DigitalEntitlement', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  downloadedAt: { type: Date, default: Date.now, required: true },
  ip: String,
  userAgent: String,
}, { timestamps: false });

digitalDownloadAuditSchema.index({ entitlementId: 1, downloadedAt: -1 });
digitalDownloadAuditSchema.index({ userId: 1, downloadedAt: -1 });

export default model('DigitalDownloadAudit', digitalDownloadAuditSchema);
