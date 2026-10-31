// Cloudinary → server media migration. Dry-run by default; writes need --apply.
// Never deletes or modifies Cloudinary assets. Never prints credentials or
// asset URLs (private documents are identified by a short hash instead).
//
//   node scripts/media/migrate.mjs health    --database=<db>
//   node scripts/media/migrate.mjs indexes   --database=<db> [--apply]          create missing media indexes only
//   node scripts/media/migrate.mjs inventory --database=<db> --out=/var/lib/bulkimart/reports/inventory.json
//   node scripts/media/migrate.mjs copy      --database=<db> --category=seller.kyc [--limit=50] [--after=<cursor>] [--max-attempts=3] [--retry-failed] [--apply]
//   node scripts/media/migrate.mjs verify    --database=<db> [--scope=migrated|all] [--root=<restored media dir>] [--apply]
//   node scripts/media/migrate.mjs cutover   --database=<db> [--collection=products] [--apply]
//   node scripts/media/migrate.mjs rollback  --database=<db> [--collection=products] [--apply]
//   node scripts/media/migrate.mjs orphans   --database=<db>
import '../../config/environment.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import Media from '../../models/Media.js';
import { assertServerStorageConfig, getStorageConfig, MEDIA_PROJECT_ROOT } from '../../config/storage.js';
import { MEDIA_CATEGORIES } from '../../services/mediaPolicy.service.js';
import { filesystemProvider as storage } from '../../services/mediaStorage.service.js';
import {
  cutoverReferences, DEFAULT_MAX_ATTEMPTS, ensureMediaIndexes, groupByUrl, hasLegacyUrlIndex, isOwnCloudinaryUrl,
  rollbackCutover, runCopyBatch, scanLegacyReferences, shortAssetId, summariseStates, verifyMediaFiles,
} from '../../services/mediaMigration.service.js';

const [command] = process.argv.slice(2);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);
const apply = flag('apply');
const print = (value) => console.log(JSON.stringify(value));

const intArg = (name, fallback, max) => {
  const value = Number(arg(name) || fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`--${name} must be 1–${max}`);
  return value;
};

const outsideRepository = (target) => {
  if (!target || !path.isAbsolute(target)) return false;
  return path.relative(MEDIA_PROJECT_ROOT, path.resolve(target)).startsWith('..');
};

const collectReferences = async (collection) => {
  const references = [];
  for await (const ref of scanLegacyReferences(collection ? { collections: [collection] } : {})) references.push(ref);
  return references;
};

