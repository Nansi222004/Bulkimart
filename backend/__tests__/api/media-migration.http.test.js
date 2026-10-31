import { jest } from '@jest/globals';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Real in-memory MongoDB, real filesystem storage. Only the Cloudinary download (fetch) is faked.
const { default: Media } = await import('../../models/Media.js');
const {
  ensureMediaIndexes, groupByUrl, runCopyBatch, scanLegacyReferences, verifyMediaFiles,
} = await import('../../services/mediaMigration.service.js');
const { filesystemProvider: storage, buildStorageKey, resolveKey } = await import('../../services/mediaStorage.service.js');
const { resolveResponseText, clearMediaUrlCache } = await import('../../services/mediaUrl.service.js');

let memoryServer, root, image, realFetch;
const failing = new Set();
let served = 'image';

const urlFor = (set, i) => `https://res.cloudinary.com/demo/image/upload/v1/nhcone/products/${set}-${i}.jpg`;
const assetsIn = async (collection) => {
  const refs = [];
  for await (const ref of scanLegacyReferences({ collections: [collection] })) refs.push(ref);
  return groupByUrl(refs);
};
const seed = async (collection, urls) => {
  await mongoose.connection.db.collection(collection).insertMany(urls.map((url) => ({ images: [url] })));
  return assetsIn(collection);
};
const copyAll = async (assets, options = {}) => {
  let after = null;
  const runs = [];
  do {
    const result = await runCopyBatch({ assets, category: 'seller.product', apply: true, after, ...options });
    runs.push(result);
    after = result.nextAfter;
  } while (after);
  return runs;
};

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('media-migration-test'), { autoIndex: false });
  root = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-migration-'));
  Object.assign(process.env, {
    MEDIA_ROOT: root, MEDIA_SIGNING_SECRET: 's'.repeat(40), MEDIA_PUBLIC_BASE_URL: 'https://api.example.test', MEDIA_MIN_FREE_BYTES: '0',
    CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's',
  });
  image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#27ae60' } }).jpeg().toBuffer();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url) => {
    if (failing.has(url)) throw new Error(`connect ECONNRESET while fetching ${url}`);
    const body = served === 'html' ? Buffer.from('<html><script>x</script></html>') : image;
    return new Response(body, { headers: { 'content-length': String(body.length) } });
  });
});

