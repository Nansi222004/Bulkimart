import mongoose from 'mongoose';

/**
 * One inbound delivery from a seller, counted at the warehouse (FBB receiving).
 *
 * No seller-created transfer request is needed: the warehouse team identifies the goods by seller, product
 * and variant. `expectedQty` is optional (from the seller's packing slip). For each line:
 *     received = accepted + damaged + rejected        missing = expected − received (never negative)
 * e.g. 100 expected → 90 accepted, 5 damaged, 0 rejected, 5 missing. Only accepted units become sellable.
 *
 * Draft → posted, once (the post is an atomic status change), so a receipt can never be counted twice.
 * Posted receipts are immutable; mistakes are corrected with an approved stock adjustment.
 */
const { Schema, model } = mongoose;

const lineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  productName: String,
  variantName: String,
  expectedQty: { type: Number, min: 0 },
  receivedQty: { type: Number, min: 0, required: true },
  acceptedQty: { type: Number, min: 0, required: true },
  damagedQty: { type: Number, min: 0, default: 0 },
  rejectedQty: { type: Number, min: 0, default: 0 },
  missingQty: { type: Number, min: 0, default: 0 },
  note: { type: String, maxlength: 300 },
}, { _id: true });

const receiptSchema = new Schema({
  receiptNo: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  status: { type: String, enum: ['draft', 'posted', 'cancelled'], default: 'draft' },
  lines: { type: [lineSchema], validate: [(v) => v.length > 0 && v.length <= 200, 'A receipt needs 1–200 lines'] },
  reference: { type: String, trim: true, maxlength: 100 }, // seller's packing slip / courier docket, if any
  notes: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  postedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  postedAt: Date,
  // Storage charges booked at posting (services/fbbCharges.service.js), when charging was on.
  storageCharged: { type: Boolean, default: false },
}, { timestamps: true });

receiptSchema.index({ sellerId: 1, createdAt: -1 });
receiptSchema.index({ status: 1, createdAt: -1 });

// Posted receipts are evidence: after posting, an update may only record that storage was charged.
for (const operation of ['updateOne', 'findOneAndUpdate']) {
  receiptSchema.pre(operation, function () {
    const filter = this.getFilter() || {};
    const update = this.getUpdate() || {};
    const paths = Object.values(update).flatMap((value) => (value && typeof value === 'object' ? Object.keys(value) : []));
    if (filter.status !== 'draft' && paths.some((path) => !['storageCharged', 'updatedAt'].includes(path))) {
      throw new Error('Only a draft warehouse receipt can be changed');
    }
  });
}
for (const operation of ['replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'updateMany']) {
  receiptSchema.pre(operation, function () { throw new Error('Warehouse receipts are evidence and cannot be replaced or deleted'); });
}

export default model('WarehouseReceipt', receiptSchema);
