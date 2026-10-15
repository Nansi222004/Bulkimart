// Read-only checkout index inspection. Uses the configured connection without
// importing application startup, models, seeds or index synchronization.
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';

const config = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)));
const uri = process.env.MONGO_URI || config.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required; no fallback database is selected.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, readPreference: 'primary' });
try {
  await client.connect();
  const db = client.db();
  if (db.databaseName !== 'bulkimart' && process.env.CHECKOUT_INSPECT_ALLOW_TEST !== '1') throw new Error('Refusing an unverified database name.');
  const version = await db.admin().command({ buildInfo: 1 });
  const target = new URL(uri.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:'));
  const report = { database: db.databaseName, serverVersion: version.version,
    targetFingerprint: createHash('sha256').update(`${target.host}/${db.databaseName}`).digest('hex'),
    environment: config.NODE_ENV, razorpayTestKeyConfigured: (config.RAZORPAY_KEY_ID || '').startsWith('rzp_test_'),
    mode: 'read-only', collections: [] };
  for (const name of ['checkoutattempts', 'orders', 'payments', 'carts', 'coinwallets', 'walletledgers']) {
    const collection = db.collection(name);
    const indexes = await collection.listIndexes().toArray().catch(error => { if (error.code === 26) return []; throw error; });
    const legacyField = { orders: 'orderId', payments: 'gatewayOrderId' }[name];
    const fieldTypes = legacyField ? await collection.aggregate([{ $group: { _id: { $type: `$${legacyField}` }, count: { $sum: 1 } } }]).toArray() : undefined;
    const statusCounts = ['orders', 'payments'].includes(name) ? await collection.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray() : undefined;
    const duplicates = legacyField ? await collection.aggregate([
      { $match: { [legacyField]: { $exists: true } } },
      { $group: { _id: `$${legacyField}`, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $count: 'groups' },
    ]).toArray() : [];
    report.collections.push({ name, count: await collection.countDocuments(), ...(statusCounts ? { statusCounts } : {}), ...(fieldTypes ? { legacyField, fieldTypes, duplicatePresentGroups: duplicates[0]?.groups || 0 } : {}), indexes: indexes.filter(index => index.unique || index.name === '_id_').map(index => ({ name: index.name, key: index.key, unique: Boolean(index.unique || index.name === '_id_'), sparse: Boolean(index.sparse), ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}) })) });
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // A driver message may contain connection information. Do not print it.
  console.error(JSON.stringify({ error: 'Checkout database inspection failed', name: error.name, code: error.code }));
  process.exitCode = 1;
} finally { await client.close(); }
