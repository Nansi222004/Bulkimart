import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const quickCommerceDeliveryConfigSchema = new Schema({
  key: { type: String, default: 'quick_third_party', unique: true, immutable: true },
  enabled: { type: Boolean, default: false },
  revision: { type: Number, default: 0 },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  effectiveAt: Date,
  paymentRequired: { type: Boolean, default: true },
  history: [{ _id: false, revision: Number, changedAt: Date, changedBy: Schema.Types.ObjectId, configuration: Schema.Types.Mixed }],
  fee: {
    type: { type: String, enum: ['flat', 'percent'] },
    value: { type: Number, min: 0 },
    version: { type: String, trim: true },
    calculationBasis: { type: String, enum: ['eligible_courier_freight', 'vendor_freight_share'] },
    minimum: Number,
    maximum: Number,
    taxTreatment: { type: String, default: 'pending_approval' },
    taxRate: { type: Number, min: 0, max: 100 },
  },
  policy: {
    customerFreightAllocation: { type: String, default: 'apply_first', immutable: true },
    customerSurplusTreatment: { type: String, default: 'pending_approval' },
    returnAndHoldPolicy: { type: String, default: 'pending_approval' },
    cancellationCostPolicy: { type: String, default: 'pending_approval' },
    codReconciliationPolicy: { type: String, default: 'pending_approval' },
    insufficientFundsPolicy: { type: String, default: 'pending_approval' },
    sharedFreightAllocation: { type: String, default: 'pending_approval' },
    historicalOrderPolicy: { type: String, default: 'no_retroactive_deductions', immutable: true },
    liveReleaseApproval: { type: String, default: 'pending_approval' },
  },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true, collection: 'quick_commerce_delivery_configs' });

const QuickCommerceDeliveryConfig = model('QuickCommerceDeliveryConfig', quickCommerceDeliveryConfigSchema);
export default QuickCommerceDeliveryConfig;