const commands = {
  async health() {
    const config = getStorageConfig();
    print({ storage: await storage.health(), defaultProvider: config.defaultProvider, overrides: config.providers, legacyIndexPresent: await hasLegacyUrlIndex() });
  },

  async indexes() {
    print({ mode: apply ? 'apply' : 'dry-run', note: 'creates missing indexes only; never drops or rebuilds', collections: await ensureMediaIndexes({ apply }) });
  },

  async inventory() {
    const out = arg('out');
    if (!outsideRepository(out)) throw new Error('Supply --out=<absolute path outside the repository> for the full manifest');
    const references = await collectReferences();
    const cloudinaryRefs = references.filter((r) => r.kind === 'cloudinary');
    const localRefs = references.filter((r) => r.kind === 'local-upload');
    const assets = groupByUrl(cloudinaryRefs);
    const states = new Map((await Media.find({ 'legacy.url': { $in: assets.map((a) => a.url) } }).select('legacy.url migrationStatus migration.attempts').lean())
      .map((m) => [m.legacy.url, m]));

    const byCategory = {};
    for (const category of [...Object.keys(MEDIA_CATEGORIES), 'unclassified']) {
      const inCategory = assets.filter((a) => (a.category || 'unclassified') === category);
      if (!inCategory.length) continue;
      byCategory[category] = { ...summariseStates(inCategory, states), references: inCategory.reduce((n, a) => n + a.references.length, 0) };
    }
    const duplicates = assets.filter((a) => a.references.length > 1);
    const unclassified = assets.filter((a) => !a.category);
    const foreign = assets.filter((a) => !isOwnCloudinaryUrl(a.url));

    await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
    await writeFile(out, JSON.stringify({
      generatedAt: new Date(), database: mongoose.connection.name,
      note: 'Contains asset URLs, including private documents. Keep this file private (0600) and outside the repository.',
      assets: assets.map((a) => ({ ...a, asset: shortAssetId(a.url), migrationStatus: states.get(a.url)?.migrationStatus || 'pending' })),
      localUploadReferences: localRefs.map(({ collection, docId, fieldPath }) => ({ collection, docId, fieldPath })),
    }, null, 2), { mode: 0o600 });

    print({
      uniqueAssets: assets.length,
      references: cloudinaryRefs.length,
      duplicateUrls: { assets: duplicates.length, extraReferences: duplicates.reduce((n, a) => n + a.references.length - 1, 0) },
      unclassified: { assets: unclassified.length, sample: unclassified.slice(0, 20).map((a) => ({ asset: shortAssetId(a.url), firstReference: `${a.references[0].collection}.${a.references[0].fieldPath.replace(/\.\d+/g, '[]')}` })) },
      otherCloudinaryAccounts: foreign.length,
      localFallbackUploadReferences: localRefs.length,
      byCategory,
      manifest: out,
    });
  },

  async copy() {
    const category = arg('category');
    if (!MEDIA_CATEGORIES[category]) throw new Error(`--category must be one of: ${Object.keys(MEDIA_CATEGORIES).join(', ')}`);
    if (apply && !(await hasLegacyUrlIndex())) throw new Error('Missing unique legacy.url index. Run "migrate.mjs indexes --apply" first.');
    const after = arg('after');
    if (after && !/^[a-f0-9]{64}$/.test(after)) throw new Error('--after must be the nextAfter value of the previous batch');
    const assets = groupByUrl(await collectReferences());
    print(await runCopyBatch({
      assets, category, after: after || null, apply,
      limit: intArg('limit', 50, 1000),
      maxAttempts: intArg('max-attempts', DEFAULT_MAX_ATTEMPTS, 20),
      retryFailed: flag('retry-failed'),
    }));
  },

  async verify() {
    const root = arg('root');
    if (root && !path.isAbsolute(root)) throw new Error('--root must be an absolute path to a restored media directory');
    if (root && apply) throw new Error('--apply cannot be combined with --root (a restored copy is checked read-only)');
    const scope = arg('scope') || 'migrated';
    if (!['migrated', 'all'].includes(scope)) throw new Error('--scope must be migrated or all');
    const result = await verifyMediaFiles({ scope, root: root || undefined, apply });
    print({ ...result, failures: result.failures.slice(0, 200), failureCount: result.failures.length, root: root || 'MEDIA_ROOT' });
    if (result.failures.length) process.exitCode = 2;
  },

  async cutover() {
    print({ mode: apply ? 'apply' : 'dry-run', ...(await cutoverReferences(await collectReferences(arg('collection')), { apply })) });
  },

  async rollback() {
    print({ mode: apply ? 'apply' : 'dry-run', ...(await rollbackCutover({ apply, collection: arg('collection') || null })) });
  },

  // Report-only: stored upload files that no record references (e.g. replaced logos). Nothing is deleted.
  async orphans() {
    const referenced = new Set();
    const collections = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name).filter((n) => !['media', 'mediaaccessaudits', 'mediamigrationlogs'].includes(n) && !n.startsWith('system.'));
    for (const name of collections) {
      for await (const doc of mongoose.connection.db.collection(name).find({})) {
        const text = JSON.stringify(doc);
        for (const m of text.matchAll(/"media:([a-f0-9]{24})"/g)) referenced.add(`id:${m[1]}`);
        for (const m of text.matchAll(/\/media\/([a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]+)/g)) referenced.add(`key:public/${m[1]}`);
      }
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orphans = [];
    for await (const media of Media.find({ uploadStatus: 'stored', migrationStatus: 'not_applicable', createdAt: { $lt: weekAgo } }).select('+storageKey category sizeBytes createdAt').lean()) {
      if (!referenced.has(`id:${media._id}`) && !referenced.has(`key:${media.storageKey}`)) {
        orphans.push({ mediaId: String(media._id), category: media.category, sizeBytes: media.sizeBytes, createdAt: media.createdAt });
      }
    }
    print({ orphanCount: orphans.length, orphanBytes: orphans.reduce((n, o) => n + o.sizeBytes, 0), orphans: orphans.slice(0, 200) });
  },
};

try {
  if (!commands[command]) throw new Error(`Unknown command. Use one of: ${Object.keys(commands).join(', ')}`);
  const target = arg('database');
  if (!target) throw new Error('Supply --database=<expected database name>');
  if (command !== 'indexes') assertServerStorageConfig(getStorageConfig());
  try { await mongoose.connect(process.env.MONGO_URI, { autoIndex: false }); }
  catch { throw new Error('could not connect to MongoDB (check MONGO_URI); details withheld'); }
  if (mongoose.connection.name !== target) throw new Error('Database target mismatch; nothing was changed');
  await commands[command]();
} catch (error) {
  // Our own messages and URL-scrubbed errors only; connection strings are never included.
  console.error(`[media-migrate] stopped: ${String(error.message).replace(/\S+:\/\/\S+/g, '[redacted]')}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