afterAll(async () => {
  global.fetch = realFetch;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => { failing.clear(); served = 'image'; global.fetch.mockClear(); clearMediaUrlCache(); delete process.env.MEDIA_LEGACY_READ_MAP; });

describe('index migration (explicit, add-only)', () => {
  test('dry-run reports missing indexes without creating them; apply creates only those and never drops extras', async () => {
    const dry = await ensureMediaIndexes();
    const media = dry.find((c) => c.collection === 'media');
    expect(media.missing).toEqual(expect.arrayContaining([{ 'legacy.url': 1 }, { storageKey: 1 }]));
    expect(media.created).toEqual([]);

    await Media.collection.createIndex({ category: 1, createdAt: -1 }, { name: 'operator_extra' });
    const applied = await ensureMediaIndexes({ apply: true });
    expect(applied.find((c) => c.collection === 'media').created.length).toBe(media.missing.length);
    const names = (await Media.collection.indexes()).map((ix) => ix.name);
    expect(names).toContain('operator_extra');
    expect((await Media.collection.indexes()).find((ix) => JSON.stringify(ix.key) === '{"legacy.url":1}').unique).toBe(true);

    const again = await ensureMediaIndexes({ apply: true });
    expect(again.every((c) => c.missing.length === 0 && c.created.length === 0)).toBe(true);
  });
});

describe('inventory grouping', () => {
  test('a URL referenced from several records is one asset with several references', async () => {
    const url = urlFor('dup', 1);
    await mongoose.connection.db.collection('dup_products').insertOne({ images: [url, url] });
    await mongoose.connection.db.collection('dup_orders').insertOne({ items: [{ image: url }] });
    const refs = [];
    for await (const ref of scanLegacyReferences({ collections: ['dup_products', 'dup_orders'] })) refs.push(ref);
    const assets = groupByUrl(refs);
    expect(assets).toHaveLength(1);
    expect(assets[0].references).toHaveLength(3);
    expect(assets[0].category).toBe('seller.product');
  });

  test('legacy /uploads/ fallback URLs are reported separately and never copied', async () => {
    await mongoose.connection.db.collection('local_refs').insertOne({ image: '/uploads/products/abc.jpg' });
    const refs = [];
    for await (const ref of scanLegacyReferences({ collections: ['local_refs'] })) refs.push(ref);
    expect(refs).toEqual([expect.objectContaining({ kind: 'local-upload', category: null })]);
    expect(groupByUrl(refs)).toEqual([]);
  });
});

describe('batch progression', () => {
  test('more than 200 assets: cursor batches cover everything once, with accurate pending counts', async () => {
    const urls = Array.from({ length: 250 }, (_, i) => urlFor('page', i));
    const assets = await seed('page_products', urls);
    const dry = await runCopyBatch({ assets, category: 'seller.product', limit: 100 });
    expect(dry).toMatchObject({ mode: 'dry-run', 'would-copy': 100, pendingAfter: 250 });
    expect(await Media.countDocuments({ 'legacy.url': { $in: urls } })).toBe(0);

    const runs = await copyAll(assets, { limit: 100 });
    expect(runs.map((r) => r.batch)).toEqual([100, 100, 50]);
    expect(runs.map((r) => r.pendingAfter)).toEqual([150, 50, 0]);
    expect(runs.reduce((n, r) => n + r.verified, 0)).toBe(250);
    expect(global.fetch).toHaveBeenCalledTimes(250);
    expect(await Media.countDocuments({ 'legacy.url': { $in: urls }, migrationStatus: 'verified' })).toBe(250);
  });

  test('re-running a finished category is a no-op (idempotent): nothing fetched, no new records', async () => {
    const assets = await assetsIn('page_products');
    const before = await Media.countDocuments();
    const result = await runCopyBatch({ assets, category: 'seller.product', limit: 500, apply: true });
    expect(result).toMatchObject({ batch: 0, verified: 0, pendingAfter: 0, nextAfter: null });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await Media.countDocuments()).toBe(before);
  });
});

