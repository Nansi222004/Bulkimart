import '../config/bootstrap.js';
import mongoose from 'mongoose';

const EXPECTED_HOST = 'cluster0.q39nutg.mongodb.net';
const EXPECTED_DATABASE = 'bulkimart';
const STALE_INDEX = 'customerId_1';
const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required');
const configured = new URL(uri);
if (
  configured.hostname.toLowerCase() !== EXPECTED_HOST ||
  decodeURIComponent(configured.pathname.replace(/^\//, '')) !== EXPECTED_DATABASE
) {
  throw new Error('Cart index migration refused: configured target is not the verified Bulkimart database.');
}

// Do not let model auto-indexing make changes during this explicit migration.
mongoose.set('autoIndex', false);

const reportIndexes = (indexes) => indexes.map(({ name, key, unique, sparse, partialFilterExpression }) => ({
  name,
  key,
  unique: Boolean(unique),
  sparse: Boolean(sparse),
  partialFilterExpression: partialFilterExpression || null,
}));

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
try {
  const connection = mongoose.connection;
  const db = connection.db;
  const actualHosts = [...connection.getClient().options.hosts].map((host) => String(host.host).toLowerCase());
  if (
    db.databaseName !== EXPECTED_DATABASE ||
    !actualHosts.some((host) => host.endsWith('.q39nutg.mongodb.net'))
  ) {
    throw new Error('Cart index migration refused: live connection does not match the verified Bulkimart target.');
  }

  const carts = db.collection('carts');
  const [indexes, documentCount, customerIdDocumentCount, missingCustomerIdCount] = await Promise.all([
    carts.listIndexes().toArray(),
    carts.countDocuments({}),
    carts.countDocuments({ customerId: { $exists: true, $ne: null } }),
    carts.countDocuments({ $or: [{ customerId: { $exists: false } }, { customerId: null }] }),
  ]);
  const stale = indexes.find((index) => index.name === STALE_INDEX);
  const expectedCompound = indexes.find((index) =>
    index.unique === true && index.key?.userId === 1 && index.key?.channel === 1 && Object.keys(index.key).length === 2,
  );

  if (stale && (stale.unique !== true || stale.key?.customerId !== 1 || Object.keys(stale.key).length !== 1)) {
    throw new Error('Cart index migration refused: customerId_1 does not match the expected stale unique index.');
  }
  if (!expectedCompound) {
    throw new Error('Cart index migration refused: the current unique userId/channel index is missing.');
  }

  const plan = {
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    target: { database: db.databaseName, clusterVerified: true },
    collection: 'carts',
    documentCount,
    customerIdDocumentCount,
    missingOrNullCustomerIdCount: missingCustomerIdCount,
    indexesBefore: reportIndexes(indexes),
    staleIndex: stale ? { name: stale.name, key: stale.key, unique: stale.unique } : null,
    requiredIndexPreserved: { name: expectedCompound.name, key: expectedCompound.key },
    documentsWillBeChanged: 0,
  };

  if (!APPLY || !stale) {
    console.log(JSON.stringify({ ...plan, result: !stale ? 'No stale customerId index; no changes made.' : 'Dry run only; rerun with --apply to back up carts and drop only customerId_1.' }, null, 2));
    process.exitCode = !stale ? 0 : APPLY ? 0 : 0;
  } else {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupName = `carts_index_backup_${stamp}`;
    const metadataName = `${backupName}_metadata`;
    const existing = await db.listCollections({ name: { $in: [backupName, metadataName] } }, { nameOnly: true }).toArray();
    if (existing.length) throw new Error('Cart index migration refused: backup collection name already exists.');

    const sourceDocuments = await carts.find({}).toArray();
    const backup = db.collection(backupName);
    const metadata = db.collection(metadataName);
    await backup.insertMany(sourceDocuments, { ordered: true, writeConcern: { w: 'majority' } });
    await metadata.insertOne({
      _id: 'cart-index-migration-snapshot',
      sourceDatabase: EXPECTED_DATABASE,
      sourceCollection: 'carts',
      capturedAt: new Date(),
      documentCount: sourceDocuments.length,
      indexes,
    }, { writeConcern: { w: 'majority' } });

    const [backupCount, metadataCount] = await Promise.all([
      backup.countDocuments({}),
      metadata.countDocuments({ _id: 'cart-index-migration-snapshot' }),
    ]);
    const backedIds = await backup.find({}, { projection: { _id: 1 } }).toArray();
    const sourceIds = new Set(sourceDocuments.map((doc) => String(doc._id)));
    if (
      backupCount !== sourceDocuments.length ||
      metadataCount !== 1 ||
      backedIds.some((doc) => !sourceIds.has(String(doc._id)))
    ) {
      throw new Error(`Cart backup verification failed; stale index was not dropped. Backup: ${backupName}`);
    }

    // Only the exact obsolete index is removed. Cart documents and all other
    // indexes are left untouched; the current userId/channel unique index stays.
    await carts.dropIndex(STALE_INDEX);
    const indexesAfter = await carts.listIndexes().toArray();
    if (indexesAfter.some((index) => index.name === STALE_INDEX) || !indexesAfter.some((index) => index.name === expectedCompound.name)) {
      throw new Error(`Index verification failed after migration; inspect target manually. Cart backup: ${backupName}`);
    }

    console.log(JSON.stringify({
      ...plan,
      result: 'Migrated',
      backup: { collection: backupName, metadataCollection: metadataName, documentsVerified: backupCount, indexesRecorded: indexes.length },
      droppedIndex: STALE_INDEX,
      indexesAfter: reportIndexes(indexesAfter),
    }, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
