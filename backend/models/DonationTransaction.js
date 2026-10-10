import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

export const DONATION_STATUS = {
  COLLECTED: "COLLECTED",
  REFUNDED: "REFUNDED",
  DISBURSED: "DISBURSED",
};

const adminNoteSchema = new Schema(
  {
    note: { type: String, required: true, trim: true },
    adminId: { type: ObjectId, ref: "Admin", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const donationTransactionSchema = new Schema(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    orderId: { type: ObjectId, ref: "Order", index: true },
    paymentId: { type: ObjectId, ref: "Payment", index: true },
    userId: { type: ObjectId, ref: "User", required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    title: { type: String, default: "Donate & Support Transformative Social Work In India" },

    // Customer donation message/comment entered at checkout (max 250 characters)
    customerComment: { type: String, trim: true, maxlength: 250, default: "" },

    // Immutable internal audit notes added by admins
    adminNotes: [adminNoteSchema],

    status: {
      type: String,
      enum: Object.values(DONATION_STATUS),
      default: DONATION_STATUS.COLLECTED,
      index: true,
    },

    organizationDestination: {
      type: { type: String, default: "Bulkimart Social Fund" },
      name: { type: String, default: "Bulkimart Transformative Social Work Initiative" },
      reference: { type: String, default: "" },
    },

    paymentMethod: { type: String },
    currency: { type: String, default: "INR" },

    collectedAt: { type: Date, default: Date.now },
    refundedAt: { type: Date },
    disbursedAt: { type: Date },

    // Unique idempotency key to prevent duplicate settlement (e.g. DONATION:<orderId>)
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true, collection: "donations" }
);

donationTransactionSchema.index({ userId: 1, createdAt: -1 });
donationTransactionSchema.index({ createdAt: -1 });

const DonationTransaction = model("DonationTransaction", donationTransactionSchema);
export default DonationTransaction;
