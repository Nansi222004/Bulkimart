/**
 * One-time migration: Fix WalletLedger idempotencyKey index to be sparse.
 * Run: node backend/scripts/fixWalletLedgerIndex.mjs
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test";

async function fixIndex() {
  console.log("Connecting to:", MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  const collection = mongoose.connection.db.collection("walletledgers");
  const indexes = await collection.indexes();

  console.log("Current indexes:");
  indexes.forEach(idx => console.log(" ", idx.name, "| unique:", !!idx.unique, "| sparse:", !!idx.sparse));

  const idxName = "idempotencyKey_1";
  const existing = indexes.find(i => i.name === idxName);

  if (existing && !existing.sparse) {
    console.log("Dropping old non-sparse index...");
    await collection.dropIndex(idxName);
    console.log("Dropped.");
    await collection.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: idxName });
    console.log("Created new sparse unique index.");
  } else if (!existing) {
    await collection.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: idxName });
    console.log("Created sparse unique index (was missing).");
  } else {
    console.log("Index already sparse — no changes needed.");
  }

  await mongoose.disconnect();
  console.log("Migration complete.");
}

fixIndex().catch(err => { console.error(err); process.exit(1); });
