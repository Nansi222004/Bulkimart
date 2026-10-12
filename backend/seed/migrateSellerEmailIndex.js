import 'dotenv/config';
import { MongoClient } from 'mongodb';

// This migration targets only the Bulkimart application cluster/database.
// It is a dry-run unless --apply is supplied, and it never prints MONGO_URI.
const EXPECTED_HOST = 'cluster0.q39nutg.mongodb.net';
const EXPECTED_DATABASE = 'bulkimart';
const LEGACY_INDEX = 'email_1';
const OPTIONAL_EMAIL_INDEX = 'email_1_optional_unique';
const PARTIAL_FILTER = { email: { $type: 'string', $gt: '' } };

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required; no database connection was attempted.');

const parsedUri = new URL(uri);
const databaseName = decodeURIComponent(parsedUri.pathname.replace(/^\//, '').split('/')[0] || '');
if (parsedUri.hostname.toLowerCase() !== EXPECTED_HOST || databaseName !== EXPECTED_DATABASE) {
  throw new Error('Refusing to connect: configured MongoDB host/database is not the verified Bulkimart target.');
}

const apply = process.argv.includes('--apply');
const client = new MongoClient(uri);

try {
  await client.connect();
  const collection = client.db(EXPECTED_DATABASE).collection('sellers');
  const indexes = await collection.listIndexes().toArray();
  const legacyIndex = indexes.find((index) => index.name === LEGACY_INDEX);
  const currentIndex = indexes.find((index) => index.name === OPTIONAL_EMAIL_INDEX);

  const emailRows = await collection.find({ email: { $type: 'string' } }, { projection: { email: 1 } }).toArray();
  const normalizedCounts = new Map();
  let nonBlankEmails = 0;
  let blankEmails = 0;
  for (const row of emailRows) {
    const normalized = row.email.trim().toLowerCase();
    if (!normalized) {
      blankEmails += 1;
      continue;
    }
    nonBlankEmails += 1;
    normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) + 1);
  }
  const duplicateGroups = [...normalizedCounts.values()].filter((count) => count > 1).length;
  const missingCount = await collection.countDocuments({ email: { $exists: false } });
  const nullCount = await collection.countDocuments({ email: { $type: 'null' } });

  console.log(`Target verified: ${EXPECTED_HOST}/${EXPECTED_DATABASE}`);
  console.log(`Index state: legacy=${legacyIndex ? 'present' : 'absent'}, optional=${currentIndex ? 'present' : 'absent'}`);
  console.log(`Email audit: missing=${missingCount}, null=${nullCount}, blank=${blankEmails}, nonblank=${nonBlankEmails}, normalized duplicate groups=${duplicateGroups}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  if (duplicateGroups > 0) {
    throw new Error('Migration stopped: duplicate emails after trim/lowercase normalization require manual review.');
  }

  if (!apply) {
    console.log('No changes made. Review this report, then rerun with --apply to migrate indexes and normalize existing email strings.');
  } else {
    // Create the partial index first. This keeps protection for valid addresses
    // in place before the null-index is removed; a conflict leaves the old
    // index intact and causes the migration to stop.
    await collection.createIndex({ email: 1 }, {
      unique: true,
      name: OPTIONAL_EMAIL_INDEX,
      partialFilterExpression: PARTIAL_FILTER,
    });

    const operations = emailRows.flatMap((row) => {
      const normalized = row.email.trim().toLowerCase();
      return normalized && normalized !== row.email
        ? [{ updateOne: { filter: { _id: row._id }, update: { $set: { email: normalized } } } }]
        : [];
    });
    if (operations.length) await collection.bulkWrite(operations, { ordered: true });

    if (legacyIndex) await collection.dropIndex(LEGACY_INDEX);
    console.log('Migration complete. The optional partial unique email index is active; no documents were deleted.');
  }
} catch (error) {
  // Mongo driver errors may contain server/connection details; keep credentials
  // and full connection strings out of ordinary migration logs.
  console.error(error.message || 'Seller email index migration failed.');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
