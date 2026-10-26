import { moneyPaise } from '../utils/financeMoney.js';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const SELLER_LEDGER_BUCKETS = ['pending', 'held', 'eligible', 'reserved', 'settled'];
export const SELLER_LEDGER_TYPES = [
  'advertising_receipt', 'advertising_tax', 'advertising_refund', 'advertising_recognition',
  'order_earning', 'platform_commission', 'quick_freight_obligation',
  'quick_service_fee', 'payout_reservation', 'payout_settlement',
  'adjustment', 'reversal', 'cod_hold', 'return_hold', 'quick_fee_tax', 'quick_fee_payment',
  'commission_tax', 'delivery_earning', 'cod_cash', 'customer_delivery', 'merchandise_gross',
  'tcs_deduction', 'tds_deduction', 'platform_discount', 'cod_shortage_writeoff',
  'same_day_incentive', 'courier_cost',
];
// Quick Shiprocket charges a seller prepays. They are a seller obligation with
// its own payment, never part of the seller's earnings buckets.
export const SELLER_COURIER_OBLIGATION_TYPES = ['quick_freight_obligation', 'quick_service_fee', 'quick_fee_tax', 'quick_fee_payment'];

const sellerLedgerEntrySchema = new Schema({
  entryNo: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', index: true, immutable: true },
  partnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', immutable: true },
  deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery', immutable: true },
  account: { type: String, enum: ['gst_assistance_collections', 'advertising_cash', 'advertising_liability', 'advertising_tax', 'advertising_revenue', 'seller_payable', 'rider_payable', 'commission_revenue', 'tax_liability', 'tcs_liability', 'tds_liability', 'platform_discount_expense', 'cod_shortage_expense', 'customer_delivery', 'cod_custody', 'cod_excess_liability', 'merchandise_gross', 'legal_provider_payable', 'legal_collections', 'parcel_collections', 'parcel_cash_custody', 'parcel_driver_payable', 'parcel_revenue', 'seller_courier_obligation', 'courier_expense'], default: 'seller_payable', immutable: true },
  advertisingCampaignId: { type: Schema.Types.ObjectId, ref: 'SellerPromotion', immutable: true },
  advertiserSellerId: { type: Schema.Types.ObjectId, ref: 'Seller', immutable: true },
  advertisingRevision: { type: Number, immutable: true },
  parcelDeliveryId: { type: Schema.Types.ObjectId, ref: 'ParcelDelivery', immutable: true },
  gstAssistanceRequestId: { type: Schema.Types.ObjectId, ref: 'GstAssistanceRequest', immutable: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true, immutable: true },
  payoutId: { type: Schema.Types.ObjectId, ref: 'SellerPayout', index: true, immutable: true },
  deliveryPayoutId: { type: Schema.Types.ObjectId, ref: 'DeliveryPayout', immutable: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', immutable: true },
  serviceApplicationId: { type: Schema.Types.ObjectId, ref: 'ServiceApplication', immutable: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'LegalProvider', immutable: true },
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
  if (this.gstAssistanceRequestId && (this.account !== 'gst_assistance_collections' || this.bucket !== 'held' || !this.paymentId || ['sellerId','partnerId','orderId','parcelDeliveryId','serviceApplicationId','advertisingCampaignId','advertiserSellerId','snapshotId'].some(k=>this[k]))) throw new Error('GST service collections require exclusive held service references');
  if (this.account === 'gst_assistance_collections' && !this.gstAssistanceRequestId) throw new Error('GST service collections require a GST assistance request');
  moneyPaise(this.amount);
  if (this.currency !== 'INR') throw new Error('Only INR ledger entries are supported');
  if (this.advertisingCampaignId || this.account?.startsWith('advertising_')) {
    if (!this.advertisingCampaignId || !this.advertiserSellerId || !this.advertisingRevision || !this.paymentId || !this.account?.startsWith('advertising_') || !this.type?.startsWith('advertising_') || this.bucket !== 'held' || this.currency !== 'INR'
      || ['sellerId','partnerId','orderId','payoutId','deliveryId','deliveryPayoutId','parcelDeliveryId','serviceApplicationId','providerId','snapshotId'].some(k=>this[k])) throw Error('Advertising postings require exclusive advertising references and accounts');
  }
  if (this.parcelDeliveryId && (this.bucket!=='held' || this.currency!=='INR' || !['parcel_collections','parcel_cash_custody','parcel_driver_payable','parcel_revenue','tax_liability'].includes(this.account) || ['sellerId','orderId','deliveryId','payoutId','deliveryPayoutId','serviceApplicationId','providerId','snapshotId'].some(k=>this[k]))) throw new Error('Parcel postings require held INR balances and exclusive parcel references and accounts');
  if (this.account === 'seller_payable' && !this.sellerId) throw new Error('Seller payable requires sellerId');
  if (this.account === 'seller_courier_obligation' && (!this.sellerId || !SELLER_COURIER_OBLIGATION_TYPES.includes(this.type))) throw new Error('Seller courier obligations require a seller and a courier obligation type');
  if (this.account === 'courier_expense' && (this.type !== 'courier_cost' || !this.orderId || this.sellerId || this.partnerId)) throw new Error('Courier expense requires an order and no seller or rider');
  if (this.account === 'rider_payable' && !this.partnerId) throw new Error('Rider payable requires partnerId');
  if (this.account?.startsWith('parcel_') && !this.parcelDeliveryId) throw new Error('Parcel account requires parcelDeliveryId');
  if (this.account === 'parcel_driver_payable' && !this.partnerId) throw new Error('Parcel driver payable requires partnerId');
  if (this.account === 'legal_provider_payable' && !this.providerId) throw new Error('Legal payable requires providerId');
});

const SellerLedgerEntry = model('SellerLedgerEntry', sellerLedgerEntrySchema);
export default SellerLedgerEntry;
