import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema(
  {
    id: { type: String },
    title: { type: String, required: true },
    content: { type: String, required: true },
    points: [{ type: String }],
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const privacyPolicySchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ["user", "seller", "delivery", "shg"],
      unique: true,
    },
    roleTitle: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    summary: {
      type: String,
      default: "",
    },
    sections: [sectionSchema],
    version: {
      type: String,
      default: "1.0.0",
    },
    effectiveDate: {
      type: Date,
      default: Date.now,
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("PrivacyPolicy", privacyPolicySchema);
