import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * The seller's invoice for their goods on one delivered order. Bulkimart is the marketplace;
 * the seller is the supplier, so each seller on an order gets their own invoice and number.
 *
 * Built once from the order's frozen GST snapshot and never edited: what is stored here is
 * what the customer and seller were shown. Numbers run per seller per financial year.
 */
const taxInvoiceSchema = new Schema({
  orderId:  { type: ObjectId, ref: 'Order', required: true },
  sellerId: { type: ObjectId, ref: 'Seller', required: true },
  userId:   { type: ObjectId, ref: 'User', required: true },
  invoiceNumber: { type: String, required: true },
  financialYear: { type: String, required: true }, // e.g. "2026-27"
  sequence: { type: Number, required: true },
  // 'tax_invoice' when the seller is GST registered; an unregistered seller issues a plain 'invoice' with no GST.
  kind: { type: String, enum: ['tax_invoice', 'invoice'], required: true },
  issuedAt: { type: Date, required: true },
  document: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

taxInvoiceSchema.index({ orderId: 1, sellerId: 1 }, { unique: true });
taxInvoiceSchema.index({ sellerId: 1, financialYear: 1, sequence: 1 }, { unique: true });

const invoiceCounterSchema = new Schema({
  sellerId: { type: ObjectId, ref: 'Seller', required: true },
  financialYear: { type: String, required: true },
  sequence: { type: Number, default: 0 },
});
invoiceCounterSchema.index({ sellerId: 1, financialYear: 1 }, { unique: true });

taxInvoiceSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function blockEdits() {
  throw new Error('Tax invoices are immutable');
});

export const InvoiceCounter = mongoose.models.InvoiceCounter || model('InvoiceCounter', invoiceCounterSchema);
export default mongoose.models.TaxInvoice || model('TaxInvoice', taxInvoiceSchema);
