import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import Media from '../models/Media.js';
import { getCloudinaryConfig } from '../config/cloudinary.js';
import { categoryForFolder, getCategoryPolicy, MEDIA_CATEGORIES } from './mediaPolicy.service.js';
import { sniffType } from './mediaValidation.service.js';
import { buildStorageKey, filesystemProvider as storage, tempDirectory } from './mediaStorage.service.js';
import { privateRef, publicUrlForKey } from './mediaUrl.service.js';

// Cloudinary → server copy. Read-only towards Cloudinary: originals are never
// modified or deleted here. Idempotent: one Media record per legacy URL
// (unique index on legacy.url); re-running skips verified copies.

const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/[^\s"'\\]+$/;
const MAX_LEGACY_BYTES = 50 * 1024 * 1024;
const VISIBILITY_RANK = { public: 0, private: 1, 'private-kyc': 2 };

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
  if (typeof value === 'string') { if (CLOUDINARY_URL.test(value)) yield [prefix, value]; return; }
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof mongoose.Types.ObjectId || Buffer.isBuffer(value)) return;
  for (const [key, child] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    yield* walk(child, prefix ? `${prefix}.${key}` : String(key));
  }
};

/** Every Cloudinary URL stored anywhere in the database, with where it lives. */
export async function* scanLegacyReferences({ collections } = {}) {
  const names = collections || (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name).filter((name) => !['media', 'mediaaccessaudits', 'mediamigrationlogs'].includes(name) && !name.startsWith('system.'));
  for (const name of names.sort()) {
    const cursor = mongoose.connection.db.collection(name).find({}, { batchSize: 200 });
    for await (const doc of cursor) {
      for (const [fieldPath, url] of walk(doc)) {
        const ownerField = OWNER_FIELD[name];
        yield { collection: name, docId: String(doc._id), fieldPath, url, category: classifyReference(name, fieldPath, url), ownerId: ownerField ? doc[ownerField] || null : null };
      }
    }
  }
}

/** Group references by unique URL; the most restrictive visibility wins when one URL is used in several places. */
export const groupByUrl = (references) => {
  const assets = new Map();
  for (const ref of references) {
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

const assertOwnCloudinaryUrl = (url) => {
  const parsed = new URL(url);
  const { cloud_name: cloudName } = getCloudinaryConfig();
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !cloudName || !parsed.pathname.startsWith(`/${cloudName}/`)) {
    throw new Error('not an asset of the configured Cloudinary account');
  }
};

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf', mp4: 'mp4' };

/** `/<cloud>/<image|video|raw>/upload/[v123/]<public_id>.<ext>` → { resourceType, publicId }. */
export const cloudinaryIdentity = (url) => {
  const match = /^\/[^/]+\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(new URL(url).pathname);
  return match ? { resourceType: match[1], publicId: decodeURIComponent(match[2]) } : {};
};

/**
 * Copy one legacy asset to server storage and register it. Bit-for-bit copy
 * (no re-encoding) so the SHA-256 and size describe exactly what Cloudinary
 * served. Files whose content does not match an allowed type for their
 * category are kept in quarantine/ and never served.
 * Returns { status: 'skipped' | 'verified' | 'quarantined', mediaId }.
 */
export const copyLegacyAsset = async ({ url, category, ownerId = null }, { apply = false } = {}) => {
  const existing = await Media.findOne({ 'legacy.url': url }).select('migrationStatus').lean();
  if (existing) return { status: 'skipped', mediaId: String(existing._id), migrationStatus: existing.migrationStatus };
  const policy = getCategoryPolicy(category);
  assertOwnCloudinaryUrl(url);
  if (!apply) return { status: 'would-copy' };

  const temporary = path.join(tempDirectory(), `${randomUUID()}.legacy`);
  await mkdir(path.dirname(temporary), { recursive: true, mode: 0o700 });
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
    if (declared && declared !== size) throw new Error('size does not match the source Content-Length');
    const etag = String(response.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '');
    if (/^[a-f0-9]{32}$/.test(etag) && etag !== md5.digest('hex')) throw new Error('MD5 does not match the source ETag');
    const sha256 = sha.digest('hex');

    const type = sniffType(head);
    const allowed = Boolean(type && EXT[type] && (policy.accept.includes(type) || (type === 'png' && policy.accept.includes('svg'))));
    const area = !allowed ? 'quarantine' : policy.visibility === 'public' ? 'public' : 'private';
    const key = buildStorageKey({ area, dir: policy.dir, ext: allowed ? EXT[type] : 'bin' });
    await storage.put({ key, source: { filePath: temporary }, visibility: policy.visibility, expected: { sha256, sizeBytes: size } });

    try {
      const media = await Media.create({
        storageKey: key, category, visibility: policy.visibility,
        mimeType: allowed ? (type === 'pdf' ? 'application/pdf' : type === 'mp4' ? 'video/mp4' : `image/${type}`) : 'application/octet-stream',
        extension: allowed ? EXT[type] : 'bin', sizeBytes: size, sha256,
        ownerId, ownerRole: ownerId ? (category.startsWith('seller') ? 'seller' : category.startsWith('delivery') ? 'delivery' : 'customer') : null,
        legacy: { url, ...cloudinaryIdentity(url), sizeBytes: size },
        migrationStatus: allowed ? 'verified' : 'quarantined',
      });
      return { status: allowed ? 'verified' : 'quarantined', mediaId: String(media._id) };
    } catch (error) {
      await storage.remove(key).catch(() => {});
      if (error.code === 11000) return { status: 'skipped' }; // a parallel run registered it first
      throw error;
    }
  } finally {
    await response?.body?.cancel?.().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
};

/** Re-hash every verified copy against its recorded SHA-256 and size. */
export const verifyMigratedAssets = async ({ limit = 1000, after = null } = {}) => {
  const filter = { migrationStatus: 'verified', uploadStatus: 'stored', ...(after ? { _id: { $gt: after } } : {}) };
  const rows = await Media.find(filter).select('+storageKey sha256 sizeBytes legacy.url').sort({ _id: 1 }).limit(limit).lean();
  const failures = [];
  for (const row of rows) {
    const ok = await storage.verifyKey(row.storageKey, row).catch(() => false);
    if (!ok) failures.push({ mediaId: String(row._id), legacyUrl: row.legacy?.url });
  }
  return { checked: rows.length, failures, nextAfter: rows.length === limit ? String(rows.at(-1)._id) : null };
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

/** Undo cutover writes whose field still holds the value the cutover wrote. */
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
