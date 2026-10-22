// Explicit maintenance tool. Never imported by API boot. Reports by default.
import mongoose from 'mongoose';
const uri = process.env.MONGO_URI;
if (!uri) throw new Error('Supply the explicitly approved target MONGO_URI; no default database is used');
const apply = process.argv.includes('--apply');
if (apply && !process.env.FINANCE_INDEX_APPROVAL_REFERENCE?.trim()) throw new Error('An index deployment approval reference is required');
await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
try {
  const database = mongoose.connection.db;
  const hello = await database.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Replica set or supported sharded transaction topology required; no changes made');
  const specifications = [
    ['seller_ledger_entries', { idempotencyKey: 1 }, { unique: true, name: 'idempotencyKey_1' }],
    ['deliverypayouts', { idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } }, name: 'finance_rider_payout_event_unique' }],
    ['orders', { 'financialSnapshot.version': 1, paymentMethod: 1, createdAt: -1 }, { name: 'finance_order_monitoring' }],
    ['seller_ledger_entries', { account: 1, partnerId: 1, bucket: 1 }, { name: 'finance_rider_balance' }],
    ['commissions', { financeVersion: 1, channel: 1, effectiveDate: -1 }, { name: 'finance_commission_effective' }],
  ];
  for (const [name, keys, options] of specifications) {
    const collection = database.collection(name);
    if (options.unique) {
      const match = options.partialFilterExpression || {};
      const duplicate = await collection.aggregate([{ $match: match }, { $group: { _id: `$${Object.keys(keys)[0]}`, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }]).next();
      if (duplicate) throw new Error(`Duplicate keys in ${name}; reconcile separately. No records will be changed or deleted.`);
    }
  }
  // All duplicate checks finish before any additive index is created.
  for (const [name, keys, options] of specifications) {
    if (apply) await database.collection(name).createIndex(keys, options);
    console.log(`${apply ? 'Prepared' : 'Would prepare'} ${name}: ${options.name}`);
  }
  console.log('No historical order, ledger, cash, wallet or payout records modified.');
} finally { await mongoose.disconnect(); }
