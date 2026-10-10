import { MongoClient } from "../backend/node_modules/mongodb/lib/index.js";

const sourceUri = process.env.TASK_SOURCE_MONGO_URI;
const targetUri = process.env.TASK_TARGET_MONGO_URI;
const sourceDatabaseName = process.env.TASK_SOURCE_DATABASE || "test";
const targetDatabaseName = process.env.TASK_TARGET_DATABASE || "bulkimart";
const batchSize = 250;

if (!sourceUri || !targetUri) {
  throw new Error("TASK_SOURCE_MONGO_URI and TASK_TARGET_MONGO_URI are required");
}

const sourceClient = new MongoClient(sourceUri, {
  serverSelectionTimeoutMS: 20_000,
  connectTimeoutMS: 20_000,
  readPreference: "secondaryPreferred",
});
const targetClient = new MongoClient(targetUri, {
  serverSelectionTimeoutMS: 20_000,
  connectTimeoutMS: 20_000,
  retryWrites: true,
});

function indexOptions(index) {
  const ignored = new Set(["key", "ns", "v"]);
  return Object.fromEntries(
    Object.entries(index).filter(([key]) => !ignored.has(key)),
  );
}

async function copyBatch(targetCollection, documents, result) {
  if (documents.length === 0) return;

  const operations = documents.map((document) => {
    const { _id, ...fields } = document;
    return {
      updateOne: {
        filter: { _id },
        update: { $setOnInsert: fields },
        upsert: true,
      },
    };
  });

  try {
    const writeResult = await targetCollection.bulkWrite(operations, {
      ordered: false,
      writeConcern: { w: "majority" },
    });
    result.inserted += writeResult.upsertedCount;
    result.alreadyPresent += writeResult.matchedCount;
  } catch (error) {
    const partial = error.result;
    result.inserted += partial?.upsertedCount ?? 0;
    result.alreadyPresent += partial?.matchedCount ?? 0;
    const writeErrors = error.writeErrors ?? [];
    result.writeErrors.push(
      ...writeErrors.map((item) => ({
        code: item.code,
        message: item.errmsg ?? item.message,
      })),
    );
  }
}

async function countMissingIds(sourceCollection, targetCollection) {
  let missing = 0;
  let ids = [];

  async function verifyBatch() {
    if (ids.length === 0) return;
    const found = await targetCollection.countDocuments({ _id: { $in: ids } });
    missing += ids.length - found;
    ids = [];
  }

  for await (const { _id } of sourceCollection.find({}, { projection: { _id: 1 } })) {
    ids.push(_id);
    if (ids.length >= batchSize) await verifyBatch();
  }
  await verifyBatch();
  return missing;
}

await Promise.all([sourceClient.connect(), targetClient.connect()]);

try {
  const sourceDb = sourceClient.db(sourceDatabaseName);
  const targetDb = targetClient.db(targetDatabaseName);
  const sourceCollections = await sourceDb
    .listCollections({}, { nameOnly: true })
    .toArray();
  const report = {
    mode: "insert-only (existing target _id values preserved)",
    sourceDatabase: sourceDatabaseName,
    targetDatabase: targetDatabaseName,
    collections: [],
  };

  for (const { name } of sourceCollections.sort((a, b) => a.name.localeCompare(b.name))) {
    const sourceCollection = sourceDb.collection(name);
    const targetCollection = targetDb.collection(name);
    const result = {
      name,
      sourceDocuments: await sourceCollection.countDocuments({}),
      inserted: 0,
      alreadyPresent: 0,
      writeErrors: [],
      indexesCreated: [],
      indexErrors: [],
      missingAfterCopy: 0,
    };

    let documents = [];
    for await (const document of sourceCollection.find({}).batchSize(batchSize)) {
      documents.push(document);
      if (documents.length >= batchSize) {
        await copyBatch(targetCollection, documents, result);
        documents = [];
      }
    }
    await copyBatch(targetCollection, documents, result);

    const sourceIndexes = await sourceCollection.listIndexes().toArray();
    for (const index of sourceIndexes.filter(({ name: indexName }) => indexName !== "_id_")) {
      try {
        const createdName = await targetCollection.createIndex(
          index.key,
          indexOptions(index),
        );
        result.indexesCreated.push(createdName);
      } catch (error) {
        result.indexErrors.push({
          name: index.name,
          code: error.code,
          message: error.message,
        });
      }
    }

    result.missingAfterCopy = await countMissingIds(sourceCollection, targetCollection);
    report.collections.push(result);
  }

  report.summary = {
    collections: report.collections.length,
    sourceDocuments: report.collections.reduce((sum, item) => sum + item.sourceDocuments, 0),
    inserted: report.collections.reduce((sum, item) => sum + item.inserted, 0),
    alreadyPresent: report.collections.reduce((sum, item) => sum + item.alreadyPresent, 0),
    writeErrors: report.collections.reduce((sum, item) => sum + item.writeErrors.length, 0),
    missingAfterCopy: report.collections.reduce((sum, item) => sum + item.missingAfterCopy, 0),
    indexErrors: report.collections.reduce((sum, item) => sum + item.indexErrors.length, 0),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.allSettled([sourceClient.close(), targetClient.close()]);
}
