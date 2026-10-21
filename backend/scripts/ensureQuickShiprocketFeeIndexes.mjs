import '../config/environment.js';
import mongoose from 'mongoose';

// Explicit, additive preparation only. Does not alter fee settings, records,
// payment credentials, balances or shipments. Run only after DB change approval.
try {
  if (!process.env.MONGO_URI) throw new Error('Database configuration is missing');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const definitions = [
    ['payments', { quickFeeSnapshotId: 1 }, { unique: true, partialFilterExpression: { quickFeeSnapshotId: { $type: 'objectId' } } }],
    ['quick_commerce_financial_snapshots', { orderId: 1 }, { unique: true }],
    ['quick_commerce_financial_snapshots', { snapshotNo: 1 }, { unique: true }],
    ['quick_commerce_delivery_configs', { key: 1 }, { unique: true }],
    ['seller_ledger_entries', { idempotencyKey: 1 }, { unique: true }],
    ['seller_ledger_entries', { entryNo: 1 }, { unique: true }],
  ];
  for (const [collection, keys, options] of definitions) await mongoose.connection.collection(collection).createIndex(keys, options);
  console.log('Quick Shiprocket fee uniqueness indexes are ready. No financial records were changed.');
} catch {
  console.error('Index preparation failed. Check database permissions and existing index definitions privately; do not drop indexes or enable charging.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
