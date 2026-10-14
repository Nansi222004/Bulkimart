import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const digitalEntitlementSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
  gatewayPaymentId: String,
  fileId: { type: String, required: true, select: false },
  fileSha256: { type: String, required: true },
  fileSizeBytes: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active', required: true },
  activatedAt: { type: Date, required: true, default: Date.now },
  suspendedAt: Date,
  revokedAt: Date,
  lifecycleReason: String,
  lastDownloadedAt: Date,
  downloadCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

digitalEntitlementSchema.index(
  { userId: 1, orderId: 1, productId: 1 },
  { unique: true, name: 'digital_entitlement_purchase_unique' },
);
digitalEntitlementSchema.index({ userId: 1, createdAt: -1 });

export default model('DigitalEntitlement', digitalEntitlementSchema);
