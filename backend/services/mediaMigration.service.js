import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import Media from '../models/Media.js';
import MediaAccessAudit from '../models/MediaAccessAudit.js';
import { getCloudinaryConfig } from '../config/cloudinary.js';
import { categoryForFolder, getCategoryPolicy, MEDIA_CATEGORIES } from './mediaPolicy.service.js';
import { sniffType } from './mediaValidation.service.js';
import { buildStorageKey, filesystemProvider as storage, tempDirectory } from './mediaStorage.service.js';
import { privateRef, publicUrlForKey } from './mediaUrl.service.js';

// Cloudinary → server copy. Read-only towards Cloudinary: originals are never
// modified or deleted. One Media record per legacy URL (unique index on
// legacy.url) is reserved before the download starts, so an interrupted or
// failed copy is retried on the same record and never duplicates records or files.
//
// Status lifecycle of a migration record (Media.migrationStatus):
//   (none) → copying → verified | quarantined        success
//                    → failed                         retried later (attempt-limited)
//   copying left behind by a crash is treated like failed on the next run.

const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/[^\s"'\\]+$/;
const LOCAL_UPLOAD_URL = /^(https?:\/\/[^/\s"']+)?\/uploads\/[^\s"'\\]+$/;
const MAX_LEGACY_BYTES = 50 * 1024 * 1024;
const VISIBILITY_RANK = { public: 0, private: 1, 'private-kyc': 2 };
export const DONE_STATUSES = ['verified', 'quarantined'];
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Short, non-reversible identifier for logs and reports (never print private URLs). */
export const assetId = (url) => createHash('sha256').update(url).digest('hex');
export const shortAssetId = (url) => assetId(url).slice(0, 12);

/** Error text that is safe to print or store: no URLs, bounded length. */
export const safeErrorMessage = (error) => String(error?.message || 'copy failed')
  .replace(/https?:\/\/\S+/g, '[url]').replace(/[\r\n]+/g, ' ').slice(0, 200);

// Workflow-based classification: collection + field path (array indexes removed).
const PATH_RULES = [
  ['users', /^avatar$/, 'customer.avatar'],
  ['users', /^addresses\.landmarkImage$/, 'customer.landmark'],
  ['admins', /^avatar$/, 'customer.avatar'],
  ['sellers', /^aadhaar\./, 'seller.kyc'],
  ['sellers', /^documents\./, 'seller.kyc'],
  ['sellers', /^bankDetails\./, 'seller.bank'],
  ['sellers', /^storeDetails\.(logo|banner)$/, 'seller.branding'],
  ['deliverypartners', /^(drivingLicense|aadhaar)\./, 'delivery.kyc'],
  ['deliverypartners', /^bankDetails\./, 'delivery.bank'],
  ['products', /^reviews\.images$/, 'customer.review'],
  ['products', /^images$/, 'seller.product'],
  ['returns', /^attachments\./, 'customer.return'],
  ['returns', /^productImage$/, 'seller.product'],
  ['tickets', /^attachments\./, 'shared.ticket'],
  ['ticketmessages', /^attachments\./, 'shared.ticket'],
  ['orders', /landmarkImage$/, 'customer.landmark'],
  ['orders', /^items\.image$/, 'seller.product'],
  ['carts', /image$/, 'seller.product'],
  ['banners', /(^|\.)(video|mobileVideo)$/, 'admin.storefront'],
  ['banners', /./, 'admin.banner'],
  ['storefrontexperiences', /./, 'admin.storefront'],
  ['categories', /./, 'admin.category'],
  ['campaigns', /./, 'admin.campaign'],
  ['sellerpromotions', /./, 'admin.campaign'],
  ['notificationbroadcasts', /./, 'admin.broadcast'],
  ['notifications', /./, 'admin.broadcast'],
  ['packagingmaterials', /./, 'admin.packaging'],
  ['packagingpackages', /./, 'admin.packaging'],
  ['rationpackages', /./, 'admin.packaging'],
];

// Owner (User id) for records whose documents the owner may view.
const OWNER_FIELD = { users: '_id', sellers: 'userId', deliverypartners: 'userId' };
const INTERNAL_COLLECTIONS = new Set(['media', 'mediaaccessaudits', 'mediamigrationlogs']);

export const folderFromCloudinaryUrl = (url) => {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const start = parts.indexOf('nhcone');
  if (start < 0) return null;
  return parts.slice(start + 1, -1).join('/');
};

export const classifyReference = (collection, fieldPath, url) => {
  const normalised = fieldPath.replace(/\.\d+(?=\.|$)/g, '');
  const rule = PATH_RULES.find(([name, pattern]) => name === collection && pattern.test(normalised));
  if (rule) return rule[2];
  return categoryForFolder(folderFromCloudinaryUrl(url));
};

const walk = function* (value, prefix = '') {
  if (typeof value === 'string') {
    if (CLOUDINARY_URL.test(value)) yield [prefix, value, 'cloudinary'];
    else if (LOCAL_UPLOAD_URL.test(value)) yield [prefix, value, 'local-upload'];
    return;
  }
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof mongoose.Types.ObjectId || Buffer.isBuffer(value)) return;
  for (const [key, child] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    yield* walk(child, prefix ? `${prefix}.${key}` : String(key));
  }
};

/**
 * Every Cloudinary URL (kind 'cloudinary') and every legacy local-fallback
 * `/uploads/…` URL (kind 'local-upload') stored anywhere in the database.
 */
export async function* scanLegacyReferences({ collections } = {}) {
  const names = collections || (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name).filter((name) => !INTERNAL_COLLECTIONS.has(name) && !name.startsWith('system.'));
  for (const name of names.sort()) {
    const cursor = mongoose.connection.db.collection(name).find({}, { batchSize: 200 });
    for await (const doc of cursor) {
      for (const [fieldPath, url, kind] of walk(doc)) {
        const ownerField = OWNER_FIELD[name];
        yield {
          kind, collection: name, docId: String(doc._id), fieldPath, url,
          category: kind === 'cloudinary' ? classifyReference(name, fieldPath, url) : null,
          ownerId: ownerField ? doc[ownerField] || null : null,
        };
      }
    }
  }
}

/**
 * Group Cloudinary references by unique URL. A URL referenced from several
 * records (e.g. a product image copied into orders) is ONE asset with several
 * references; the most restrictive visibility wins when they disagree.
 */
export const groupByUrl = (references) => {
  const assets = new Map();
  for (const ref of references) {
    if (ref.kind && ref.kind !== 'cloudinary') continue;
    const asset = assets.get(ref.url) || { url: ref.url, categories: new Set(), ownerId: null, references: [] };
    if (ref.category) asset.categories.add(ref.category);
    if (ref.ownerId && !asset.ownerId) asset.ownerId = ref.ownerId;
    asset.references.push({ collection: ref.collection, docId: ref.docId, fieldPath: ref.fieldPath });
    assets.set(ref.url, asset);
  }
  for (const asset of assets.values()) {
    asset.category = [...asset.categories].sort((a, b) => VISIBILITY_RANK[MEDIA_CATEGORIES[b].visibility] - VISIBILITY_RANK[MEDIA_CATEGORIES[a].visibility])[0] || null;
    delete asset.categories;
  }
  return [...assets.values()];
};

export const isOwnCloudinaryUrl = (url) => {
  try {
    const parsed = new URL(url);
    const { cloud_name: cloudName } = getCloudinaryConfig();
    return parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com' && Boolean(cloudName) && parsed.pathname.startsWith(`/${cloudName}/`);
  } catch { return false; }
};

/** `/<cloud>/<image|video|raw>/upload/[v123/]<public_id>.<ext>` → { resourceType, publicId }. */
export const cloudinaryIdentity = (url) => {
  const match = /^\/[^/]+\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(new URL(url).pathname);
  return match ? { resourceType: match[1], publicId: decodeURIComponent(match[2]) } : {};
};

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf', mp4: 'mp4' };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4' };
const ownerRoleFor = (category) => (category.startsWith('seller') ? 'seller' : category.startsWith('delivery') ? 'delivery' : 'customer');

/** Reserve (or reuse) the single migration record for a legacy URL. */
const reserveRecord = async ({ url, category, ownerId }) => {
  const policy = getCategoryPolicy(category);
  try {
    return await Media.create({
      category, visibility: policy.visibility,
      ownerId: ownerId || null, ownerRole: ownerId ? ownerRoleFor(category) : null,
      uploadStatus: 'pending', migrationStatus: 'copying',
      legacy: { url, ...cloudinaryIdentity(url) },
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Media.findOne({ 'legacy.url': url }).select('+storageKey');
  }
};

/**
 * Copy one legacy asset to server storage. Bit-for-bit copy (no re-encoding)
 * so SHA-256 and size describe exactly what Cloudinary served; the stored file
 * is re-hashed before the record is marked verified. Content not allowed for
 * its category is kept under quarantine/ and never served.
 * Returns { status: 'skipped' | 'would-copy' | 'would-retry' | 'verified' | 'quarantined', mediaId }.
 * Throws (with a URL-free message) when the copy fails; the record is then `failed`.
 */
export const copyLegacyAsset = async ({ url, category, ownerId = null }, { apply = false } = {}) => {
  const existing = await Media.findOne({ 'legacy.url': url }).select('+storageKey migrationStatus').lean();
  if (existing && DONE_STATUSES.includes(existing.migrationStatus)) {
    return { status: 'skipped', mediaId: String(existing._id), migrationStatus: existing.migrationStatus };
  }
  const policy = getCategoryPolicy(category);
  if (!isOwnCloudinaryUrl(url)) throw new Error('not an asset of the configured Cloudinary account');
  if (!apply) return { status: existing ? 'would-retry' : 'would-copy' };

  const record = existing || await reserveRecord({ url, category, ownerId });
  if (DONE_STATUSES.includes(record.migrationStatus)) return { status: 'skipped', mediaId: String(record._id) };
  // An earlier interrupted or failed attempt may have left a file at its key; never keep two copies.
  if (record.storageKey) await storage.remove(record.storageKey).catch(() => {});
  await Media.updateOne({ _id: record._id }, {
    $set: { migrationStatus: 'copying', uploadStatus: 'pending', 'migration.lastAttemptAt': new Date() },
    $inc: { 'migration.attempts': 1 },
    $unset: { storageKey: 1 },
  });

  await mkdir(tempDirectory(), { recursive: true, mode: 0o700 });
  const temporary = path.join(tempDirectory(), `${randomUUID()}.legacy`);
  let key = null;
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`source responded ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_LEGACY_BYTES) throw new Error('source exceeds migration size limit');

    const sha = createHash('sha256');
    const md5 = createHash('md5');
    let size = 0;
    let head = Buffer.alloc(0);
    const tap = async function* (source) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > MAX_LEGACY_BYTES) throw new Error('source exceeds migration size limit');
        if (head.length < 1024) head = Buffer.concat([head, chunk]).subarray(0, 1024);
        sha.update(chunk); md5.update(chunk);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(response.body), tap, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (!size) throw new Error('source is empty');
    if (declared && declared !== size) throw new Error('size does not match the source Content-Length');
    const etag = String(response.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '');
    if (/^[a-f0-9]{32}$/.test(etag) && etag !== md5.digest('hex')) throw new Error('MD5 does not match the source ETag');
    const sha256 = sha.digest('hex');

    const type = sniffType(head);
    const allowed = Boolean(type && EXT[type] && (policy.accept.includes(type) || (type === 'png' && policy.accept.includes('svg'))));
    const area = !allowed ? 'quarantine' : policy.visibility === 'public' ? 'public' : 'private';
    key = buildStorageKey({ area, dir: policy.dir, ext: allowed ? EXT[type] : 'bin' });
    // Record the key before writing so a crash between write and finalise is cleaned up on retry.
    await Media.updateOne({ _id: record._id }, { $set: { storageKey: key } });
    // put() re-reads the written file and checks SHA-256 and size before returning.
    await storage.put({ key, source: { filePath: temporary }, visibility: policy.visibility, expected: { sha256, sizeBytes: size } });

    const migrationStatus = allowed ? 'verified' : 'quarantined';
    await Media.updateOne({ _id: record._id }, {
      $set: {
        mimeType: allowed ? MIME[type] : 'application/octet-stream', extension: allowed ? EXT[type] : 'bin',
        sizeBytes: size, sha256, 'legacy.sizeBytes': size, uploadStatus: 'stored', migrationStatus, 'migration.lastError': null,
      },
    });
    return { status: migrationStatus, mediaId: String(record._id) };
  } catch (error) {
    if (key) await storage.remove(key).catch(() => {});
    const message = safeErrorMessage(error);
    await Media.updateOne({ _id: record._id }, { $set: { migrationStatus: 'failed', uploadStatus: 'pending', 'migration.lastError': message }, $unset: { storageKey: 1 } });
    throw new Error(message);
  } finally {
    await response?.body?.cancel?.().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
};

const migrationStates = async (urls) => new Map((await Media.find({ 'legacy.url': { $in: urls } })
  .select('legacy.url migrationStatus migration.attempts migration.lastError').lean()).map((m) => [m.legacy.url, m]));

/** Per-asset migration state; `pending` covers never attempted, copying (interrupted) and failed. */
export const summariseStates = (assets, states, maxAttempts = DEFAULT_MAX_ATTEMPTS) => {
  const summary = { assets: assets.length, verified: 0, quarantined: 0, pending: 0, failed: 0, blocked: 0 };
  for (const asset of assets) {
    const state = states.get(asset.url);
    if (state?.migrationStatus === 'verified') summary.verified += 1;
    else if (state?.migrationStatus === 'quarantined') summary.quarantined += 1;
    else {
      summary.pending += 1;
      if (state?.migrationStatus === 'failed') {
        summary.failed += 1;
        if ((state.migration?.attempts || 0) >= maxAttempts) summary.blocked += 1;
      }
    }
  }
  return summary;
};

/**
 * Copy one batch of a category. Assets are processed in a stable order
 * (SHA-256 of the URL), so `after` (the previous batch's `nextAfter`) moves
 * through the whole category without re-processing the same first items.
 * Failed assets stay pending; after `maxAttempts` failures they are skipped
 * unless `retryFailed` is set, so one broken asset cannot stall the run.
 */
export const runCopyBatch = async ({ assets, category, limit = 50, after = null, apply = false, maxAttempts = DEFAULT_MAX_ATTEMPTS, retryFailed = false }) => {
  const candidates = assets.filter((a) => a.category === category)
    .map((a) => ({ ...a, cursor: assetId(a.url) }))
    .sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
  const before = await migrationStates(candidates.map((a) => a.url));
  const eligible = (asset) => {
    const state = before.get(asset.url);
    if (state && DONE_STATUSES.includes(state.migrationStatus)) return false;
    if (!retryFailed && state?.migrationStatus === 'failed' && (state.migration?.attempts || 0) >= maxAttempts) return false;
    return true;
  };
  const queue = candidates.filter((a) => (!after || a.cursor > after) && eligible(a));
  const batch = queue.slice(0, limit);

  const result = { category, mode: apply ? 'apply' : 'dry-run', batch: batch.length, 'would-copy': 0, 'would-retry': 0, verified: 0, quarantined: 0, skipped: 0, failed: 0, failures: [] };
  for (const asset of batch) {
    try {
      const outcome = await copyLegacyAsset(asset, { apply });
      result[outcome.status] = (result[outcome.status] || 0) + 1;
    } catch (error) {
      result.failed += 1;
      const first = asset.references[0];
      result.failures.push({ asset: asset.cursor.slice(0, 12), reason: safeErrorMessage(error), references: asset.references.length, firstReference: first ? `${first.collection}/${first.docId}` : null });
    }
  }
  result.nextAfter = queue.length > batch.length ? batch.at(-1).cursor : null;
  result.after = summariseStates(candidates, apply ? await migrationStates(candidates.map((a) => a.url)) : before, maxAttempts);
  result.pendingAfter = result.after.pending;
  return result;
};

/**
 * Integrity check of stored files against their records: existence, size,
 * SHA-256 and content type. Pages through ALL matching records (not just the
 * first page). `root` verifies a restored backup copy instead of MEDIA_ROOT.
 * With apply, a verified migration copy that fails is set to `failed`, so the
 * read map stops serving it (the original Cloudinary URL is used) and the next
 * copy run replaces it.
 */
export const verifyMediaFiles = async ({ scope = 'migrated', root, apply = false, pageSize = 500 } = {}) => {
  const filter = scope === 'all'
    ? { uploadStatus: 'stored', migrationStatus: { $in: ['not_applicable', 'verified'] } }
    : { uploadStatus: 'stored', migrationStatus: 'verified' };
  const result = { scope, checked: 0, failures: [], markedFailed: 0 };
  let lastId = null;
  for (;;) {
    const rows = await Media.find({ ...filter, ...(lastId ? { _id: { $gt: lastId } } : {}) })
      .select('+storageKey category sha256 sizeBytes mimeType migrationStatus').sort({ _id: 1 }).limit(pageSize).lean();
    if (!rows.length) break;
    for (const row of rows) {
      result.checked += 1;
      let reason = null;
      try {
        if (!(await storage.verifyKey(row.storageKey, row, root))) reason = 'checksum or size mismatch';
        else {
          const type = sniffType(await storage.readHead(row.storageKey, root));
          if (!type || MIME[type] !== row.mimeType) reason = 'content type does not match record';
        }
      } catch { reason = 'file missing or unreadable'; }
      if (reason) {
        result.failures.push({ mediaId: String(row._id), category: row.category, reason });
        if (apply && row.migrationStatus === 'verified') {
          await Media.updateOne({ _id: row._id, migrationStatus: 'verified' }, { $set: { migrationStatus: 'failed', uploadStatus: 'pending', 'migration.lastError': `verification: ${reason}` } });
          result.markedFailed += 1;
        }
      }
    }
    lastId = rows.at(-1)._id;
  }
  return result;
};

// ---------------------------------------------------------------- indexes

const MEDIA_MODELS = [Media, MediaAccessAudit];
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare the indexes the media models declare with those in the database.
 * With apply, create ONLY the missing ones. Never drops or rebuilds an index
 * (unlike Model.syncIndexes, which drops undeclared indexes).
 */
export const ensureMediaIndexes = async ({ apply = false } = {}) => {
  const report = [];
  for (const model of MEDIA_MODELS) {
    let existing = [];
    try { existing = await model.collection.indexes(); } catch (error) { if (error.codeName !== 'NamespaceNotFound' && error.code !== 26) throw error; }
    const declared = model.schema.indexes();
    const missing = declared.filter(([key]) => !existing.some((ix) => sameKey(ix.key, key)));
    const entry = { collection: model.collection.collectionName, declared: declared.map(([key, options]) => ({ key, unique: Boolean(options?.unique) })), missing: missing.map(([key]) => key), created: [] };
    if (apply) {
      for (const [key, options] of missing) {
        await model.collection.createIndex(key, { ...options, background: true });
        entry.created.push(key);
      }
    }
    report.push(entry);
  }
  return report;
};

/** True when the unique legacy-URL index exists (required before copying). */
export const hasLegacyUrlIndex = async () => {
  try { return (await Media.collection.indexes()).some((ix) => sameKey(ix.key, { 'legacy.url': 1 }) && ix.unique); } catch { return false; }
};

// ---------------------------------------------------------------- cutover

// Live fields whose stored legacy URL may be replaced by the new reference.
// Orders, returns, notifications, tickets and storefront history are never
// rewritten; the read-time map (MEDIA_LEGACY_READ_MAP) serves them instead.
export const CUTOVER_COLLECTIONS = new Set(['users', 'sellers', 'deliverypartners', 'products', 'banners', 'categories', 'campaigns']);

const MigrationLog = () => mongoose.connection.db.collection('mediamigrationlogs');

const newReferenceFor = (media) => (media.visibility === 'public' ? publicUrlForKey(media.storageKey) : privateRef(media._id));

/** Replace one exact stored value at a concrete path, only if it is still unchanged. */
const replaceAtPath = async (collection, docId, fieldPath, from, to) => {
  const id = new mongoose.Types.ObjectId(docId);
  const result = await mongoose.connection.db.collection(collection).updateOne({ _id: id, [fieldPath]: from }, { $set: { [fieldPath]: to } });
  return result.modifiedCount === 1;
};

export const cutoverReferences = async (references, { apply = false } = {}) => {
  const summary = { eligible: 0, updated: 0, skipped: 0 };
  for (const ref of references) {
    if (ref.kind && ref.kind !== 'cloudinary') continue;
    if (!CUTOVER_COLLECTIONS.has(ref.collection)) continue;
    const media = await Media.findOne({ 'legacy.url': ref.url, migrationStatus: 'verified', uploadStatus: 'stored' }).select('+storageKey visibility').lean();
    if (!media) { summary.skipped += 1; continue; }
    summary.eligible += 1;
    if (!apply) continue;
    const to = newReferenceFor(media);
    if (await replaceAtPath(ref.collection, ref.docId, ref.fieldPath, ref.url, to)) {
      await MigrationLog().insertOne({ collection: ref.collection, docId: ref.docId, fieldPath: ref.fieldPath, oldValue: ref.url, newValue: to, mediaId: media._id, at: new Date(), rolledBack: false });
      summary.updated += 1;
    }
  }
  return summary;
};

/** Undo cutover writes whose field still holds the value the cutover wrote. Log entries are kept. */
export const rollbackCutover = async ({ apply = false, collection = null } = {}) => {
  const filter = { rolledBack: false, ...(collection ? { collection } : {}) };
  const summary = { entries: await MigrationLog().countDocuments(filter), restored: 0, changedSince: 0 };
  if (!apply) return summary;
  for await (const entry of MigrationLog().find(filter)) {
    if (await replaceAtPath(entry.collection, entry.docId, entry.fieldPath, entry.newValue, entry.oldValue)) summary.restored += 1;
    else summary.changedSince += 1;
    await MigrationLog().updateOne({ _id: entry._id }, { $set: { rolledBack: true, rolledBackAt: new Date() } });
  }
  return summary;
};
