// Read-only reconciliation report for records created before the finance gap
// fixes. Prints to stdout; writes nothing to the database or the repository.
// Apply is deliberately not supported: every correction needs separate review.
//
//   1. Delivered digital orders whose items were never stamped `deliveredAt`
//      (their earnings could never leave the return hold).
//   2. Posted Same-Day orders whose seller incentive went to platform delivery income.
//   3. Quick Shiprocket obligations posted to seller_payable (now reported as
//      courier obligations when read; listed for visibility only).
import mongoose from 'mongoose';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('Supply the explicitly approved target MONGO_URI; no default database is used');
if (process.argv.includes('--apply')) throw new Error('This report is read-only; apply is not supported');
await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
const paise = value => Math.round(Number(value || 0) * 100);
try {
  const db = mongoose.connection.db;
  const digital = await db.collection('orders').find({ status: 'delivered', 'items.fulfillmentType': 'digital', 'items.deliveredAt': { $exists: false } },
    { projection: { orderNo: 1, items: { _id: 1, fulfillmentType: 1, returnPolicy: 1 }, timeline: 1, financialPosting: 1 } }).limit(5000).toArray();
  const digitalRows = digital.map(order => {
    const activated = [...(order.timeline || [])].reverse().find(row => row.status === 'delivered')?.timestamp || null;
    return { orderId: String(order._id), orderNo: order.orderNo, financialPosting: order.financialPosting || null, proposedDeliveredAt: activated,
      returnable: (order.items || []).some(item => item.returnPolicy?.returnEligible), reviewNote: activated ? 'Stamp items from the recorded activation time' : 'No activation timestamp; manual review' };
  });

  const sameDay = await db.collection('orders').find({ 'delivery.mode': 'same_day', 'delivery.sellerIncentive': { $gt: 0 }, financialPosting: { $exists: true } },
    { projection: { orderNo: 1, 'delivery.sellerIncentive': 1, items: { sellerId: 1 } } }).limit(5000).toArray();
  const incentiveRows = [];
  for (const order of sameDay) {
    if (await db.collection('seller_ledger_entries').findOne({ orderId: order._id, type: 'same_day_incentive' }, { projection: { _id: 1 } })) continue;
    incentiveRows.push({ orderId: String(order._id), orderNo: order.orderNo, sellerIds: [...new Set((order.items || []).map(item => String(item.sellerId)))],
      incentivePaise: paise(order.delivery.sellerIncentive), reviewNote: 'Posted as customer delivery income; a reviewed adjustment would credit the seller' });
  }

  const legacyCourier = await db.collection('seller_ledger_entries').aggregate([
    { $match: { type: { $in: ['quick_freight_obligation', 'quick_service_fee', 'quick_fee_tax', 'quick_fee_payment'] }, $or: [{ account: 'seller_payable' }, { account: { $exists: false } }] } },
    { $group: { _id: { sellerId: '$sellerId', type: '$type', direction: '$direction' }, count: { $sum: 1 }, amountPaise: { $sum: { $round: [{ $multiply: ['$amount', 100] }, 0] } } } },
  ]).toArray();

  console.log(JSON.stringify({ mode: 'dry-run', mutations: 0, observedAt: new Date().toISOString(),
    digitalOrdersMissingDeliveredAt: digitalRows, sameDayIncentivesPostedAsPlatformIncome: incentiveRows,
    legacyCourierObligationsOnSellerPayable: legacyCourier.map(row => ({ ...row._id, sellerId: String(row._id.sellerId), count: row.count, amountPaise: row.amountPaise })) }, null, 2));
} finally {
  await mongoose.disconnect();
}
