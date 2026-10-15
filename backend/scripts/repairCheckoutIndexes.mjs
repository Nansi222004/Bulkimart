import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { reconcileCheckoutIndexes } from '../services/checkoutIndexCompatibility.service.js';

const config = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)));
const uri = process.env.MONGO_URI || config.MONGO_URI;
const apply = process.argv.includes('--apply');
let parsed;
try { parsed = uri && new URL(uri.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:')); }
catch { console.error('Connection format could not be verified. No indexes changed.'); process.exit(1); }
// Even --apply cannot change a remote cluster. Production maintenance needs a
// separate authorized operator and reviewed procedure; no environment escape.
if (!uri || (apply && (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  || process.env.NODE_ENV === 'production' || config.NODE_ENV === 'production'
  || !process.argv.includes('--confirm=REPLACE_LEGACY_CHECKOUT_INDEXES')))) {
  console.error('Apply is restricted to an explicitly confirmed nonproduction loopback database. No indexes changed.');
  process.exit(1);
}
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  if (client.db().databaseName !== 'bulkimart' && !client.db().databaseName.startsWith('bulkimart_checkout_test')) throw new Error('Unverified database name.');
  console.log(JSON.stringify({ mode: apply ? 'local-maintenance' : 'read-only-plan', plan: await reconcileCheckoutIndexes(client.db(), { apply }) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: 'Checkout index maintenance failed; inspect protected logs', name: error.name, code: error.code }));
  process.exitCode = 1;
} finally { await client.close(); }
