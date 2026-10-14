import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const quickCommerceDeliveryConfigSchema = new Schema({
  key: { type: String, default: 'quick_third_party', unique: true, immutable: true },
  enabled: { type: Boolean, default: false },
  fee: {
    type: { type: String, enum: ['flat', 'percent'] },
    value: { type: Number, min: 0 },
    version: { type: String, trim: true },
    calculationBasis: { type: String, default: 'eligible_courier_freight', immutable: true },
    minimum: Number,
    maximum: Number,
    taxTreatment: { type: String, default: 'pending_approval' },
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
