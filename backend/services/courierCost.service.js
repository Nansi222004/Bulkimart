import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import CourierCharge from '../models/CourierCharge.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { financialTransaction, requireFinanceOperation } from './financeSafety.service.js';
import { moneyPaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';

/**
 * Courier costs for Shiprocket shipments the platform pays for.
 *
 * The quote shown when a shipment is created is only an estimate and is never
 * booked. An actual cost is booked to `courier_expense` only from provider
 * billing evidence an admin records; until then the shipment stays
 * "estimated". Quick Commerce freight is excluded: the seller prepays it
 * through the Quick Shiprocket obligation, which already records it.
 */
export const COURIER_EVIDENCE_SOURCES = ['provider_invoice', 'provider_statement', 'provider_dashboard'];
const paiseOf = value => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.round(Number(value) * 100) : null);

const proofOf = input => {
  const reference = String(input.reference || '').trim();
  const reason = String(input.reason || '').trim();
  if (reference.length < 4 || reference.length > 200 || reason.length < 5 || reason.length > 1000) throw httpError(400, 'Provider billing reference and a reason of at least five characters are required');
  return { reference, reason };
};

// The shipment a request refers to, resolved from the order or return itself.
const resolveShipment = async ({ direction, orderId, returnId }, session) => {
  if (direction === 'reverse') {
    if (!mongoose.isValidObjectId(returnId)) throw httpError(400, 'Invalid return');
    const ret = await Return.findById(returnId).select('orderId returnNumber pickupMethod reverseBooking.shipmentId awbNumber').session(session).lean();
    const shipmentId = ret?.reverseBooking?.shipmentId;
    if (!ret || ret.pickupMethod !== 'SHIPROCKET' || !shipmentId) throw httpError(409, 'Return has no Shiprocket reverse shipment');
    return { key: `reverse:${shipmentId}`, direction, orderId: ret.orderId, returnId: ret._id, shipmentId, awb: ret.awbNumber, estimatePaise: null };
  }
  if (direction !== 'forward') throw httpError(400, 'Choose forward or reverse shipment');
  if (!mongoose.isValidObjectId(orderId)) throw httpError(400, 'Invalid order');
  const order = await Order.findById(orderId).select('shiprocket.shipmentId shiprocket.awb fulfillment.quote fulfillment.financialSnapshotId').session(session).lean();
  const shipmentId = order?.shiprocket?.shipmentId;
  if (!order || !shipmentId) throw httpError(409, 'Order has no Shiprocket shipment');
  if (order.fulfillment?.financialSnapshotId) throw httpError(409, 'Quick Commerce freight is charged to the seller through its prepaid obligation');
  return { key: `forward:${shipmentId}`, direction, orderId: order._id, shipmentId, awb: order.shiprocket.awb, estimatePaise: paiseOf(order.fulfillment?.quote?.courierCharge) };
};

/**
 * Book what the provider actually charged. Replaying the same evidence is a
 * no-op; new evidence with a different amount books only the difference, so a
 * corrected invoice adjusts the expense instead of adding to it.
 */
export const recordActualCourierCost = async ({ actorId, input = {} }) => {
  requireFinanceOperation();
  const proof = proofOf(input);
  if (!COURIER_EVIDENCE_SOURCES.includes(input.source)) throw httpError(400, 'Choose where the provider charge was confirmed');
  const amountPaise = moneyPaise(input.amount, 'Actual courier charge');
  return financialTransaction(async session => {
    const shipment = await resolveShipment(input, session);
    const charge = await CourierCharge.findById(shipment.key).session(session);
    const previous = charge?.evidence.find(row => row.reference === proof.reference);
    if (previous) {
      if (previous.amountPaise !== amountPaise || previous.source !== input.source) throw httpError(409, 'Billing reference already recorded with a different amount');
      return charge;
    }
    const deltaPaise = amountPaise - (charge?.actualPaise ?? 0);
    if (deltaPaise) await postLedgerEntry({
      idempotencyKey: `COURIER_COST:${shipment.key}:${crypto.createHash('sha256').update(proof.reference).digest('hex')}`,
      orderId: shipment.orderId, account: 'courier_expense', type: 'courier_cost', direction: deltaPaise > 0 ? 'credit' : 'debit', bucket: 'held',
      amount: Math.abs(deltaPaise) / 100, reference: proof.reference, postedBy: actorId, postedByRole: 'admin',
      description: `${charge?.actualPaise != null ? 'Courier charge adjustment' : 'Courier charge'} ${shipment.direction} shipment ${shipment.shipmentId}`,
      metadata: { source: 'courier-cost-v1', shipmentKey: shipment.key, shipmentId: shipment.shipmentId, awb: shipment.awb || null, returnId: shipment.returnId ? String(shipment.returnId) : null,
        evidenceSource: input.source, amountPaise, previousActualPaise: charge?.actualPaise ?? null, estimatePaise: shipment.estimatePaise },
    }, { session });
    const evidence = { ...proof, source: input.source, amountPaise, ledgerDeltaPaise: deltaPaise, actorId, at: new Date() };
    if (!charge) {
      const [created] = await CourierCharge.create([{ _id: shipment.key, direction: shipment.direction, orderId: shipment.orderId, returnId: shipment.returnId,
        shipmentId: shipment.shipmentId, awb: shipment.awb, estimatePaise: shipment.estimatePaise ?? undefined, status: 'actual', actualPaise: amountPaise, evidence: [evidence], revision: 1 }], { session });
      return created;
    }
    // New evidence settles an open dispute on this shipment.
    const updated = await CourierCharge.findOneAndUpdate({ _id: shipment.key, revision: charge.revision },
      { $set: { status: 'actual', actualPaise: amountPaise }, $unset: { dispute: 1 }, $push: { evidence }, $inc: { revision: 1 } }, { session, returnDocument: 'after' });
    if (!updated) throw httpError(409, 'Courier charge changed; refresh before saving');
    return updated;
  });
};

