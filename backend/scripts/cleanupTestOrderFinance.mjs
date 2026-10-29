// One-off clean-up of development test orders and their money records (approved option A, 29 Oct 2026).
// Default is a DRY RUN that only counts. With --apply it first writes every affected document to a local
// EJSON file, then deletes/resets them in one transaction. Products, sellers, riders, customers, carts,
// campaigns and the parcel / service / GST-assistance / advertising money are not touched; neither are
// customer coin or wallet balances.
// Usage: node scripts/cleanupTestOrderFinance.mjs [--apply]
import '../config/environment.js';
import { MongoClient } from 'mongodb';
import { BSON } from 'mongodb';
const { EJSON } = BSON;
import { setServers } from 'node:dns';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const EXPECTED_DATABASE = 'bulkimart', EXPECTED_CLUSTER = 'cluster0.q39nutg.mongodb.net';
const apply = process.argv.includes('--apply');
const uri = new URL(process.env.MONGO_URI);
if (uri.pathname.replace(/^\//, '') !== EXPECTED_DATABASE || uri.hostname.toLowerCase() !== EXPECTED_CLUSTER) throw new Error('Safety lock: unexpected database');
const ORDER_LEDGER_ACCOUNTS = ['seller_payable', 'merchandise_gross', 'commission_revenue', 'tax_liability', 'tcs_liability', 'tds_liability', 'platform_discount_expense',
  'customer_delivery', 'rider_payable', 'cod_custody', 'cod_excess_liability', 'cod_shortage_expense'];

const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect(); const db = client.db(EXPECTED_DATABASE);
  const orders = await db.collection('orders').find({}).toArray();
  const ids = orders.map(o => o._id), sids = ids.map(String);
  const groupRefs = [...new Set(orders.map(o => o.groupRef).filter(Boolean))];
  const paymentIds = [...new Set(orders.map(o => o.paymentId).filter(Boolean).map(String))];
  const payments = await db.collection('payments').find({}).toArray();
  const orderPayments = payments.filter(p => paymentIds.includes(String(p._id)) && !p.advertising?.campaignId && !p.parcelDeliveryId);
  const orderRef = { $or: [{ orderId: { $in: ids } }, { orderId: { $in: sids } }, { 'metadata.orderId': { $in: [...ids, ...sids] } }] };
  // Every return and delivery is order data; those whose order is already gone are leftovers of earlier test runs.
  const plan = {
    orders: { filter: { _id: { $in: ids } } },
    payments: { filter: { _id: { $in: orderPayments.map(p => p._id) } } },
    returns: { filter: {} },
    deliveries: { filter: {} },
    seller_ledger_entries: { filter: { $or: [{ orderId: { $exists: true, $ne: null } }, { returnId: { $exists: true, $ne: null } }], account: { $in: ORDER_LEDGER_ACCOUNTS } } },
    checkoutattempts: { filter: {} },
    checkoutgroups: { filter: {} },
    couponredemptions: { filter: {} },
    digitalentitlements: { filter: orderRef },
    digitaldownloadaudits: { filter: orderRef },
    notifications: { filter: { $or: [{ 'metadata.orderId': { $exists: true, $ne: null } }, { 'metadata.returnId': { $exists: true, $ne: null } }] } },
    financeauditlogs: { filter: orderRef },
  };
  const found = {};
  for (const [name, step] of Object.entries(plan)) found[name] = await db.collection(name).find(step.filter).toArray();
  // Order payments must all be order payments; nothing else may be swept up.
  if (found.payments.some(p => p.advertising || p.parcelDeliveryId || p.applicationId)) throw new Error('Refusing: a non-order payment matched');
  if (found.seller_ledger_entries.some(e => !ORDER_LEDGER_ACCOUNTS.includes(e.account))) throw new Error('Refusing: a non-order ledger entry matched');
  const riders = await db.collection('deliverypartners').find({ earnings: { $exists: true } }).toArray();
  const coupons = await db.collection('coupons').find({}).toArray();
  const counts = Object.fromEntries(Object.entries(found).map(([name, rows]) => [name, rows.length]));
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', database: db.databaseName, delete: counts, resetRiderEarnings: riders.length, recountCoupons: coupons.length }, null, 1));
  if (!apply) process.exit(0);

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const dir = fileURLToPath(new URL(`../backups/finance-cleanup/${stamp}/`, import.meta.url));
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}before.ejson`, EJSON.stringify({ stamp, database: db.databaseName, deleted: found, riders, coupons }, { relaxed: false }));
  console.log('Local before-image:', dir);

  const session = client.startSession();
  const result = {};
  try {
    await session.withTransaction(async () => {
      for (const [name, rows] of Object.entries(found)) {
        if (!rows.length) { result[name] = 0; continue; }
        result[name] = (await db.collection(name).deleteMany({ _id: { $in: rows.map(r => r._id) } }, { session })).deletedCount;
        if (result[name] !== rows.length) throw new Error(`${name}: deleted ${result[name]} of ${rows.length}`);
      }
      // No order earnings remain, so every rider's order earnings counters return to zero.
      result.riderEarningsReset = (await db.collection('deliverypartners').updateMany({ _id: { $in: riders.map(r => r._id) } },
        { $set: { 'earnings.total': 0, 'earnings.pending': 0, 'earnings.held': 0, 'earnings.paid': 0, 'earnings.tips': 0, 'earnings.reserved': 0 } }, { session })).modifiedCount;
      // Coupon usage counts follow the redemptions that remain (none), so per-user limits start fresh.
      const left = await db.collection('couponredemptions').aggregate([{ $group: { _id: '$couponId', n: { $sum: 1 } } }], { session }).toArray();
      result.couponsRecounted = 0;
      for (const coupon of coupons) {
        const usedCount = left.find(row => String(row._id) === String(coupon._id))?.n || 0;
        if (coupon.usedCount !== usedCount) { await db.collection('coupons').updateOne({ _id: coupon._id }, { $set: { usedCount } }, { session }); result.couponsRecounted++; }
      }
    });
  } finally { await session.endSession(); }
  console.log(JSON.stringify({ applied: result }, null, 1));
} finally { await client.close(); }