describe('failures and retries', () => {
  test('a failed asset stays pending, is reported without its URL, and a retry reuses the same record', async () => {
    const urls = [0, 1, 2].map((i) => urlFor('retry', i));
    const assets = await seed('retry_products', urls);
    failing.add(urls[1]);
    const first = await runCopyBatch({ assets, category: 'seller.product', limit: 10, apply: true });
    expect(first).toMatchObject({ verified: 2, failed: 1, pendingAfter: 1 });
    expect(JSON.stringify(first.failures)).not.toMatch(/https?:|cloudinary/);
    expect(first.failures[0]).toMatchObject({ asset: expect.stringMatching(/^[a-f0-9]{12}$/), reason: expect.stringContaining('[url]') });
    const failedRecord = await Media.findOne({ 'legacy.url': urls[1] }).select('+storageKey').lean();
    expect(failedRecord).toMatchObject({ migrationStatus: 'failed', migration: { attempts: 1 } });
    expect(failedRecord.storageKey).toBeUndefined();

    failing.clear();
    const second = await runCopyBatch({ assets, category: 'seller.product', limit: 10, apply: true });
    expect(second).toMatchObject({ batch: 1, verified: 1, failed: 0, pendingAfter: 0 });
    expect(await Media.countDocuments({ 'legacy.url': { $in: urls } })).toBe(3);
    expect((await Media.findOne({ 'legacy.url': urls[1] }).lean()).migration.attempts).toBe(2);
  });

  test('an asset that keeps failing is skipped after max attempts so batches still progress', async () => {
    const urls = [urlFor('stuck', 0), urlFor('stuck', 1)];
    const assets = await seed('stuck_products', urls);
    failing.add(urls[0]);
    for (let i = 0; i < 3; i += 1) await runCopyBatch({ assets, category: 'seller.product', limit: 1, apply: true, after: null, maxAttempts: 3 }).catch(() => {});
    const next = await runCopyBatch({ assets, category: 'seller.product', limit: 1, apply: true, maxAttempts: 3 });
    // The stuck asset no longer blocks the queue: the other asset is processed.
    expect(next.after).toMatchObject({ blocked: 1 });
    expect(await Media.countDocuments({ 'legacy.url': urls[1], migrationStatus: 'verified' })).toBe(1);
    const retried = await runCopyBatch({ assets, category: 'seller.product', limit: 5, apply: true, retryFailed: true });
    expect(retried).toMatchObject({ batch: 1, failed: 1, pendingAfter: 1 });
  });

  test('an interrupted copy (record and file left behind) is resumed without a duplicate record or file', async () => {
    const url = urlFor('crash', 0);
    const assets = await seed('crash_products', [url]);
    const staleKey = buildStorageKey({ area: 'public', dir: 'products', ext: 'jpg' });
    await storage.put({ key: staleKey, source: { buffer: Buffer.from('partial') }, visibility: 'public' });
    await Media.create({ category: 'seller.product', visibility: 'public', uploadStatus: 'pending', migrationStatus: 'copying', storageKey: staleKey, legacy: { url } });

    const result = await runCopyBatch({ assets, category: 'seller.product', limit: 5, apply: true });
    expect(result).toMatchObject({ verified: 1, pendingAfter: 0 });
    const records = await Media.find({ 'legacy.url': url }).select('+storageKey').lean();
    expect(records).toHaveLength(1);
    expect(records[0].storageKey).not.toBe(staleKey);
    await expect(storage.openKey(staleKey)).rejects.toMatchObject({ status: 404 });
    await expect(storage.verifyKey(records[0].storageKey, records[0])).resolves.toBe(true);
  });

  test('content not allowed for the category is quarantined, never served, and not retried', async () => {
    const url = urlFor('quarantine', 0);
    const assets = await seed('quarantine_products', [url]);
    served = 'html';
    const result = await runCopyBatch({ assets, category: 'seller.product', limit: 5, apply: true });
    expect(result).toMatchObject({ quarantined: 1, pendingAfter: 0 });
    const record = await Media.findOne({ 'legacy.url': url }).select('+storageKey').lean();
    expect(record.storageKey).toMatch(/^quarantine\//);
    process.env.MEDIA_LEGACY_READ_MAP = 'on';
    const text = JSON.stringify({ image: url });
    await expect(resolveResponseText(text, {})).resolves.toBe(text);
    global.fetch.mockClear();
    await runCopyBatch({ assets, category: 'seller.product', limit: 5, apply: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('verification', () => {
  test('pages through every record and detects a corrupted file; apply stops serving it and the next copy repairs it', async () => {
    const all = await verifyMediaFiles({ pageSize: 37 });
    expect(all.checked).toBeGreaterThanOrEqual(250);
    expect(all.failures).toEqual([]);

    const victim = await Media.findOne({ migrationStatus: 'verified', 'legacy.url': urlFor('page', 7) }).select('+storageKey').lean();
    await writeFile(resolveKey(victim.storageKey), Buffer.from('tampered'));
    const report = await verifyMediaFiles({ pageSize: 37 });
    expect(report.failures).toEqual([expect.objectContaining({ mediaId: String(victim._id), reason: 'checksum or size mismatch' })]);
    expect((await Media.findById(victim._id).lean()).migrationStatus).toBe('verified');

    const applied = await verifyMediaFiles({ pageSize: 37, apply: true });
    expect(applied.markedFailed).toBe(1);
    expect((await Media.findById(victim._id).lean()).migrationStatus).toBe('failed');

    const repair = await runCopyBatch({ assets: await assetsIn('page_products'), category: 'seller.product', limit: 500, apply: true });
    expect(repair).toMatchObject({ batch: 1, verified: 1, pendingAfter: 0 });
    await expect(verifyMediaFiles()).resolves.toMatchObject({ failures: [] });
  });

  test('a restored backup copy is verified against the database without touching records', async () => {
    const restored = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-restore-'));
    try {
      await cp(root, restored, { recursive: true });
      await expect(verifyMediaFiles({ root: restored })).resolves.toMatchObject({ failures: [] });
      const sample = await Media.findOne({ migrationStatus: 'verified' }).select('+storageKey').lean();
      await rm(path.join(restored, sample.storageKey));
      const report = await verifyMediaFiles({ root: restored });
      expect(report.failures).toEqual([expect.objectContaining({ mediaId: String(sample._id), reason: 'file missing or unreadable' })]);
      expect((await Media.findById(sample._id).lean()).migrationStatus).toBe('verified');
    } finally {
      await rm(restored, { recursive: true, force: true });
    }
  });
});
