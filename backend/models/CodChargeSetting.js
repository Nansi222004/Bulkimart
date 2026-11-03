import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Admin-configured Cash on Delivery handling fee (services/codCharge.service.js).
 * Versioned like TipSetting / DeliveryChargeSetting: saving deactivates the current row and
 * adds a new one, so every order can point at the exact rule it was charged under.
 */
const codChargeSettingSchema = new Schema({
  isEnabled: { type: Boolean, default: false },
  feeType: { type: String, enum: ['FIXED', 'PERCENTAGE'], default: 'FIXED' },
  fixedAmount: { type: Number, min: 0, default: 0 },        // ₹ per order, when FIXED
  percentage: { type: Number, min: 0, max: 100, default: 0 }, // % of the order amount, when PERCENTAGE
  minOrderAmount: { type: Number, min: 0, default: null },   // fee applies only at or above this order amount
  maxFee: { type: Number, min: 0, default: null },           // cap on the fee before GST
  gstRatePercent: { type: Number, min: 0, max: 28, default: 0 }, // GST added on top of the fee
  description: { type: String, trim: true, maxlength: 200, default: 'COD Handling Fee' },
  isActive: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  note: { type: String, trim: true, maxlength: 300 },
}, { timestamps: true });

codChargeSettingSchema.index({ isActive: 1, createdAt: -1 });

export default model('CodChargeSetting', codChargeSettingSchema);
