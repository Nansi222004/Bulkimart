import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const SELLER_LEDGER_BUCKETS = ['pending', 'held', 'eligible', 'reserved', 'settled'];
export const SELLER_LEDGER_TYPES = [
  'order_earning', 'platform_commission', 'quick_freight_obligation',
  'quick_service_fee', 'payout_reservation', 'payout_settlement',
  'adjustment', 'reversal', 'cod_hold', 'return_hold', 'quick_fee_tax', 'quick_fee_payment',
  'commission_tax', 'delivery_earning', 'cod_cash', 'customer_delivery', 'merchandise_gross',
];

const sellerLedgerEntrySchema = new Schema({
  entryNo: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', index: true, immutable: true },
  partnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', immutable: true },
  deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery', immutable: true },
  account: { type: String, enum: ['seller_payable', 'rider_payable', 'commission_revenue', 'tax_liability', 'customer_delivery', 'cod_custody', 'cod_excess_liability', 'merchandise_gross'], default: 'seller_payable', immutable: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true, immutable: true },
  payoutId: { type: Schema.Types.ObjectId, ref: 'SellerPayout', index: true, immutable: true },
  deliveryPayoutId: { type: Schema.Types.ObjectId, ref: 'DeliveryPayout', immutable: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', immutable: true },
  snapshotId: { type: Schema.Types.ObjectId, ref: 'QuickCommerceFinancialSnapshot', immutable: true },
  type: { type: String, enum: SELLER_LEDGER_TYPES, required: true, immutable: true },
  direction: { type: String, enum: ['credit', 'debit'], required: true, immutable: true },
  bucket: { type: String, enum: SELLER_LEDGER_BUCKETS, required: true, immutable: true },
  amount: { type: Number, required: true, min: 0.01, immutable: true },
  currency: { type: String, default: 'INR', immutable: true },
  status: { type: String, enum: ['posted', 'reversal'], default: 'posted', immutable: true },
  reversesEntryId: { type: Schema.Types.ObjectId, ref: 'SellerLedgerEntry', immutable: true },
  reference: { type: String, immutable: true },
  description: { type: String, required: true, immutable: true },
  metadata: { type: Schema.Types.Mixed, default: {}, immutable: true },
  postedBy: { type: Schema.Types.ObjectId, immutable: true },
  postedByRole: { type: String, enum: ['system', 'admin'], default: 'system', immutable: true },
}, { timestamps: true, collection: 'seller_ledger_entries' });

sellerLedgerEntrySchema.index({ sellerId: 1, createdAt: -1 });
sellerLedgerEntrySchema.index({ orderId: 1, type: 1 });

const denyMutation = function denyMutation() {
  throw new Error('Seller ledger entries are append-only; post a compensating entry instead');
};
sellerLedgerEntrySchema.pre('updateOne', denyMutation);
sellerLedgerEntrySchema.pre('updateMany', denyMutation);
sellerLedgerEntrySchema.pre('findOneAndUpdate', denyMutation);
sellerLedgerEntrySchema.pre('deleteOne', denyMutation);
sellerLedgerEntrySchema.pre('deleteMany', denyMutation);
for (const operation of ['replaceOne', 'findOneAndReplace', 'findOneAndDelete']) sellerLedgerEntrySchema.pre(operation, denyMutation);
sellerLedgerEntrySchema.pre('bulkWrite', denyMutation);
sellerLedgerEntrySchema.pre('save', function () { if (!this.isNew) denyMutation(); });
sellerLedgerEntrySchema.pre('validate', function () {
  if (this.account === 'seller_payable' && !this.sellerId) throw new Error('Seller payable requires sellerId');
  if (this.account === 'rider_payable' && !this.partnerId) throw new Error('Rider payable requires partnerId');
});

const SellerLedgerEntry = model('SellerLedgerEntry', sellerLedgerEntrySchema);
export default SellerLedgerEntry;
