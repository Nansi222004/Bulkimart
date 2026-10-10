import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-configurable ceilings for the three radius concepts in the
 * platform: how far a seller may promise Same-Day, how far a seller's
 * products stay visible at all, and how far a rider will be dispatched
 * for a pickup. Previously these were `SAME_DAY_MAX_RADIUS_KM` /
 * `SELLER_SERVICE_MAX_RADIUS_KM` / `DELIVERY_PARTNER_MAX_RADIUS_KM` env
 * vars, read once at boot — changing them meant an env edit and a
 * restart. This makes them DB-backed and live.
 *
 * `100` (RADIUS_HARD_SAFETY_CEILING_KM below) is NOT a business number —
 * it is the absolute outer bound past which a value can never be, admin
 * or not, a typo-guard of last resort. The real, day-to-day ceiling an
 * admin actually sets is whatever is stored here.
 *
 * Same "never edited, new row supersedes the old" pattern as
 * DeliveryChargeSetting/DeliveryRate — one active row at a time, history
 * kept for audit. A ceiling change must never reach back and mutate a
 * seller's or rider's already-stored radius (see radiusSetting.service.js
 * and the controllers that read this).
 */

/** Absolute outer bound — see file-level comment. Never used as the live business ceiling. */
export const RADIUS_HARD_SAFETY_CEILING_KM = 100;

const radiusSettingSchema = new Schema(
  {
    sameDayMaxRadiusKm: {
      type: Number,
      required: true,
      min: [0.1, 'Same-Day max radius must be greater than 0'],
      max: [RADIUS_HARD_SAFETY_CEILING_KM, `Same-Day max radius cannot exceed ${RADIUS_HARD_SAFETY_CEILING_KM}km`],
      set: (v) => Number.isFinite(v) ? Number(v.toFixed(2)) : v,
    },
    sellerServiceMaxRadiusKm: {
      type: Number,
      required: true,
      min: [0.1, 'Seller service max radius must be greater than 0'],
      max: [RADIUS_HARD_SAFETY_CEILING_KM, `Seller service max radius cannot exceed ${RADIUS_HARD_SAFETY_CEILING_KM}km`],
      set: (v) => Number.isFinite(v) ? Number(v.toFixed(2)) : v,
    },
    deliveryPartnerMaxRadiusKm: {
      type: Number,
      required: true,
      min: [0.1, 'Delivery partner max radius must be greater than 0'],
      max: [RADIUS_HARD_SAFETY_CEILING_KM, `Delivery partner max radius cannot exceed ${RADIUS_HARD_SAFETY_CEILING_KM}km`],
      set: (v) => Number.isFinite(v) ? Number(v.toFixed(2)) : v,
    },

    isActive:      { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy:     { type: ObjectId, ref: "Admin" },
    note:          String,
  },
  { timestamps: true }
);

radiusSettingSchema.index({ isActive: 1 });
radiusSettingSchema.index({ createdAt: -1 });

const RadiusSetting = model("RadiusSetting", radiusSettingSchema);
export default RadiusSetting;
