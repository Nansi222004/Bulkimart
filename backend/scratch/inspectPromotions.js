import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function inspectAllDBs(uri, label) {
  console.log(`\n=================== INSPECTING ${label} ===================`);
  try {
    const conn = await mongoose.createConnection(uri).asPromise();
    const admin = conn.db.admin();
    const { databases } = await admin.listDatabases();
    console.log('Databases:', databases.map(d => `${d.name} (${(d.sizeOnDisk/1024/1024).toFixed(2)} MB)`));

    for (const dbInfo of databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue;
      const db = conn.useDb(dbInfo.name);
      const cols = await db.db.listCollections().toArray();
      console.log(`\n  DB [${dbInfo.name}] Collections:`, cols.map(c => c.name));
      
      for (const col of cols) {
        if (col.name.toLowerCase().includes('promotion') || col.name.toLowerCase().includes('banner') || col.name.toLowerCase().includes('seller')) {
          const count = await db.collection(col.name).countDocuments();
          console.log(`    -> Collection [${col.name}] has ${count} docs`);
          if (count > 0 && (col.name.toLowerCase().includes('promotion') || col.name.toLowerCase().includes('banner'))) {
            const sample = await db.collection(col.name).find().limit(5).toArray();
            console.log(`    Sample docs in [${col.name}]:`, JSON.stringify(sample, null, 2));
          }
        }
      }
    }
    await conn.close();
  } catch (err) {
    console.error(`Error inspecting ${label}:`, err.message);
  }
}

async function main() {
  await inspectAllDBs(process.env.MONGO_URI, 'MONGO_URI from .env (Cloud Atlas)');
  await inspectAllDBs('mongodb://127.0.0.1:27017', 'Local MongoDB');
}

main();
