import mongoose from 'mongoose';

/**
 * A seller's notice that they sent FBB stock to a Bulkimart warehouse ("I've sent stock").
 *
 * It is information only: it never changes stock or charges. Stock still comes only from a receipt the warehouse
 * counts and posts (models/WarehouseReceipt.js). When the warehouse counts the delivery, the receipt is linked here
 * (status `received`); cancelling that draft receipt puts the shipment back to `in_transit`.
 *   in_transit → received        in_transit → cancelled (by the seller, before it is counted)
 */
const { Schema, model } = mongoose;

const lineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  productName: String,
  variantName: String,
  qty: { type: Number, required: true, min: 1, max: 100000 },
}, { _id: false });

const shipmentSchema = new Schema({
  shipmentNo: { type: String, required: true, unique: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  // Retries of the same submit return the first shipment instead of creating a second one.
  idempotencyKey: { type: String, required: true },
  status: { type: String, enum: ['in_transit', 'received', 'cancelled'], default: 'in_transit' },
  lines: { type: [lineSchema], validate: [(v) => v.length > 0 && v.length <= 50, 'A shipment needs 1–50 products'] },
  courier: { type: String, trim: true, maxlength: 80 },
  trackingNo: { type: String, trim: true, maxlength: 80 },
  invoiceNo: { type: String, trim: true, maxlength: 80 },
  expectedBy: Date,
  note: { type: String, trim: true, maxlength: 300 },
  receiptId: { type: Schema.Types.ObjectId, ref: 'WarehouseReceipt' },
  receivedAt: Date,
  cancelledAt: Date,
}, { timestamps: true });

shipmentSchema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true });
shipmentSchema.index({ sellerId: 1, createdAt: -1 });
shipmentSchema.index({ status: 1, createdAt: -1 });

export default model('FbbShipment', shipmentSchema);
