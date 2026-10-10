import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

export const WALLET_TRANSACTION_TYPE = {
  WALLET_TOPUP: "WALLET_TOPUP",
  ORDER_PAYMENT: "ORDER_PAYMENT",
  REFUND: "REFUND",
  ADMIN_CREDIT: "ADMIN_CREDIT",
  ADMIN_DEBIT: "ADMIN_DEBIT",
  CANCELLATION_REFUND: "CANCELLATION_REFUND",
  RETURN_REFUND: "RETURN_REFUND",
};

export const WALLET_TRANSACTION_TYPES = Object.values(WALLET_TRANSACTION_TYPE);

export const WALLET_REFERENCE_TYPE = {
  ORDER: "ORDER",
  PAYMENT: "PAYMENT",
  RETURN: "RETURN",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
  TOPUP: "TOPUP",
};

export const WALLET_REFERENCE_TYPES = Object.values(WALLET_REFERENCE_TYPE);

const walletLedgerSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: WALLET_TRANSACTION_TYPES,
      required: true,
    },
    direction: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["completed", "failed", "reversed"],
      default: "completed",
    },
    referenceType: {
      type: String,
      enum: WALLET_REFERENCE_TYPES,
      required: true,
    },
    referenceId: {
      type: String,
      default: null,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    createdBy: {
      type: ObjectId,
      refPath: "createdByModel",
      default: null,
    },
    createdByModel: {
      type: String,
      enum: ["User", "Admin"],
      default: null,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

walletLedgerSchema.index({ userId: 1, createdAt: -1 });

const WalletLedger = model("WalletLedger", walletLedgerSchema);
export default WalletLedger;
