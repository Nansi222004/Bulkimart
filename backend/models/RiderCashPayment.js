import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A rider paying Bulkimart what they owe from COD parcels (their wallet is negative):
 * by UPI (with the UTR / transaction ID) or in cash (with a receipt reference).
 * An admin approves it with the amount actually received, which credits the rider's
 * wallet, or rejects it with a reason. One pending payment per rider at a time.
 */
const riderCashPaymentSchema = new Schema(
  {
    partnerId:   { type: ObjectId, ref: "DeliveryPartner", required: true },
    userId:      { type: ObjectId, ref: "User", required: true },
    amountPaise: { type: Number, required: true, min: 100 },
    method:      { type: String, enum: ["upi", "cash"], required: true },
    reference:   { type: String, required: true, trim: true, maxlength: 100 },
    note:        { type: String, trim: true, maxlength: 300 },
    status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    // What the admin confirmed receiving (credited to the wallet); may differ from the claim.
    approvedPaise: Number,
    rejectReason:  { type: String, trim: true, maxlength: 300 },
    reviewedBy:    { type: ObjectId, ref: "Admin" },
    reviewedAt:    Date,
  },
  { timestamps: true }
);

riderCashPaymentSchema.index({ partnerId: 1, createdAt: -1 });
riderCashPaymentSchema.index({ status: 1, createdAt: 1 });
// One payment waiting for review per rider.
riderCashPaymentSchema.index({ partnerId: 1 }, { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_payment_per_rider" });

const RiderCashPayment = model("RiderCashPayment", riderCashPaymentSchema);
export default RiderCashPayment;
