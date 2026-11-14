import mongoose from "mongoose";

const { Schema, model } = mongoose;

// One row per transactional email, so a retried checkout, payment webhook or booking never emails twice.
// `key` names the business event, e.g. "order:<orderId>", "service:<applicationId>:submitted", "parcel:<id>:booked".
const emailLogSchema = new Schema(
  {
    key: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    subject: String,
    status: { type: String, enum: ["sending", "sent", "failed", "skipped"], default: "sending" },
    error: String,
  },
  { timestamps: true }
);

emailLogSchema.index({ key: 1 }, { name: "email_log_key_unique", unique: true });

const EmailLog = model("EmailLog", emailLogSchema);
export default EmailLog;
