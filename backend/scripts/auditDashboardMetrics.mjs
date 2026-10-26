import 'dotenv/config';
import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';

// Read-only diagnosis. Uses the native client so model auto-indexing cannot
// create collections/indexes. Never emits credentials or customer information.
if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI for the intended environment.');
const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db();
  const orders = [];
  for await (const order of db.collection('orders').find({ status: 'delivered' }, { projection: { _id: 1, userId: 1, groupRef: 1, orderNo: 1, paymentId: 1, paymentMethod: 1, pricing: 1, financialSnapshot: 1, financialPosting: 1, codFinance: 1, items: 1 } }).limit(1000)) {
    const payment = order.paymentId ? await db.collection('payments').findOne({ _id: order.paymentId }, { projection: { userId: 1, orderId: 1, groupRef: 1, amount: 1, status: 1, method: 1, captures: 1, refund: 1 } }) : null;
    const entries = await db.collection('seller_ledger_entries').find({ orderId: order._id, account: 'commission_revenue' }, { projection: { _id: 0, metadata: 1, amount: 1, direction: 1 } }).toArray();
    orders.push({ orderId: String(order._id), orderNo: order.orderNo, total: order.pricing?.totalAmount, method: order.paymentMethod,
      snapshotVersion: order.financialSnapshot?.version ?? null, snapshotState: order.financialSnapshot?.state ?? null, financialPosting: order.financialPosting ?? null,
      paymentLinked: Boolean(payment), paymentStatus: payment?.status ?? null, settledCaptures: payment?.captures?.filter(row => row.disposition === 'settled').length || 0,
      paymentOwnerMatches: Boolean(payment?.userId && order.userId && String(payment.userId) === String(order.userId)),
      paymentMethodMatches: Boolean(payment && payment.method === order.paymentMethod), paymentOrderMatches: Boolean(payment && (payment.groupRef ? payment.groupRef === order.groupRef : String(payment.orderId) === String(order._id))),
      paymentAmount: payment?.amount ?? null, settledCaptureAmountsPaise: payment?.captures?.filter(row => row.disposition === 'settled').map(row => row.amountPaise) || [], refundTotal: payment?.refund?.totalRefundedAmount ?? 0,
      codStatus: order.codFinance?.status ?? null, commissionEntries: entries.length, commissionSources: [...new Set(entries.map(row => row.metadata?.source || 'legacy'))] });
  }
  const ledger = await db.collection('seller_ledger_entries').aggregate([{ $group: { _id: { account: '$account', source: '$metadata.source', type: '$type', bucket: '$bucket', direction: '$direction' }, records: { $sum: 1 }, recordedRupees: { $sum: '$amount' } } }]).toArray();
  mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
  const { getAdminFinancialMetrics } = await import('../services/adminDashboardMetrics.service.js');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const metrics = await getAdminFinancialMetrics();
  console.log(JSON.stringify({ mode: 'read-only', mutations: 0, deliveredOrderCount: await db.collection('orders').countDocuments({ status: 'delivered' }), orders,
    commissionRuleCount: await db.collection('commissions').countDocuments(), ledger, metrics }, null, 2));
} catch {
  console.error('Dashboard audit could not connect or read the configured database. No records were changed.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); await client.close(); }
