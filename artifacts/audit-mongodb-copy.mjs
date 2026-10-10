import { MongoClient } from "../backend/node_modules/mongodb/lib/index.js";

const sourceUri = process.env.TASK_SOURCE_MONGO_URI;
const targetUri = process.env.TASK_TARGET_MONGO_URI;

if (!sourceUri || !targetUri) {
  throw new Error("TASK_SOURCE_MONGO_URI and TASK_TARGET_MONGO_URI are required");
}

const systemDatabases = new Set(["admin", "config", "local"]);

async function inspect(uri, requestedDatabase) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20_000,
    connectTimeoutMS: 20_000,
  });

  await client.connect();
  try {
    const listed = await client.db().admin().listDatabases();
    const databaseNames = requestedDatabase
      ? [requestedDatabase]
      : listed.databases
          .map(({ name }) => name)
          .filter((name) => !systemDatabases.has(name));

    const databases = [];
    for (const databaseName of databaseNames) {
      const db = client.db(databaseName);
      const collectionInfos = await db.listCollections({}, { nameOnly: true }).toArray();
      const collections = [];

      for (const { name } of collectionInfos) {
        const collection = db.collection(name);
        const [documents, indexes] = await Promise.all([
          collection.countDocuments({}),
          collection.listIndexes().toArray().catch(() => []),
        ]);
        collections.push({ name, documents, indexes: indexes.length });
      }

      databases.push({
        name: databaseName,
        collections: collections.sort((a, b) => a.name.localeCompare(b.name)),
        totalDocuments: collections.reduce((sum, item) => sum + item.documents, 0),
      });
    }

    return databases;
  } finally {
    await client.close();
  }
}

const targetDatabase = new URL(targetUri).pathname.replace(/^\//, "") || "bulkimart";
const [source, target] = await Promise.all([
  inspect(sourceUri),
  inspect(targetUri, targetDatabase),
]);

console.log(JSON.stringify({ source, target }, null, 2));
