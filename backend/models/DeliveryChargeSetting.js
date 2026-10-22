import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * What a CUSTOMER pays for delivery, set by an admin.
 *
 * Deliberately a separate model from DeliveryRate.js — that one is what a
 * RIDER earns per kilometre; this is the flat fee a shopper sees on the
 * cart and at checkout. The two have never been the same number and must
 * not be confused by sharing a collection.
 *
 * No free-delivery threshold — every order pays this, waived only by an
 * empty cart or a free-shipping coupon (see pricing.service.js).
 *
 * Same "never edited, new row supersedes the old" pattern as DeliveryRate —
 * one active row at a time, history kept for audit.
 */
const deliveryChargeSettingSchema = new Schema(
  {
    /** Charged on every order. */
    flatFee: { type: Number, required: true, min: 0 },
    // Explicit customer tariff, independent of rider remuneration. No defaults
    // are seeded: the legacy distance formula remains until separately approved.
    distanceRates: {
      type: new Schema({ quick: { type: Number, required: true, min: 0 }, same_day: { type: Number, required: true, min: 0 } }, { _id: false }),
      default: undefined,
    },

    isActive:      { type: Boolean, default: true },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy:     { type: ObjectId, ref: "Admin" },
    note:          String,
  },
  { timestamps: true }
);

deliveryChargeSettingSchema.index({ isActive: 1 });
deliveryChargeSettingSchema.index({ createdAt: -1 });

const DeliveryChargeSetting = model("DeliveryChargeSetting", deliveryChargeSettingSchema);
export default DeliveryChargeSetting;
