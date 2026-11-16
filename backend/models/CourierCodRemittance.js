import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One courier COD remittance (e.g. a Shiprocket remittance batch / bank credit), recorded by a finance admin from the
 * provider's remittance report. This is the only evidence that settles a courier-delivered COD order: a Delivered
 * scan, a tracking number or an order status never does. One document per provider reference (unique), so the same
 * remittance cannot be applied twice; each line records what it did to its order.
 */
const lineSchema = new Schema({
  awb: { type: String, required: true },
  amountPaise: { type: Number, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  // applied | partial | excess | duplicate | unmatched | not_courier | not_delivered | no_finance_snapshot | not_cod
  outcome: { type: String, required: true },
  detail: String,
}, { _id: false });

const courierCodRemittanceSchema = new Schema({
  provider: { type: String, enum: ['shiprocket'], default: 'shiprocket', required: true },
  reference: { type: String, required: true, trim: true },
  remittedAt: { type: Date, required: true },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  totalPaise: { type: Number, required: true },
  // Hash of the normalised lines: a resubmission of the same reference must carry exactly the same lines.
  linesHash: { type: String, required: true },
  lines: { type: [lineSchema], default: [] },
  evidenceNote: { type: String, required: true },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true });

courierCodRemittanceSchema.index({ provider: 1, reference: 1 }, { unique: true });
courierCodRemittanceSchema.index({ 'lines.orderId': 1 });

export default model('CourierCodRemittance', courierCodRemittanceSchema);
