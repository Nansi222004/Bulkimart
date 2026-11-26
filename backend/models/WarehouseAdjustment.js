import mongoose from 'mongoose';

/**
 * An exceptional correction to warehouse stock (count error, damage found in storage, units returned to the
 * seller at admin discretion, …). Two people: one admin requests it with a reason, a different admin with the
 * warehouse permission approves it, and only then is stock changed (once). Rejected requests change nothing.
 * Seller-initiated withdrawal of unsold stock is not supported.
 */
const { Schema, model } = mongoose;

const adjustmentSchema = new Schema({
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  bucket: { type: String, enum: ['sellable', 'damaged'], required: true },
  delta: { type: Number, required: true, validate: [(v) => Number.isInteger(v) && v !== 0, 'Adjustment must be a non-zero whole number'] },
  reason: { type: String, required: true, minlength: 5, maxlength: 300 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  decidedAt: Date,
  decisionNote: { type: String, maxlength: 300 },
}, { timestamps: true });

adjustmentSchema.index({ status: 1, createdAt: -1 });

export default model('WarehouseAdjustment', adjustmentSchema);
