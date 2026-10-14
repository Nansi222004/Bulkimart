import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const quickCommerceFinancialSnapshotSchema = new Schema({
  snapshotNo: { type: String, required: true, unique: true, immutable: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, immutable: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true, immutable: true },
  groupRef: { type: String, index: true, immutable: true },
  provider: { type: String, required: true, immutable: true },
  providerQuoteReference: { type: String, immutable: true },
  providerShipmentReference: { type: String, immutable: true },
  currency: { type: String, default: 'INR', immutable: true },
  customerDeliveryChargeAvailableForFreight: { type: Number, required: true, min: 0, immutable: true },
  customerFreightContribution: { type: Number, required: true, min: 0, immutable: true },
  quotedCourierFreight: { type: Number, required: true, min: 0, immutable: true },
  eligibleCourierFreight: { type: Number, required: true, min: 0, immutable: true },
  finalProviderFreight: { type: Number, min: 0, immutable: true },
  vendorFreightShare: { type: Number, required: true, min: 0, immutable: true },
  serviceFee: {
    type: { type: String, enum: ['flat', 'percent'], required: true, immutable: true },
    configuredValue: { type: Number, required: true, min: 0, immutable: true },
    calculationBasis: { type: String, enum: ['eligible_courier_freight'], required: true, immutable: true },
    basisAmount: { type: Number, required: true, min: 0, immutable: true },
    amount: { type: Number, required: true, min: 0, immutable: true },
    version: { type: String, required: true, immutable: true },
    minimum: { type: Number, immutable: true },
    maximum: { type: Number, immutable: true },
    taxTreatment: { type: String, required: true, immutable: true },
  },
  vendorDeliveryFeeObligation: { type: Number, required: true, min: 0, immutable: true },
  accountingStatus: {
    type: String,
    enum: ['estimated', 'pending', 'posted', 'held', 'reversed', 'reconciled'],
    default: 'estimated',
    immutable: true,
  },
  quoteCapturedAt: { type: Date, required: true, immutable: true },
  quoteExpiresAt: { type: Date, immutable: true },
  calculationVersion: { type: String, default: 'option-b-v1', immutable: true },
}, { timestamps: true, collection: 'quick_commerce_financial_snapshots' });

const denyMutation = function denyMutation() {
  throw new Error('Financial snapshots are immutable; reconcile with ledger adjustments');
};
quickCommerceFinancialSnapshotSchema.pre('updateOne', denyMutation);
quickCommerceFinancialSnapshotSchema.pre('updateMany', denyMutation);
quickCommerceFinancialSnapshotSchema.pre('findOneAndUpdate', denyMutation);
quickCommerceFinancialSnapshotSchema.pre('deleteOne', denyMutation);
quickCommerceFinancialSnapshotSchema.pre('deleteMany', denyMutation);

const QuickCommerceFinancialSnapshot = model('QuickCommerceFinancialSnapshot', quickCommerceFinancialSnapshotSchema);
export default QuickCommerceFinancialSnapshot;
