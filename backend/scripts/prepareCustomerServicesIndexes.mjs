// Additive local preparation only. Never imports API boot or edits customer data.
import '../config/environment.js';
import { MongoClient } from 'mongodb';

const production = ['NODE_ENV', 'DEPLOYMENT_ENV'].some(k => ['production', 'prod', 'deployment-production'].includes(String(process.env[k]).trim().toLowerCase()));
if (production || !process.env.MONGO_URI) throw new Error('Use a configured development database for local service preparation');
const apply = process.argv.includes('--apply');
const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
const specs = [
  ['serviceapplications', 'customerKey', { unique: true, sparse: true, name: 'legal_customer_key_unique' }],
  ['legalproviders', 'user', { unique: true, name: 'legal_provider_user_unique' }],
];
const deadline = setTimeout(() => { console.error('Index preparation timed out. Run the read-only readiness check to inspect current state.'); process.exit(1); }, 30000);
try {
  await client.connect();
  const db = client.db();
  // Check both collections before creating either unique index. Existing records
  // are never rewritten or removed to make an index succeed.
  for (const [name, field, options] of specs) {
    const match = options.sparse ? { [field]: { $exists: true } } : {};
    const duplicate = await db.collection(name).aggregate([
      { $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $limit: 1 },
    ]).next();
    if (duplicate) throw new Error(`Duplicate keys prevent preparation of ${options.name}; no records were changed`);
  }
  for (const [name, field, options] of specs) {
    if (apply) await db.collection(name).createIndex({ [field]: 1 }, options);
    console.log(`${apply ? 'Prepared' : 'Would prepare'} ${name}: ${options.name}`);
  }
} catch (error) {
  console.error(error.message?.startsWith('Duplicate keys') ? error.message : 'Index preparation could not finish. Check connectivity and index permissions; customer records were not changed.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); await client.close(); }
