import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * What a courier actually charged for one shipment, kept apart from the quote.
 *
 * `_id` is `<direction>:<shipmentId>`, so one shipment can only ever have one
 * record. The estimate lives on the order (`fulfillment.quote.courierCharge`);
 * this record exists once an admin has provider billing evidence. Every
 * recorded amount is kept in `evidence`, and the ledger is moved only by the
 * difference from the previous actual, so a correction never double-books.
 */
const evidenceSchema = new Schema({
  reference: { type: String, required: true },
  source: { type: String, enum: ['provider_invoice', 'provider_statement', 'provider_dashboard'], required: true },
  amountPaise: { type: Number, required: true, min: 0 },
  ledgerDeltaPaise: { type: Number, required: true },
  reason: { type: String, required: true },
  actorId: { type: ObjectId, ref: 'Admin', required: true },
  at: { type: Date, required: true },
}, { _id: false });

const courierChargeSchema = new Schema({
  _id: { type: String },
  provider: { type: String, enum: ['shiprocket'], default: 'shiprocket' },
  direction: { type: String, enum: ['forward', 'reverse'], required: true },
  orderId: { type: ObjectId, ref: 'Order', required: true },
  returnId: { type: ObjectId, ref: 'Return' },
  shipmentId: { type: String, required: true },
  awb: String,
  estimatePaise: { type: Number, min: 0 },
  status: { type: String, enum: ['actual', 'disputed'], required: true },
  actualPaise: { type: Number, min: 0 },
  evidence: { type: [evidenceSchema], default: [] },
  dispute: { reason: String, reference: String, actorId: { type: ObjectId, ref: 'Admin' }, at: Date },
  revision: { type: Number, default: 0 },
}, { timestamps: true, collection: 'courier_charges' });

const CourierCharge = model('CourierCharge', courierChargeSchema);
export default CourierCharge;
