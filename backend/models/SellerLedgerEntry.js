import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const SELLER_LEDGER_BUCKETS = ['pending', 'held', 'eligible', 'reserved', 'settled'];
export const SELLER_LEDGER_TYPES = [
  'order_earning', 'platform_commission', 'quick_freight_obligation',
  'quick_service_fee', 'payout_reservation', 'payout_settlement',
  'adjustment', 'reversal', 'cod_hold', 'return_hold',
];

const sellerLedgerEntrySchema = new Schema({
  entryNo: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true, immutable: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true, immutable: true },
  payoutId: { type: Schema.Types.ObjectId, ref: 'SellerPayout', index: true, immutable: true },
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

const SellerLedgerEntry = model('SellerLedgerEntry', sellerLedgerEntrySchema);
export default SellerLedgerEntry;
