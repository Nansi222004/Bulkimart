import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Real routes, models (in-memory MongoDB), filesystem storage and sharp.
// Only authentication is stubbed (x-test-user header) and Cloudinary downloads are faked.
jest.unstable_mockModule('../../middlewares/auth.middleware.js', () => ({
  protect: (req, _res, next) => {
    const header = req.get('x-test-user');
    if (!header) return next(Object.assign(new Error('Not authorized'), { status: 401 }));
    const user = JSON.parse(header);
    req.user = { _id: new mongoose.Types.ObjectId(user.id) };
    req.userType = user.admin ? 'admin' : 'user';
    next();
  },
  requireAdmin: (req, _res, next) => next(req.userType === 'admin' ? undefined : Object.assign(new Error('Forbidden'), { status: 403 })),
}));

const { mediaRouter, mediaApiRouter, mediaAdminRouter } = await import('../../routes/media.routes.js');
const { errorHandler } = await import('../../middlewares/error.middleware.js');
const { storeUpload } = await import('../../services/media.service.js');
const { signedUrl, resolveResponseText, clearMediaUrlCache } = await import('../../services/mediaUrl.service.js');
const { copyLegacyAsset, verifyMediaFiles, ensureMediaIndexes } = await import('../../services/mediaMigration.service.js');
const { default: Media } = await import('../../models/Media.js');
const { default: MediaAccessAudit } = await import('../../models/MediaAccessAudit.js');

let memoryServer, root, app;
const OWNER = new mongoose.Types.ObjectId().toString();
const OTHER = new mongoose.Types.ObjectId().toString();
const ADMIN = new mongoose.Types.ObjectId().toString();
const as = (id, admin = false) => JSON.stringify({ id, admin });
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const jpeg = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#2e86de' } }).jpeg().toBuffer();
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('media-test'), { autoIndex: true });
  await ensureMediaIndexes({ apply: true });
  root = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-media-http-'));
  Object.assign(process.env, {
    MEDIA_ROOT: root, MEDIA_SIGNING_SECRET: 's'.repeat(40), MEDIA_PUBLIC_BASE_URL: 'https://api.example.test', MEDIA_MIN_FREE_BYTES: '0',
    CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's',
  });
  app = express();
  app.set('trust proxy', 1);
  app.use('/media', mediaRouter);
  app.use('/api/media', mediaApiRouter);
  app.use('/api/admin/media', mediaAdminRouter);
  app.use(errorHandler);
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => { clearMediaUrlCache(); delete process.env.MEDIA_LEGACY_READ_MAP; });

const storeKyc = async () => (await storeUpload({ source: { buffer: pdf }, category: 'seller.kyc', owner: { id: OWNER, role: 'seller' }, originalName: 'pan.pdf', declaredMime: 'application/pdf' })).media;

describe('private documents', () => {
  test('a signed link delivers a KYC document privately and records an audit entry', async () => {
    const media = await storeKyc();
    const res = await request(app).get(pathOf(signedUrl(media._id, ADMIN))).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.body.equals(pdf)).toBe(true);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="pan.pdf"/);
    expect(await MediaAccessAudit.countDocuments({ mediaId: media._id, viewerId: ADMIN })).toBe(1);
  });

  test('expired and tampered links are refused and not audited', async () => {
    const media = await storeKyc();
    const expired = signedUrl(media._id, ADMIN, Date.now() - 60 * 60 * 1000);
    expect((await request(app).get(pathOf(expired))).status).toBe(403);
    const tampered = pathOf(signedUrl(media._id, ADMIN)).replace(/s=[^&]+$/, 's=AAAA');
    expect((await request(app).get(tampered)).status).toBe(403);
    const otherViewer = pathOf(signedUrl(media._id, ADMIN)).replace(`v=${ADMIN}`, `v=${OTHER}`);
    expect((await request(app).get(otherViewer)).status).toBe(403);
    expect(await MediaAccessAudit.countDocuments({ mediaId: media._id })).toBe(0);
  });

  test('direct access by ID: owner and admin only; anyone else gets 404, anonymous 401', async () => {
    const media = await storeKyc();
    expect((await request(app).get(`/api/media/${media._id}`).set('x-test-user', as(OWNER))).status).toBe(200);
    expect((await request(app).get(`/api/media/${media._id}`).set('x-test-user', as(ADMIN, true))).status).toBe(200);
    expect((await request(app).get(`/api/media/${media._id}`).set('x-test-user', as(OTHER))).status).toBe(404);
    expect((await request(app).get(`/api/media/${media._id}`)).status).toBe(401);
    expect((await request(app).get(`/api/media/${new mongoose.Types.ObjectId()}`).set('x-test-user', as(ADMIN, true))).status).toBe(404);
  });

  test('a private file is never reachable through the public media route', async () => {
    const media = await storeKyc();
    const { storageKey } = await Media.findById(media._id).select('+storageKey').lean();
    expect((await request(app).get(`/media/${storageKey.replace(/^private\//, '')}`)).status).toBe(404);
  });
});

