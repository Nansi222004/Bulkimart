// Read-only forensic probe. No models, startup, jobs, providers, indexes or mutations.
import '../config/environment.js';
import { financeFlags } from '../services/financeSafety.service.js';
import { setServers } from 'node:dns';
import { MongoClient } from 'mongodb';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const deadline = setTimeout(() => { console.error('Read-only audit timed out'); process.exit(1); }, 45000);
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db();
  const orders = await db.collection('orders').find({ orderNo: { $in: ['ORD-20261019-CIRFK5', 'ORD-20261015-K2OCHK'] } }, { projection: {
    orderNo: 1, groupRef: 1, type: 1, salesChannel: 1, status: 1, createdAt: 1, updatedAt: 1,
    pricing: 1, paymentMethod: 1, paymentStatus: 1, paymentId: 1, financialSnapshot: 1, financialPosting: 1, financialRevision: 1,
    financialReturnQuantities: 1, codFinance: 1, deliveryId: 1, deliveryPartnerId: 1, fulfillment: 1,
    'shiprocket.orderId': 1, 'shiprocket.shipmentId': 1, 'shiprocket.status': 1,
    'items._id': 1, 'items.productId': 1, 'items.sellerId': 1, 'items.price': 1, 'items.qty': 1, 'items.type': 1,
    'items.returnPolicy': 1, 'items.returnedQty': 1, 'items.deliveredAt': 1, 'items.returnEligibleUntil': 1,
    'timeline.status': 1, 'timeline.timestamp': 1,
  } }).toArray();
  const orderIds = orders.map(o => o._id), sellerIds = [...new Map(orders.flatMap(o => o.items || []).filter(i => i.sellerId).map(i => [String(i.sellerId), i.sellerId])).values()];
  const paymentIds = orders.map(o => o.paymentId).filter(Boolean);
  const evidence = { observedAt: new Date().toISOString(), database: db.databaseName, readOnly: true,
    flags: financeFlags(),
    orders,
    sellers: await db.collection('sellers').find({ _id: { $in: sellerIds } }, { projection: { userId: 1, status: 1, businessName: 1, financialLedgerVersion: 1, earnings: 1, balance: 1, createdAt: 1, 'bankDetails.verified': 1, 'bankDetails.verificationStatus': 1 } }).toArray(),
    payments: await db.collection('payments').find({ $or: [{ _id: { $in: paymentIds } }, { orderId: { $in: orderIds } }] }, { projection: { orderId: 1, groupRef: 1, amount: 1, method: 1, status: 1, currency: 1, gateway: 1, gatewayOrderId: 1, gatewayPaymentId: 1, paidAt: 1, createdAt: 1, settlementRevision: 1, 'captures.amountPaise': 1, 'captures.currency': 1, 'captures.disposition': 1, 'captures.gatewayPaymentId': 1, 'refunds.status': 1, 'refunds.amountPaise': 1, 'refundObligations.amountPaise': 1, 'refundObligations.status': 1 } }).toArray(),
    returns: await db.collection('returns').find({ orderId: { $in: orderIds } }, { projection: { orderId: 1, orderItemId: 1, sellerId: 1, quantity: 1, status: 1, refundAmount: 1, refundReference: 1, refundStatus: 1, refundMethod: 1, type: 1, createdAt: 1 } }).toArray(),
    deliveries: await db.collection('deliveries').find({ orderId: { $in: orderIds } }, { projection: { orderId: 1, partnerId: 1, status: 1, direction: 1, otpVerified: 1, financialEarningStatus: 1, partnerEarnings: 1, partnerTip: 1, createdAt: 1, completedAt: 1 } }).toArray(),
    quickSnapshots: await db.collection('quick_commerce_financial_snapshots').find({ orderId: { $in: orderIds } }, { projection: { orderId: 1, sellerId: 1, accountingStatus: 1, quotedCourierFreight: 1, vendorFreightShare: 1, vendorDeliveryFeeObligation: 1, serviceFee: 1, createdAt: 1 } }).toArray(),
    ledgerCounts: await db.collection('seller_ledger_entries').aggregate([{ $match: { $or: [{ sellerId: { $in: sellerIds } }, { orderId: { $in: orderIds } }] } }, { $group: { _id: { sellerId: '$sellerId', account: '$account', bucket: '$bucket', type: '$type', direction: '$direction' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]).toArray(),
    payouts: await db.collection('seller_payouts').find({ sellerId: { $in: sellerIds } }, { projection: { sellerId: 1, payoutNo: 1, amount: 1, status: 1, requestedAt: 1, processedAt: 1, ledgerEntryIds: 1, createdAt: 1, failureReason: 1 } }).limit(100).toArray(),
    commissions: await db.collection('commissions').find({}, { projection: { vendorType: 1, categoryId: 1, productId: 1, percentage: 1, flatFee: 1, effectiveDate: 1, isActive: 1, financeVersion: 1, channel: 1, method: 1, value: 1, minimum: 1, maximum: 1, base: 1, fixedScope: 1, taxTreatment: 1, taxRate: 1, version: 1, createdAt: 1 } }).limit(100).toArray(),
    orderCoverage: await db.collection('orders').aggregate([{ $group: { _id: { snapshotVersion: '$financialSnapshot.version', snapshotState: '$financialSnapshot.state', posting: '$financialPosting' }, count: { $sum: 1 }, earliest: { $min: '$createdAt' }, latest: { $max: '$createdAt' } } }]).toArray(),
    indexes: {}, collectionCounts: {},
  };
  // Counts/indexes only: never output unrelated account, bank or customer records.
  for (const name of ['seller_ledger_entries', 'seller_payouts', 'quick_commerce_financial_snapshots', 'payments', 'commissions']) {
    evidence.collectionCounts[name] = await db.collection(name).countDocuments({});
    try { evidence.indexes[name] = (await db.collection(name).indexes()).map(({ name, key, unique, sparse, partialFilterExpression }) => ({ name, key, unique, sparse, partialFilterExpression })); }
    catch (e) { evidence.indexes[name] = { error: e.codeName || e.name }; }
  }
  const target = new URL('../../test-artifacts/seller-earnings-audit/', import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL('database-evidence.json', target), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ evidence: fileURLToPath(new URL('database-evidence.json', target)), matchedOrders: orders.length, sellerIds: sellerIds.map(String), collectionCounts: evidence.collectionCounts, flags: evidence.flags }));
} finally { await client.close(); clearTimeout(deadline); }
