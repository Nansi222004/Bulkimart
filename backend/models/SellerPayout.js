import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const sellerPayoutSchema = new Schema(
  {
    payoutNo: { type: String, required: true, unique: true, index: true },
    sellerId: { type: ObjectId, ref: "Seller", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    bankDetails: {
      holderName: String,
      bankName: String,
      accountNo: String,
      ifsc: String,
      upiId: String,
    },
    transactionRef: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: ObjectId, ref: "Admin" },
    rejectionReason: { type: String },
  },
  { timestamps: true, collection: "seller_payouts" }
);

sellerPayoutSchema.index({ sellerId: 1, createdAt: -1 });

const SellerPayout = model("SellerPayout", sellerPayoutSchema);
export default SellerPayout;
