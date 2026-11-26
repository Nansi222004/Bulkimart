import mongoose from 'mongoose';
import { DELIVERY_METHODS } from '../constants/enums.js';

/**
 * Audit trail of a product's delivery method changes (Easy Ship ⇄ Self Delivery, → FBB).
 * Append-only. Existing orders are never affected by a change: each order line keeps the
 * method it was bought under (Order.items[].deliveryMethod).
 */
const { Schema, model } = mongoose;

const deliveryMethodChangeSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', immutable: true },
  from: { type: String, enum: DELIVERY_METHODS, required: true, immutable: true },
  to: { type: String, enum: DELIVERY_METHODS, required: true, immutable: true },
  actorType: { type: String, enum: ['seller', 'admin', 'system'], required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, immutable: true },
  source: { type: String, enum: ['product_create', 'product_edit', 'bulk_upload'], required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

deliveryMethodChangeSchema.index({ productId: 1, createdAt: -1 });

const denyMutation = () => { throw new Error('Delivery method history is append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  deliveryMethodChangeSchema.pre(op, denyMutation);
}
deliveryMethodChangeSchema.pre('save', function () { if (!this.isNew) denyMutation(); });

export default model('DeliveryMethodChange', deliveryMethodChangeSchema);
