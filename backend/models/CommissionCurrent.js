import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * The one current merchandise commission rule for each scope.
 *
 * A scope is (channel, vendorType, category, product). Saving a rule inserts
 * an append-only `Commission` version for the audit trail and moves this
 * pointer to it in the same transaction, so checkout never has to choose
 * between competing versions by date. Orders freeze the rule they used in
 * their financial snapshot; moving the pointer never touches placed orders.
 */
const commissionCurrentSchema = new Schema({
  _id: { type: String },
  channel: { type: String, enum: ['ecommerce', 'quick', 'wholesale'], required: true },
  vendorType: { type: String, enum: ['general', 'shg'], required: true },
  categoryId: { type: ObjectId, ref: 'Category', default: null },
  productId: { type: ObjectId, ref: 'Product', default: null },
  ruleId: { type: ObjectId, ref: 'Commission', required: true },
  revision: { type: Number, required: true },
  updatedBy: { type: ObjectId, ref: 'Admin' },
}, { timestamps: true, collection: 'commission_current_rules' });

commissionCurrentSchema.index({ channel: 1, vendorType: 1 });

export const commissionScopeKey = ({ channel, vendorType, categoryId = null, productId = null }) =>
  `${channel}:${vendorType}:${categoryId ? String(categoryId) : '*'}:${productId ? String(productId) : '*'}`;

const CommissionCurrent = model('CommissionCurrent', commissionCurrentSchema);
export default CommissionCurrent;
