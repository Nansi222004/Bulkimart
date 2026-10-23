import mongoose from 'mongoose';
import { adBillingPolicySchema } from './advertisingBilling.schema.js';
const { Schema } = mongoose;
const id = (ref) => ({ type: Schema.Types.ObjectId, ref });
export const advertisingPoliciesSchema = new Schema({
  billing: { type: adBillingPolicySchema, default: undefined },
  sellerPause: String, cancellation: String, rejection: String, suspension: String,
  unusedService: String, refunds: String,
  tax: { treatment: String, invoiceIssuer: String, calculation: String, creditNotes: String },
  attribution: { windowHours: Number, conversionEvent: String, model: String },
}, { _id: false });
const terms = new Schema({
  packageId: id('PromotionPackage'), packageVersion: Number,
  name: String, amountPaise: Number, durationDays: Number, maxProducts: Number,
  currency: { type: String, enum: ['INR'] },
  billingMode: { type: String, enum: ['FIXED_DURATION'] },
  refundPolicyReference: String, pausePolicyReference: String,
  taxPolicyReference: String,
  placement: String, module: String, description: String,
  policies: { type: advertisingPoliciesSchema, default: undefined },
}, { _id: false });
export const advertisingCampaignSchema = new Schema({
  revision: { type: Number, required: true, min: 1 },
  review: { type: String, enum: ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'], required: true },
  funding: { type: String, enum: ['UNPAID', 'PAYMENT_PENDING', 'FUNDED', 'PAYMENT_FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'RECONCILIATION_REQUIRED'], required: true },
  delivery: { type: String, enum: ['NOT_SCHEDULED', 'SCHEDULED', 'ACTIVE', 'SELLER_PAUSED', 'UNAVAILABLE', 'EXHAUSTED', 'COMPLETED', 'CANCELLED', 'ADMIN_SUSPENDED'], required: true },
  placement: { type: String, enum: ['CATEGORY_SPONSORED'], required: true },
  categoryId: id('Category'),
  items: [{ _id: false, productId: id('Product'), variantId: Schema.Types.ObjectId }],
  requestedStartAt: Date,
  approvedRevision: Number,
  paid: { type: new Schema({ paymentId: id('Payment'), revision: Number, startAt: Date, endAt: Date,
    authorizedBy: id('Admin'), authorizedAt: Date, invoiceReference: String, lastEligibilityCheckAt: Date }, { _id: false }), default: undefined },
  // Independent free test authorization. Never changes funding or paid delivery.
  pilot: { type: new Schema({
    enabled: { type: Boolean, required: true }, revision: { type: Number, required: true },
    startAt: { type: Date, required: true }, endAt: { type: Date, required: true },
    authorizedBy: id('Admin'), authorizedAt: Date,
  }, { _id: false }), default: undefined },
  terms: { type: terms, default: undefined },
  history: [{ _id: false, action: String, actorId: Schema.Types.ObjectId,
    actorType: { type: String, enum: ['seller', 'admin', 'system'] }, revision: Number,
    review: String, delivery: String, reason: String, at: Date }],
}, { _id: false });
export const advertisingPackageSchema = new Schema({
  version: { type: Number, required: true, min: 1 },
  amountPaise: { type: Number, required: true, min: 1 },
  billingMode: { type: String, enum: ['FIXED_DURATION'], required: true },
  categories: [id('Category')],
  refundPolicyReference: String, pausePolicyReference: String, taxPolicyReference: String,
  description: String, archivedAt: Date,
  policies: { type: advertisingPoliciesSchema, default: undefined },
  history: [{ _id: false, version: Number, actorId: Schema.Types.ObjectId, reason: String, at: Date }],
}, { _id: false });
