import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * The seller's GST credit note for goods a customer returned and was refunded for (audit G1).
 *
 * One credit note per refunded return, linked to the seller's original invoice for the order. Built once
 * from the return's frozen refund breakdown (refundBreakdown.productTax) and never edited. Numbers run per
 * seller per financial year in their own series ("CN…"), separate from invoice numbers.
 *
 * ACCOUNTANT REVIEW REQUIRED — the assumptions this follows are listed in the document itself
 * (document.assumptions) and in BULKIMART_FINANCIAL_INVARIANTS.md; none is settled tax advice.
 */
const creditNoteSchema = new Schema({
  returnId: { type: ObjectId, ref: 'Return', required: true },
  orderId:  { type: ObjectId, ref: 'Order', required: true },
  sellerId: { type: ObjectId, ref: 'Seller', required: true },
  userId:   { type: ObjectId, ref: 'User', required: true },
  invoiceId: { type: ObjectId, ref: 'TaxInvoice', required: true },
  invoiceNumber: { type: String, required: true },
  creditNoteNumber: { type: String, required: true },
  financialYear: { type: String, required: true },
  sequence: { type: Number, required: true },
  // 'gst_credit_note' when the seller is GST registered; otherwise a plain 'credit_note' with no GST.
  kind: { type: String, enum: ['gst_credit_note', 'credit_note'], required: true },
  issuedAt: { type: Date, required: true },
  document: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

creditNoteSchema.index({ returnId: 1 }, { unique: true });
creditNoteSchema.index({ sellerId: 1, financialYear: 1, sequence: 1 }, { unique: true });
creditNoteSchema.index({ orderId: 1 });

creditNoteSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function blockEdits() {
  throw new Error('Credit notes are immutable');
});

const creditNoteCounterSchema = new Schema({
  sellerId: { type: ObjectId, ref: 'Seller', required: true },
  financialYear: { type: String, required: true },
  sequence: { type: Number, default: 0 },
});
creditNoteCounterSchema.index({ sellerId: 1, financialYear: 1 }, { unique: true });

export const CreditNoteCounter = mongoose.models.CreditNoteCounter || model('CreditNoteCounter', creditNoteCounterSchema);
export default mongoose.models.CreditNote || model('CreditNote', creditNoteSchema);
