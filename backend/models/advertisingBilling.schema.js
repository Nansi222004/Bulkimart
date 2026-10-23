import mongoose from 'mongoose';
const { Schema } = mongoose;
export const adBillingPolicySchema = new Schema({
  approvalReference: String,
  taxTreatment: { type: String, enum: ['NONE', 'INCLUSIVE', 'EXCLUSIVE'] },
  taxRateBps: Number, taxRecognition: { type: String, enum: ['ON_RECEIPT'] },
  issuer: String, invoiceMode: { type: String, enum: ['NOT_REQUIRED', 'EXTERNAL_REFERENCE'] },
  creditNoteMode: { type: String, enum: ['NOT_REQUIRED', 'EXTERNAL_REFERENCE'] },
  startCondition: { type: String, enum: ['VERIFIED_PAYMENT_OR_REQUESTED_START'] },
  interruption: { type: String, enum: ['STOP_AND_REVIEW'] },
  refunds: { type: new Schema({ cancellationBps: Number, suspensionBps: Number,
    unavailableBps: Number, unusedBps: Number }, { _id: false }), default: undefined },
  recognition: { type: String, enum: ['MANUAL_AFTER_COMPLETION'] },
}, { _id: false });
export const adPaymentSchema = new Schema({
  campaignId: { type: Schema.Types.ObjectId, ref: 'SellerPromotion', required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true },
  revision: { type: Number, required: true }, reference: { type: String, required: true },
  expectedPaise: { type: Number, required: true }, basePaise: Number, taxPaise: Number,
  currency: { type: String, enum: ['INR'], required: true },
  creation: { type: String, enum: ['INITIALIZING', 'ISSUED', 'UNKNOWN'] },
  gatewayMode: { type: String, enum: ['test','live'], required: true },
  checkoutExpiresAt: Date,
  idempotencyKey: String, primaryCaptureId: String, receiptPaise: { type: Number, default: 0 },
  refundedPaise: { type: Number, default: 0 }, recognizedPaise: { type: Number, default: 0 },
  refundBusy: Boolean, reconciliation: String, reconciledAt: Date,
  invoiceReference: String,
  // Provider observations, not expense recognition or bank settlement postings.
  gatewayFeePaise: Number, gatewayFeeTaxPaise: Number,
  refunds: [{ _id: false, key: String, receipt: String, amountPaise: Number,
    paymentId: String, providerRefundId: String, reason: String, actorId: Schema.Types.ObjectId,
    creditNoteReference: String, status: { type: String, enum: ['DISPATCHING', 'UNKNOWN', 'PENDING', 'PROCESSED', 'FAILED'] },
    createdAt: Date, resolvedAt: Date }],
}, { _id: false });
