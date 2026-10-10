import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * The "Help Wallet" / Social Work donation prompt shown at checkout.
 *
 * Same pattern as DeliveryChargeSetting.js — never edited in place, a new
 * row supersedes the old (isActive flips off on the previous one inside a
 * transaction), so changing the title or the chip amounts leaves a real
 * history rather than silently rewriting what was live at the time an
 * order was placed.
 */
const donationSettingSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: true },

    title:    { type: String, default: 'Donate & Support Transformative Social Work In India' },
    subtitle: { type: String, default: '' },
    // Shown inside the "Know More" modal.
    knowMoreText: { type: String, default: '' },

    // Preset chip amounts, e.g. [10, 20, 50, 80, 100].
    options: { type: [Number], default: [10, 20, 50, 80, 100] },

    allowCustom:     { type: Boolean, default: true },
    minCustomAmount: { type: Number, default: 1 },
    maxCustomAmount: { type: Number, default: 10000 },

    isActive:  { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

donationSettingSchema.index({ isActive: 1 });
donationSettingSchema.index({ createdAt: -1 });

const DonationSetting = model("DonationSetting", donationSettingSchema);
export default DonationSetting;
