import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Tip settings configuration prompt shown at customer checkout.
 * Managed dynamically from the Admin Panel.
 * Uses immutable versioning pattern where active settings are superseded by new rows.
 */
const tipSettingSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: true },

    title:    { type: String, default: 'Tip your delivery partner' },
    subtitle: { type: String, default: "100% of your tip goes to them. We don't take a cut." },

    // Preset chip amounts, e.g. [10, 20, 30, 40, 50].
    options: { type: [Number], default: [10, 20, 30, 40, 50] },

    allowCustom:     { type: Boolean, default: true },
    minCustomAmount: { type: Number, default: 1 },
    maxCustomAmount: { type: Number, default: 1000 },

    isActive:  { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

tipSettingSchema.index({ isActive: 1 });
tipSettingSchema.index({ createdAt: -1 });

const TipSetting = model("TipSetting", tipSettingSchema);
export default TipSetting;
