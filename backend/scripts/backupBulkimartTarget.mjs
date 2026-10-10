import '../config/bootstrap.js';
import mongoose from 'mongoose';

const EXPECTED_DATABASE = 'bulkimart';
const EXPECTED_CLUSTER = 'cluster0.q39nutg.mongodb.net';
const configuredUri = process.env.MONGO_URI;

if (!configuredUri) throw new Error('MONGO_URI is required');

const parsedUri = new URL(configuredUri);
const configuredDatabase = parsedUri.pathname.replace(/^\//, '');
const configuredCluster = parsedUri.hostname.toLowerCase();

if (configuredDatabase !== EXPECTED_DATABASE || configuredCluster !== EXPECTED_CLUSTER) {
  throw new Error(
    `Safety lock refused connection: expected ${EXPECTED_DATABASE} on ${EXPECTED_CLUSTER}; ` +
    `received database=${configuredDatabase || '(none)'}, cluster=${configuredCluster || '(none)'}`,
  );
}

const client = await mongoose.connect(configuredUri, { serverSelectionTimeoutMS: 20_000 });

const indexOptions = (index) => {
  const ignored = new Set(['key', 'ns', 'v']);
  return Object.fromEntries(Object.entries(index).filter(([key]) => !ignored.has(key)));
};

try {
  const mongoClient = client.connection.getClient();
  const targetDb = mongoClient.db(EXPECTED_DATABASE);
  const actualHosts = [...mongoClient.options.hosts].map((host) => String(host.host).toLowerCase());

  if (
    targetDb.databaseName !== EXPECTED_DATABASE ||
    !actualHosts.some((host) => host.endsWith('.q39nutg.mongodb.net'))
  ) {
    throw new Error('Safety lock rejected the active MongoDB connection');
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backupDatabase = `${EXPECTED_DATABASE}_bak_${stamp}`;
  const existingDatabases = await targetDb.admin().listDatabases();
  if (existingDatabases.databases.some(({ name }) => name === backupDatabase)) {
    throw new Error(`Backup database already exists: ${backupDatabase}`);
  }

  const backupDb = mongoClient.db(backupDatabase);
  const sourceCollections = await targetDb.listCollections({}, { nameOnly: true }).toArray();
  const report = [];

  for (const { name } of sourceCollections.sort((a, b) => a.name.localeCompare(b.name))) {
    const source = targetDb.collection(name);
    const destination = backupDb.collection(name);
    const documents = await source.find({}).toArray();

    await backupDb.createCollection(name);
    if (documents.length > 0) {
      await destination.insertMany(documents, { ordered: true, writeConcern: { w: 'majority' } });
    }

    const sourceIndexes = await source.listIndexes().toArray();
    for (const index of sourceIndexes.filter(({ name: indexName }) => indexName !== '_id_')) {
      await destination.createIndex(index.key, indexOptions(index));
    }

    const [backupDocuments, backupIndexes] = await Promise.all([
      destination.countDocuments({}),
      destination.listIndexes().toArray(),
    ]);
    if (backupDocuments !== documents.length || backupIndexes.length !== sourceIndexes.length) {
      throw new Error(
        `Backup verification failed for ${name}: ` +
        `documents ${backupDocuments}/${documents.length}, indexes ${backupIndexes.length}/${sourceIndexes.length}`,
      );
    }
    report.push({ name, documents: backupDocuments, indexes: backupIndexes.length });
  }

  console.log(JSON.stringify({
    mode: 'TARGET_BACKUP',
    sourceConnectionUsed: false,
    target: { database: EXPECTED_DATABASE, cluster: EXPECTED_CLUSTER, verified: true },
    backupDatabase,
    collectionsVerified: report.length,
    documentsVerified: report.reduce((sum, item) => sum + item.documents, 0),
    indexesVerified: report.reduce((sum, item) => sum + item.indexes, 0),
    verificationPassed: true,
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
