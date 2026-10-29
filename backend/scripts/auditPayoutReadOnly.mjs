// Raw Mongo reads only: no application startup, jobs, providers or mutations.
import '../config/environment.js';
import { MongoClient } from 'mongodb';
import { setServers } from 'node:dns';
setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
const deadline = setTimeout(() => { console.error('Read-only payout audit timed out'); process.exit(1); }, 45000);
try {
  await client.connect(); const db = client.db();
  const riders = await db.collection('deliverypartners').find({}, { projection: { userId: 1, status: 1, financialWorkflowVersion: 1, earnings: 1, totalDeliveries: 1, 'bankDetails.accountNo': 1, 'bankDetails.upiId': 1 } }).toArray();
  const sellers = await db.collection('sellers').find({ status: 'approved' }, { projection: { businessName: 1, 'storeDetails.name': 1, earnings: 1, balance: 1 } }).toArray();
  const ledger = await db.collection('seller_ledger_entries').aggregate([{ $match: { account: { $in: ['seller_payable', 'rider_payable'] } } }, { $group: {
    _id: { seller: '$sellerId', rider: '$partnerId', account: '$account', bucket: '$bucket' }, amount: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] } }, entries: { $sum: 1 },
  } }]).toArray();
  const orders = await db.collection('orders').find({ status: 'delivered' }, { projection: { orderNo: 1, 'items.sellerId': 1, 'items.price': 1, 'items.qty': 1, 'financialSnapshot.version': 1, 'financialSnapshot.state': 1, financialPosting: 1, financeAutomation: 1, paymentMethod: 1, deliveryPartnerId: 1, 'codFinance.status': 1, 'codFinance.collectedPaise': 1, 'codFinance.verifiedPaise': 1 } }).toArray();
  const payouts = await db.collection('deliverypayouts').find({ status: 'pending' }, { projection: { partnerId: 1, amount: 1, status: 1, financeVersion: 1 } }).toArray();
  const cod = await db.collection('orders').find({ paymentMethod: 'cod', deliveryPartnerId: { $exists: true }, 'financialSnapshot.version': 2 }, { projection: { orderNo: 1, deliveryPartnerId: 1, status: 1, 'codFinance.status': 1, 'codFinance.collectedPaise': 1, 'codFinance.verifiedPaise': 1, 'codFinance.writtenOffPaise': 1 } }).toArray();
  console.log(JSON.stringify({ readOnly: true, policy: await db.collection('finance_policies').findOne({ _id: 'current' }, { projection: { sellerMinPayout: 1, riderMinPayout: 1, payoutSchedule: 1 } }), sellers, riders: riders.map(({ bankDetails, ...r }) => ({ ...r, hasDestination: Boolean(bankDetails?.accountNo || bankDetails?.upiId) })), ledger, orders, cod, pendingRiderPayouts: payouts }, null, 2));
} finally { await client.close(); clearTimeout(deadline); }
