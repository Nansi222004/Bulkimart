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
  /**
   * Re-application attempts (invariant C3, amended 2026-11-25). A line that could not settle when recorded —
   * typically remitted before Shiprocket's delivered scan arrived — may be applied again by a finance admin.
   * `lines` above is never rewritten: each attempt is appended here with what every eligible line did, so the
   * original evidence and every later decision stay readable. `revision` is incremented by each attempt
   * inside its transaction, so two attempts on one remittance cannot run at the same time.
   */
  revision: { type: Number, default: 0 },
  reapplications: {
    type: [new Schema({
      at: { type: Date, required: true },
      actorId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
      reason: { type: String, required: true },
      results: { type: [new Schema({ awb: String, previousOutcome: String, outcome: String, orderId: { type: Schema.Types.ObjectId, ref: 'Order' }, detail: String }, { _id: false })], default: [] },
    }, { _id: false })],
    default: undefined,
  },
}, { timestamps: true });

// After recording, an update may only bump `revision` and append to `reapplications`: the evidence itself
// (reference, amounts, lines and their original outcomes) is never rewritten.
const REMITTANCE_UPDATABLE = /^(revision|reapplications|updatedAt)$/;
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  courierCodRemittanceSchema.pre(operation, function () {
    const update = this.getUpdate();
    if (Array.isArray(update)) throw new Error('Courier remittance evidence is immutable');
    for (const [operator, value] of Object.entries(update || {})) {
      if (!['$inc', '$push', '$set'].includes(operator)) throw new Error('Courier remittance evidence is immutable');
      for (const path of Object.keys(value || {})) if (!REMITTANCE_UPDATABLE.test(path)) throw new Error(`Courier remittance evidence is immutable (${path})`);
    }
  });
}
for (const operation of ['replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  courierCodRemittanceSchema.pre(operation, function () { throw new Error('Courier remittance evidence is immutable'); });
}

courierCodRemittanceSchema.index({ provider: 1, reference: 1 }, { unique: true });
courierCodRemittanceSchema.index({ 'lines.orderId': 1 });

export default model('CourierCodRemittance', courierCodRemittanceSchema);
