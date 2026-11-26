import mongoose from 'mongoose';

/**
 * FBB service charges (seller-paid), as versions. A version is never edited: a change is a new version with
 * its own effective date, so every charge records exactly which rates it used.
 *
 *   storage     once per accepted warehouse unit, at verified receipt
 *   packaging   when packing is done            (per unit or per order)
 *   fulfillment when handed to the provider     (per unit or per order)
 *
 * Amounts are whole paise. Tax treatment is not decided (accountant review), so no tax is computed here.
 * Shipping is not an FBB charge: it stays the customer's ordinary delivery charge.
 */
const { Schema, model } = mongoose;

const rateSchema = (bases) => new Schema({
  amountPaise: { type: Number, required: true, min: 0, validate: [Number.isSafeInteger, 'Charge must be whole paise'] },
  basis: { type: String, enum: bases, required: true },
}, { _id: false });

const fbbChargeConfigSchema = new Schema({
  version: { type: Number, required: true, unique: true, min: 1 },
  effectiveFrom: { type: Date, required: true },
  storage: { type: rateSchema(['per_unit']), required: true },
  packaging: { type: rateSchema(['per_unit', 'per_order']), required: true },
  fulfillment: { type: rateSchema(['per_unit', 'per_order']), required: true },
  taxTreatment: { type: String, enum: ['pending_accountant_review'], default: 'pending_accountant_review' },
  reason: { type: String, required: true, minlength: 5, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

fbbChargeConfigSchema.index({ effectiveFrom: -1, version: -1 });
const immutable = () => { throw new Error('FBB charge versions are immutable; create a new version'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) fbbChargeConfigSchema.pre(op, immutable);
fbbChargeConfigSchema.pre('save', function () { if (!this.isNew) immutable(); });

export default model('FbbChargeConfig', fbbChargeConfigSchema);
