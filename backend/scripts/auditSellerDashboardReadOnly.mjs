// Reads the configured database without model initialization, jobs or writes.
import '../config/environment.js';
import { MongoClient } from 'mongodb';
import { setServers } from 'node:dns';
import { mkdir, writeFile } from 'node:fs/promises';
import { sellerOrderAmounts } from '../services/sellerOrderAmounts.service.js';
setServers(['8.8.8.8', '1.1.1.1']);
const store = process.argv.find(value => value.startsWith('--store='))?.slice(8) || 'Neelam';
const escaped = store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
const deadline = setTimeout(() => { console.error('Read-only store audit timed out'); process.exit(1); }, 45000);
try {
  await client.connect(); const db = client.db();
  const sellers = await db.collection('sellers').find({ $or: [{ businessName: new RegExp(escaped, 'i') }, { 'storeDetails.name': new RegExp(escaped, 'i') }] }, { projection: { _id: 1, businessName: 1, 'storeDetails.name': 1 } }).limit(10).toArray();
  if (sellers.length !== 1) throw Error(`Expected exactly one store; found ${sellers.length}. Refine --store.`);
  const seller = sellers[0];
  const orders = await db.collection('orders').find({ 'items.sellerId': seller._id }, { projection: { orderNo: 1, type: 1, status: 1, paymentMethod: 1, paymentId: 1, pricing: 1, financialSnapshot: 1, financialPosting: 1, codFinance: 1, financialReturnQuantities: 1, items: 1 } }).toArray();
  const payments = new Map((await db.collection('payments').find({ _id: { $in: orders.map(order => order.paymentId).filter(Boolean) } }, { projection: { status: 1, paidAt: 1, checkoutAbandonedAt: 1, captures: 1 } }).toArray()).map(payment => [String(payment._id), payment]));
  const rows = orders.map(order => {
    const payment = payments.get(String(order.paymentId));
    const amounts = sellerOrderAmounts(order, seller._id);
    return { orderNo: order.orderNo, storefront: order.type, status: order.status, paymentMethod: order.paymentMethod,
      paymentStatus: payment?.status || null, paidAtRecorded: !!payment?.paidAt,
      captures: payment?.captures?.length || 0,
      grossSales: order.items.filter(item => String(item.sellerId) === String(seller._id)).reduce((sum, item) => sum + item.price * item.qty, 0),
      customerDiscount: amounts.totalDiscount, salesAfterDiscount: amounts.customerItemsTotal,
      netEarnings: amounts.netEarnings, commission: amounts.commission, snapshotVersion: order.financialSnapshot?.version || null,
      posting: order.financialPosting || null, cashStatus: order.codFinance?.status || null,
      codVerifiedPaise: order.codFinance?.verifiedPaise || 0,
      returned: !!Object.keys(order.financialReturnQuantities || {}).length };
  });
  const ledger = await db.collection('seller_ledger_entries').aggregate([{ $match: { sellerId: seller._id } }, { $group: { _id: { account: '$account', bucket: '$bucket', type: '$type', direction: '$direction' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]).toArray();
  const report = { observedAt: new Date().toISOString(), readOnly: true, store: seller.storeDetails?.name || seller.businessName, orders: rows, ledger };
  const output = new URL('../../test-artifacts/seller-dashboard-audit/', import.meta.url);
  await mkdir(output, { recursive: true }); await writeFile(new URL('store-calculation.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); clearTimeout(deadline); }
