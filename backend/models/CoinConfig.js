import mongoose from 'mongoose';
import { COIN_DEFAULTS } from '../constants/enums.js';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-configurable NHCONE Coins rules — same "never edited, a new row
 * supersedes the old one, history kept for audit" pattern already used by
 * DeliveryChargeSetting.js/DeliveryRate.js. Exactly one row has
 * `isActive: true` at a time; services/coinConfig.service.js caches it the
 * same way services/deliveryCharge.service.js does.
 *
 * `earnPercentage`/`maximumRedemptionPercentage` are plain numbers meaning
 * a percent (10 = 10%), matching how PromotionPackage/DeliveryRate already
 * store percentages in this codebase.
 */
const coinConfigSchema = new Schema(
  {
    /** % of eligible purchase value credited as Coins after delivery. */
    earnPercentage: { type: Number, required: true, min: 0, max: 100, default: COIN_DEFAULTS.EARN_PERCENTAGE },

    /** ₹ value of one Coin. Fixed at 1 for V1 but kept configurable, not hardcoded. */
    coinValue: { type: Number, required: true, min: 0.01, default: COIN_DEFAULTS.COIN_VALUE },

    /** Minimum total eligible order/cart value before Coins may be redeemed at all. */
    minimumRedemptionOrderValue: { type: Number, required: true, min: 0, default: COIN_DEFAULTS.MINIMUM_REDEMPTION_ORDER_VALUE },

    /** Max % of the eligible order value that may be paid with Coins. */
    maximumRedemptionPercentage: { type: Number, required: true, min: 0, max: 100, default: COIN_DEFAULTS.MAXIMUM_REDEMPTION_PERCENTAGE },

    isActive:      { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy:     { type: ObjectId, ref: 'Admin' },
    note:          String,
  },
  { timestamps: true }
);

coinConfigSchema.index({ isActive: 1 });
coinConfigSchema.index({ createdAt: -1 });

const CoinConfig = model('CoinConfig', coinConfigSchema);
export default CoinConfig;