/** Flag a provider charge as disputed. No money moves; any booked actual stays until corrected evidence arrives. */
export const disputeCourierCost = async ({ actorId, input = {} }) => {
  requireFinanceOperation();
  const proof = proofOf(input);
  return financialTransaction(async session => {
    const shipment = await resolveShipment(input, session);
    const dispute = { ...proof, actorId, at: new Date() };
    const charge = await CourierCharge.findById(shipment.key).session(session);
    if (!charge) {
      const [created] = await CourierCharge.create([{ _id: shipment.key, direction: shipment.direction, orderId: shipment.orderId, returnId: shipment.returnId,
        shipmentId: shipment.shipmentId, awb: shipment.awb, estimatePaise: shipment.estimatePaise ?? undefined, status: 'disputed', dispute, revision: 1 }], { session });
      return created;
    }
    return CourierCharge.findOneAndUpdate({ _id: shipment.key }, { $set: { status: 'disputed', dispute }, $inc: { revision: 1 } }, { session, returnDocument: 'after' });
  });
};

const statusOf = (estimatePaise, charge) => charge?.status || (estimatePaise == null ? 'unknown' : 'estimated');

/** Platform-paid Shiprocket shipments with their estimate, actual and status. */
export const listCourierCosts = async ({ direction = 'forward', page = 1, limit = 25 } = {}) => {
  const skip = (Math.max(1, page) - 1) * limit;
  if (direction === 'reverse') {
    const match = { pickupMethod: 'SHIPROCKET', 'reverseBooking.shipmentId': { $nin: [null, ''] } };
    const [returns, total] = await Promise.all([
      Return.find(match).select('orderId returnNumber reverseBooking.shipmentId awbNumber createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Return.countDocuments(match),
    ]);
    const charges = new Map((await CourierCharge.find({ _id: { $in: returns.map(ret => `reverse:${ret.reverseBooking.shipmentId}`) } }).lean()).map(row => [row._id, row]));
    return { total, page, limit, rows: returns.map(ret => {
      const charge = charges.get(`reverse:${ret.reverseBooking.shipmentId}`);
      return { key: `reverse:${ret.reverseBooking.shipmentId}`, direction, returnId: ret._id, returnNumber: ret.returnNumber, orderId: ret.orderId,
        shipmentId: ret.reverseBooking.shipmentId, awb: ret.awbNumber, estimatePaise: null, actualPaise: charge?.actualPaise ?? null, status: statusOf(null, charge), evidence: charge?.evidence || [], dispute: charge?.dispute };
    }) };
  }
  const match = { 'shiprocket.shipmentId': { $nin: [null, ''] }, 'fulfillment.financialSnapshotId': { $exists: false } };
  const [orders, total] = await Promise.all([
    Order.find(match).select('orderNo shiprocket.shipmentId shiprocket.awb fulfillment.quote.courierCharge createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(match),
  ]);
  const charges = new Map((await CourierCharge.find({ _id: { $in: orders.map(order => `forward:${order.shiprocket.shipmentId}`) } }).lean()).map(row => [row._id, row]));
  return { total, page, limit, rows: orders.map(order => {
    const key = `forward:${order.shiprocket.shipmentId}`, charge = charges.get(key), estimatePaise = paiseOf(order.fulfillment?.quote?.courierCharge);
    return { key, direction, orderId: order._id, orderNo: order.orderNo, shipmentId: order.shiprocket.shipmentId, awb: order.shiprocket.awb,
      estimatePaise, actualPaise: charge?.actualPaise ?? null, status: statusOf(estimatePaise, charge), evidence: charge?.evidence || [], dispute: charge?.dispute };
  }) };
};

/** Counts and the estimate total still waiting for provider evidence, for the Overview. */
export const courierCostSummary = async () => {
  const rows = await Order.aggregate([
    { $match: { 'shiprocket.shipmentId': { $nin: [null, ''] }, 'fulfillment.financialSnapshotId': { $exists: false } } },
    { $project: { key: { $concat: ['forward:', { $toString: '$shiprocket.shipmentId' }] }, estimate: '$fulfillment.quote.courierCharge' } },
    { $lookup: { from: CourierCharge.collection.name, localField: 'key', foreignField: '_id', as: 'charge', pipeline: [{ $project: { status: 1 } }] } },
  ]);
  const summary = { shipments: rows.length, actual: 0, disputed: 0, estimatedOnly: 0, estimatedUnverifiedPaise: 0 };
  for (const row of rows) {
    const status = row.charge[0]?.status;
    if (status === 'actual') summary.actual++;
    else if (status === 'disputed') summary.disputed++;
    else { summary.estimatedOnly++; summary.estimatedUnverifiedPaise += paiseOf(row.estimate) || 0; }
  }
  return summary;
};
