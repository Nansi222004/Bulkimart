import mongoose from 'mongoose';

/**
 * One FBB service charge to a seller. `_id` is the charge's identity, so the same charge can only exist once:
 *   STORAGE:<receiptId>:<lineId>     PACKAGING:<orderId>     FULFILLMENT:<orderId>
 * Each posts one debit to the seller's FBB obligation (SellerLedgerEntry, same idempotency key). A correction
 * never deletes it: an approved reversal credits the obligation back and the charge is marked reversed.
 */
const { Schema, model } = mongoose;

const fbbChargeSchema = new Schema({
  _id: { type: String },
  type: { type: String, enum: ['storage', 'packaging', 'fulfillment'], required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  receiptId: { type: Schema.Types.ObjectId, ref: 'WarehouseReceipt' },
  productId: { type: Schema.Types.ObjectId, ref: 'Product' },
  qty: { type: Number, required: true, min: 1 },
  basis: { type: String, enum: ['per_unit', 'per_order'], required: true },
  ratePaise: { type: Number, required: true, min: 0 },
  amountPaise: { type: Number, required: true, min: 0 },
  configVersion: { type: Number, required: true },
  status: { type: String, enum: ['posted', 'reversed'], default: 'posted' },
  reversal: { reason: String, by: { type: Schema.Types.ObjectId, ref: 'Admin' }, at: Date },
}, { timestamps: true, collection: 'fbb_charges' });

fbbChargeSchema.index({ sellerId: 1, createdAt: -1 });
fbbChargeSchema.index({ orderId: 1 });
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace']) {
  fbbChargeSchema.pre(op, () => { throw new Error('FBB charges are financial history; reverse them instead'); });
}

export default model('FbbCharge', fbbChargeSchema);
