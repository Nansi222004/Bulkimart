import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Platform Helpline and SOS Emergency contact configuration.
 * Configured dynamically from the Admin panel.
 * Available publicly to Delivery, Seller, and Consumer apps.
 */
const helplineSettingSchema = new Schema(
  {
    // The SOS emergency number dialed by delivery riders (default: 112 national emergency)
    sosEmergencyNumber: {
      type: String,
      default: "112",
      trim: true,
      maxlength: 30,
    },

    // Bulkimart customer support helpline
    bulkimartHelplineNumber: {
      type: String,
      default: "1800-111-2233",
      trim: true,
      maxlength: 30,
    },

    // Seller support helpline
    sellerHelplineNumber: {
      type: String,
      default: "1800-111-2233",
      trim: true,
      maxlength: 30,
    },

    // Rider operational support helpline (non-emergency helpdesk)
    riderHelplineNumber: {
      type: String,
      default: "1800-111-2233",
      trim: true,
      maxlength: 30,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 250,
      default: "Platform emergency and helpline settings",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
      type: ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

helplineSettingSchema.index({ isActive: 1 });
helplineSettingSchema.index({ createdAt: -1 });

const HelplineSetting = model("HelplineSetting", helplineSettingSchema);
export default HelplineSetting;