describe('public media', () => {
  test('served with long-lived caching, correct type and range support (video seeking)', async () => {
    const { reference } = await storeUpload({ source: { buffer: await jpeg() }, category: 'seller.product', owner: { id: OWNER, role: 'seller' }, originalName: 'p.jpg', declaredMime: 'image/jpeg' });
    expect(reference).toMatch(/^https:\/\/api\.example\.test\/media\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
    const full = await request(app).get(new URL(reference).pathname).buffer(true).parse(binary);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toMatch(/^image\/webp/);
    expect(full.headers['cache-control']).toMatch(/immutable/);
    const partial = await request(app).get(new URL(reference).pathname).set('Range', 'bytes=0-9').buffer(true).parse(binary);
    expect(partial.status).toBe(206);
    expect(partial.body.length).toBe(10);
  });

  test.each([
    '/media/products/2026/11/..%2F..%2Fetc%2Fpasswd',
    '/media/seller-documents/2026/11/00000000-0000-4000-8000-000000000000.webp',
    '/media/products/2026/11/not-a-uuid.webp',
    '/media/products/',
    '/media/temp/2026/11/00000000-0000-4000-8000-000000000000.webp',
  ])('%s → 404, never a file listing or the SPA', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

describe('symlink attacks', () => {
  test('a symlink planted in a public directory pointing at a private document is not served', async () => {
    const media = await storeKyc();
    const { storageKey } = await Media.findById(media._id).select('+storageKey').lean();
    const link = path.join(root, 'public', 'products', '2026', '11', '11111111-1111-4111-8111-111111111111.webp');
    const { mkdir: mk, symlink } = await import('node:fs/promises');
    await mk(path.dirname(link), { recursive: true });
    try { await symlink(path.join(root, storageKey), link); } catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) return; // symlinks need extra privileges on Windows
      throw error;
    }
    const res = await request(app).get('/media/products/2026/11/11111111-1111-4111-8111-111111111111.webp');
    expect(res.status).toBe(404);
  });
});

describe('upload failure safety', () => {
  test('a rejected upload leaves no record and no file', async () => {
    const before = await Media.countDocuments();
    const filesBefore = await readdir(root, { recursive: true });
    await expect(storeUpload({ source: { buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]) }, category: 'seller.product', originalName: 'x.jpg', declaredMime: 'image/jpeg' })).rejects.toMatchObject({ status: 400 });
    expect(await Media.countDocuments()).toBe(before);
    expect((await readdir(root, { recursive: true })).sort()).toEqual(filesBefore.sort());
  });
});

describe('Cloudinary asset migration', () => {
  const legacyUrl = 'https://res.cloudinary.com/demo/image/upload/v1/nhcone/products/abc.jpg';
  let source, realFetch;
  beforeAll(async () => { source = await jpeg(); realFetch = global.fetch; });
  afterAll(() => { global.fetch = realFetch; });
  const serve = (etag) => { global.fetch = jest.fn(async () => new Response(source, { headers: { 'content-type': 'image/jpeg', 'content-length': String(source.length), etag } })); };
  const md5 = () => `"${createHash('md5').update(source).digest('hex')}"`;

  test('copies bit-for-bit, verifies, and is idempotent on re-run', async () => {
    serve(md5());
    await expect(copyLegacyAsset({ url: legacyUrl, category: 'seller.product' }, { apply: true })).resolves.toMatchObject({ status: 'verified' });
    await expect(copyLegacyAsset({ url: legacyUrl, category: 'seller.product' }, { apply: true })).resolves.toMatchObject({ status: 'skipped' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const rows = await Media.find({ 'legacy.url': legacyUrl }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sha256: createHash('sha256').update(source).digest('hex'), sizeBytes: source.length, migrationStatus: 'verified', legacy: { publicId: 'nhcone/products/abc', resourceType: 'image' } });
    await expect(verifyMediaFiles()).resolves.toMatchObject({ failures: [] });
  });

  test('historical references resolve to the copy at read time only when the map is on', async () => {
    const text = JSON.stringify({ items: [{ image: legacyUrl }] });
    await expect(resolveResponseText(text, {})).resolves.toBe(text);
    process.env.MEDIA_LEGACY_READ_MAP = 'on';
    const resolved = JSON.parse(await resolveResponseText(text, {}));
    expect(resolved.items[0].image).toMatch(/^https:\/\/api\.example\.test\/media\/products\//);
    expect((await request(app).get(new URL(resolved.items[0].image).pathname)).status).toBe(200);
  });

  test('a checksum mismatch with the source ETag fails safely: no file, record stays failed and is never served', async () => {
    serve('"00000000000000000000000000000000"');
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/nhcone/products/mismatch.jpg';
    await expect(copyLegacyAsset({ url, category: 'seller.product' }, { apply: true })).rejects.toThrow(/ETag/);
    const record = await Media.findOne({ 'legacy.url': url }).select('+storageKey').lean();
    expect(record).toMatchObject({ migrationStatus: 'failed', uploadStatus: 'pending' });
    expect(record.storageKey).toBeUndefined();
    process.env.MEDIA_LEGACY_READ_MAP = 'on';
    const text = JSON.stringify({ image: url });
    await expect(resolveResponseText(text, {})).resolves.toBe(text);
  });

  test('refuses URLs outside the configured Cloudinary account (no arbitrary fetches)', async () => {
    serve(md5());
    await expect(copyLegacyAsset({ url: 'https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg', category: 'seller.product' }, { apply: true })).rejects.toThrow(/configured Cloudinary account/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('administration', () => {
  test('storage health is admin-only and reports a writable store', async () => {
    expect((await request(app).get('/api/admin/media/health').set('x-test-user', as(OTHER))).status).toBe(403);
    const res = await request(app).get('/api/admin/media/health').set('x-test-user', as(ADMIN, true));
    expect(res.status).toBe(200);
    expect(res.body.data.storage).toMatchObject({ configured: true, writable: true });
  });
});
