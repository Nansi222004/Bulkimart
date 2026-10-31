// Cloudinary → server media migration. Dry-run by default; writes need --apply.
// Never deletes or modifies Cloudinary assets. No credentials are printed.
//
//   node scripts/media/migrate.mjs health    --database=<db>
//   node scripts/media/migrate.mjs inventory --database=<db> --out=/var/lib/bulkimart/reports/inventory.json
//   node scripts/media/migrate.mjs copy      --database=<db> --category=seller.kyc [--limit=50] [--apply]
//   node scripts/media/migrate.mjs verify    --database=<db> [--limit=1000] [--after=<mediaId>]
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
  copyLegacyAsset, cutoverReferences, groupByUrl, rollbackCutover, scanLegacyReferences, verifyMigratedAssets,
} from '../../services/mediaMigration.service.js';

const [command] = process.argv.slice(2);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes('--apply');
const print = (value) => console.log(JSON.stringify(value));

const limitArg = (fallback, max) => {
  const limit = Number(arg('limit') || fallback);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new Error(`--limit must be 1–${max}`);
  return limit;
};

const collectReferences = async (collection) => {
  const references = [];
  for await (const ref of scanLegacyReferences(collection ? { collections: [collection] } : {})) references.push(ref);
  return references;
};

const commands = {
  async health() {
    print({ storage: await storage.health(), defaultProvider: getStorageConfig().defaultProvider, overrides: getStorageConfig().providers });
  },

  async inventory() {
    const out = arg('out');
    if (!out || !path.isAbsolute(out)) throw new Error('Supply --out=<absolute path outside the repository> for the full manifest');
    const relative = path.relative(MEDIA_PROJECT_ROOT, path.resolve(out));
    if (!relative.startsWith('..')) throw new Error('--out must be outside the repository');
    const references = await collectReferences();
    const assets = groupByUrl(references);
    const migrated = new Map((await Media.find({ 'legacy.url': { $in: assets.map((a) => a.url) } }).select('legacy.url migrationStatus').lean())
      .map((m) => [m.legacy.url, m.migrationStatus]));
    const byCategory = {};
    for (const asset of assets) {
      const key = asset.category || 'unclassified';
      byCategory[key] ||= { assets: 0, references: 0, verified: 0, quarantined: 0, pending: 0 };
      byCategory[key].assets += 1;
      byCategory[key].references += asset.references.length;
      const status = migrated.get(asset.url);
      byCategory[key][status === 'verified' ? 'verified' : status === 'quarantined' ? 'quarantined' : 'pending'] += 1;
    }
    await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
    await writeFile(out, JSON.stringify({ generatedAt: new Date(), database: mongoose.connection.name, assets: assets.map((a) => ({ ...a, migrationStatus: migrated.get(a.url) || 'pending' })) }, null, 2), { mode: 0o600 });
    print({ uniqueAssets: assets.length, references: references.length, byCategory, manifest: out });
  },

  async copy() {
    const category = arg('category');
    if (!MEDIA_CATEGORIES[category]) throw new Error(`--category must be one of: ${Object.keys(MEDIA_CATEGORIES).join(', ')}`);
    const limit = limitArg(50, 500);
    const assets = groupByUrl(await collectReferences()).filter((a) => a.category === category);
    const pending = (await Promise.all(assets.map(async (a) => ((await Media.exists({ 'legacy.url': a.url })) ? null : a)))).filter(Boolean);
    const batch = pending.slice(0, limit);
    const totals = { category, mode: apply ? 'apply' : 'dry-run', pendingBefore: pending.length, batch: batch.length, 'would-copy': 0, verified: 0, quarantined: 0, failed: 0, skipped: 0 };
    for (const asset of batch) {
      try {
        const result = await copyLegacyAsset(asset, { apply });
        if (result.status in totals) totals[result.status] += 1;
        if (result.status === 'quarantined') print({ quarantined: asset.url, mediaId: result.mediaId });
      } catch (error) {
        totals.failed += 1;
        print({ failed: asset.url, reason: error.message });
      }
    }
    totals.pendingAfter = apply ? totals.pendingBefore - totals.verified - totals.quarantined - totals.skipped : totals.pendingBefore;
    print(totals);
  },

  async verify() {
    const after = arg('after');
    if (after && !mongoose.isValidObjectId(after)) throw new Error('Invalid --after');
    print(await verifyMigratedAssets({ limit: limitArg(1000, 5000), after }));
  },

  async cutover() {
    print({ mode: apply ? 'apply' : 'dry-run', ...(await cutoverReferences(await collectReferences(arg('collection')), { apply })) });
  },

  async rollback() {
    print({ mode: apply ? 'apply' : 'dry-run', ...(await rollbackCutover({ apply, collection: arg('collection') || null })) });
  },

  // Report-only: stored files that no record references (e.g. replaced logos). Nothing is deleted.
  async orphans() {
    const { publicBaseUrl } = getStorageConfig();
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
    print({ publicBaseUrl, orphanCount: orphans.length, orphanBytes: orphans.reduce((n, o) => n + o.sizeBytes, 0), orphans: orphans.slice(0, 200) });
  },
};

try {
  if (!commands[command]) throw new Error(`Unknown command. Use one of: ${Object.keys(commands).join(', ')}`);
  const target = arg('database');
  if (!target) throw new Error('Supply --database=<expected database name>');
  assertServerStorageConfig(getStorageConfig());
  try { await mongoose.connect(process.env.MONGO_URI, { autoIndex: false }); }
  catch { throw new Error('could not connect to MongoDB (check MONGO_URI); details withheld'); }
  if (mongoose.connection.name !== target) throw new Error('Database target mismatch; nothing was changed');
  if (apply) await Media.syncIndexes();
  await commands[command]();
} catch (error) {
  // Messages here are ours or Node/Mongo errors; connection strings are never included.
  console.error(`[media-migrate] stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
