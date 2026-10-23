import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const sellerPayoutSchema = new Schema(
  {
    payoutNo: { type: String, required: true, unique: true, index: true },
    sellerId: { type: ObjectId, ref: "Seller", required: true, index: true, immutable: true },
    amount: { type: Number, required: true, min: 0.01, immutable: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    bankDetails: {
      holderName: { type: String, immutable: true },
      bankName: { type: String, immutable: true },
      accountNo: { type: String, immutable: true },
      ifsc: { type: String, immutable: true },
      upiId: { type: String, immutable: true },
    },
    transactionRef: { type: String, default: "" },
    beneficiaryVerification: {
      processVersion: String, fingerprint: String, reviewedBy: { type: ObjectId, ref: 'Admin' }, verifiedAt: Date,
      evidenceReference: String, approvalReference: String, reason: String,
    },
    beneficiaryVerificationHistory: { type: [Schema.Types.Mixed], default: undefined },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    reconciliationReason: String,
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: ObjectId, ref: "Admin" },
    rejectionReason: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    ledgerEntryIds: [{ type: ObjectId, ref: "SellerLedgerEntry" }],
    requestedBy: { type: ObjectId, ref: "User" },
    failureReason: String,
  },
  { timestamps: true, collection: "seller_payouts" }
);

sellerPayoutSchema.index({ sellerId: 1, createdAt: -1 });

const SellerPayout = model("SellerPayout", sellerPayoutSchema);
export default SellerPayout;
