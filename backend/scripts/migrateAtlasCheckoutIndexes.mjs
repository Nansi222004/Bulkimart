// Explicit operator-approved TEST-database migration. Never imported at startup.
// Unlike the loopback repair utility, this has a fixed Atlas target fingerprint
// and an exact allowlist of two index replacements. It has no document writes.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { LEGACY_CHECKOUT_INDEXES, reconcileCheckoutIndexes } from '../services/checkoutIndexCompatibility.service.js';

const EXPECTED_DATABASE = 'bulkimart';
const EXPECTED_TARGET = 'b2b1394033a06d764178e46f2b61e34319f471f71e42f692b45a32ddaa6816b7';
const CONFIRMATION = '--confirm=MIGRATE_BULKIMART_TEST_CHECKOUT_INDEXES';
const config = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)));
const uri = process.env.MONGO_URI || config.MONGO_URI;
const apply = process.argv.includes('--apply');
let client;
const assert = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { safeMigrationMessage: true }); };
try {
  assert(uri?.startsWith('mongodb+srv://'), 'This migration requires the verified Atlas connection.');
  const target = new URL(uri.replace(/^mongodb\+srv:/, 'https:'));
  const database = decodeURIComponent(target.pathname.slice(1));
  const fingerprint = createHash('sha256').update(`${target.host}/${database}`).digest('hex');
  assert(database === EXPECTED_DATABASE && fingerprint === EXPECTED_TARGET, 'Target database/fingerprint mismatch.');
  assert(!apply || (process.argv.includes(CONFIRMATION) && process.argv.includes(`--target=${EXPECTED_TARGET}`)), 'Explicit test-database confirmation and target fingerprint required.');
  assert(!apply || (config.NODE_ENV === 'development' && (!process.env.NODE_ENV || process.env.NODE_ENV === 'development')), 'Apply is restricted to this development/test configuration.');
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db();
  assert(db.databaseName === EXPECTED_DATABASE, 'Connected database mismatch.');
  const { versionArray, version } = await db.admin().command({ buildInfo: 1 });
  assert(versionArray[0] === 8, 'Server major version differs from the reviewed Atlas 8 index migration.');
  const snapshots = {};
  for (const name of ['payments', 'orders', 'checkoutattempts']) snapshots[name] = await db.collection(name).indexes();
  const canonical = (indexes, key) => indexes.some(index => index.unique === true && !index.sparse && !index.partialFilterExpression && JSON.stringify(index.key) === JSON.stringify(key));
  assert(canonical(snapshots.orders, { orderNo: 1 }), 'Canonical order-number uniqueness missing or unexpected.');
  assert(canonical(snapshots.checkoutattempts, { userId: 1, key: 1 }), 'Canonical checkout uniqueness missing or unexpected.');
  const checks = [];
  for (const spec of LEGACY_CHECKOUT_INDEXES) {
    const collection = db.collection(spec.collection);
    const groups = await collection.aggregate([
      { $match: { [spec.field]: { $exists: true } } },
      { $group: { _id: `$${spec.field}`, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $count: 'groups' },
    ]).toArray();
    assert(!groups.length, 'Duplicate present legacy IDs require separate review; no indexes changed.');
    checks.push({ collection: spec.collection, records: await collection.countDocuments(),
      explicitNulls: await collection.countDocuments({ [spec.field]: { $type: 10 } }), duplicatePresentGroups: 0 });
  }
  // Validate ALL definitions before changing either collection.
  const plan = await reconcileCheckoutIndexes(db);
  assert(plan.every(item => item.legacyPresent || item.replacementVerified), 'An expected legacy/replacement constraint is missing.');
  console.log(JSON.stringify({ mode: apply ? 'authorized-test-index-migration' : 'read-only-plan', database, fingerprint, serverVersion: version, checks, plan }));
  if (apply) {
    const backupDirectory = new URL('../private-data/maintenance/', import.meta.url);
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(new URL(`checkout-indexes-${Date.now()}.json`, backupDirectory), JSON.stringify({ database, fingerprint, serverVersion: version, indexes: snapshots }, null, 2), { mode: 0o600, flag: 'wx' });
    const result = await reconcileCheckoutIndexes(db, { apply: true });
    for (const name of Object.keys(snapshots)) {
      const after = await db.collection(name).indexes();
      const ignored = new Set(LEGACY_CHECKOUT_INDEXES.filter(spec => spec.collection === name).flatMap(spec => [spec.oldName, spec.name]));
      const unchanged = indexes => JSON.stringify(indexes.filter(index => !ignored.has(index.name)).sort((a, b) => a.name.localeCompare(b.name)));
      assert(unchanged(snapshots[name]) === unchanged(after), 'Unexpected unrelated index change; stop and review.');
    }
    const verified = await reconcileCheckoutIndexes(db);
    assert(verified.every(item => !item.legacyPresent && item.replacementVerified), 'Final replacement verification failed.');
    console.log(JSON.stringify({ result, verified, documentWrites: 0, canonicalIndexesPreserved: true }));
  }
} catch (error) {
  // Never print raw driver messages/values or connection strings.
  console.error(JSON.stringify({ event: 'checkout_index_migration_stopped', name: error.name, code: error.code,
    reason: error.safeMigrationMessage ? error.message : 'Operation rejected; old constraint is retained unless replacement was verified first. Inspect protected diagnostics.' }));
  process.exitCode = 1;
} finally { await client?.close(); }
