import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Wholesale checkout rules, managed from Admin -> Wholesale (services/wholesaleMinimum.service.js).
 * Versioned like GoToSetting / TipSetting: saving deactivates the current row and adds a new one.
 */
const wholesaleSettingSchema = new Schema({
  // Products in one Wholesale checkout must add up to at least this (₹). 0 = no minimum.
  minOrderValue: { type: Number, min: 0, max: 10000000, default: 5000 },
  isActive: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

wholesaleSettingSchema.index({ isActive: 1, createdAt: -1 });

export default model('WholesaleSetting', wholesaleSettingSchema);
