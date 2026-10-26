import { jest } from '@jest/globals';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../../models/Product.js';
import '../../models/Category.js';
import '../../models/Seller.js';
import Index from '../../models/ProductImageIndex.js';
import Job from '../../models/ProductImageIndexJob.js';
import { fingerprintImage, imageSimilarity, imageSearchMaxBytes, IMAGE_SEARCH_MODE } from '../../services/imageFingerprint.service.js';
import { syncProductImageIndex, processImageIndexJob, allowedCatalogImageUrl, downloadCatalogImage } from '../../services/imageSearchIndexer.service.js';
import { imageSearchRouter } from '../../routes/imageSearch.routes.js';
import { errorHandler } from '../../middlewares/error.middleware.js';

let db, png, jpeg, webp, different;
const id = () => new mongoose.Types.ObjectId();
const url = suffix => `https://res.cloudinary.com/fixture/image/upload/${suffix}.png`;
const makeApp = () => { const app = express(); app.use('/image', imageSearchRouter()); app.use(errorHandler); return app; };
const search = (app, buffer = png, filename = 'photo.png', type = 'image/png', query = '?type=grocery') => request(app).post(`/image${query}`).attach('image', buffer, { filename, contentType: type });
async function indexed(extra = {}, buffer = png) {
  const product = await Product.create({ type: 'grocery', name: 'Fixture product', category: id(), price: 20, mrp: 25, stock: 5, images: [url(id())], ...extra });
  await syncProductImageIndex(product._id, async () => buffer); return product;
}
beforeAll(async () => {
  db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); await Promise.all([Product.init(), Index.init(), Job.init()]);
  const svg = Buffer.from('<svg width="128" height="128"><rect width="128" height="128" fill="white"/><rect x="20" y="10" width="70" height="108" rx="8" fill="#06b9df"/><circle cx="55" cy="48" r="22" fill="#ff8500"/><path d="M30 85h50v20H30" fill="black"/></svg>');
  png = await sharp(svg).png().toBuffer(); jpeg = await sharp(png).resize(256, 256).jpeg({ quality: 85 }).toBuffer(); webp = await sharp(png).webp().toBuffer();
  different = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#f21c24' } }).png().toBuffer();
});
beforeEach(async () => { await Promise.all([Product.deleteMany({}), Index.deleteMany({}), Job.deleteMany({})]); });
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { delete process.env.IMAGE_SEARCH_ENABLED; await mongoose.disconnect(); await db?.stop(); });

test('real decoding and visual fingerprints match resized/re-encoded images ahead of dissimilar images', async () => {
  const original = await fingerprintImage(png), resized = await fingerprintImage(jpeg), alternate = await fingerprintImage(webp), unrelated = await fingerprintImage(different);
  expect(imageSimilarity(original, original)).toBe(1);
  expect(imageSimilarity(original, resized)).toBeGreaterThan(0.86);
  expect(imageSimilarity(original, alternate)).toBeGreaterThan(0.86);
  expect(imageSimilarity(original, unrelated)).toBeLessThan(0.86);
});
test('public multipart search uses the real image index and returns the existing product contract', async () => {
  const p = await indexed(); await indexed({ name: 'Unrelated' }, different);
  const response = await search(makeApp(), jpeg, 'photo.jpeg', 'image/jpeg').expect(200);
  expect(response.body.data.map(p => p._id)).toEqual([String(p._id)]);
  expect(response.body.data[0]).toMatchObject({ name: 'Fixture product', price: 20, images: p.images });
  expect(response.body.meta).toMatchObject({ mode: IMAGE_SEARCH_MODE, total: 1 });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(response.body)).not.toMatch(/histogram|spatial|digital\.file|private-data/);
});
test('JPG, PNG and WEBP uploads are accepted with matching declarations', async () => {
  await indexed(); const app = makeApp();
  for (const [buffer, name, mime] of [[png, 'photo.png', 'image/png'], [jpeg, 'photo.jpg', 'image/jpeg'], [webp, 'photo.webp', 'image/webp']]) await search(app, buffer, name, mime).expect(200);
});
test('inactive, deleted, pending, out-of-stock, legacy and wrong-channel products never appear', async () => {
  const visible = await indexed();
  for (const extra of [{ isActive: false }, { isDeleted: true }, { status: 'pending' }, { stock: 0 }, { type: 'shg' }, { type: 'ecommerce' }, { shgStoreId: id() }]) await indexed(extra);
  const response = await search(makeApp()).expect(200);
  expect(response.body.data.map(p => p._id)).toEqual([String(visible._id)]);
});
test('live visibility and current-image checks override stale index entries', async () => {
  const p = await indexed(), app = makeApp();
  await Product.updateOne({ _id: p._id }, { $set: { images: [url('replacement')] } });
  expect((await Job.findOne({ productId: p._id })).revision).toBe(2);
  expect((await search(app).expect(200)).body.data).toEqual([]);
});
test('cross-listed available products match the requested storefront', async () => {
  const p = await indexed({ type: 'ecommerce', channels: [{ type: 'grocery', category: id(), isActive: true }] });
  expect((await search(makeApp()).expect(200)).body.data[0]._id).toBe(String(p._id));
});
test('unbuilt catalogues return errors; legacy flags cannot disable built image search', async () => {
  const app = makeApp(); await search(app).expect(503);
  await indexed({}, different); expect((await search(app).expect(200)).body.data).toEqual([]);
  process.env.IMAGE_SEARCH_ENABLED = 'false';
  expect((await search(app).expect(200)).body.data).toEqual([]);
  expect((await request(app).get('/image/config').expect(200)).body.data.enabled).toBe(true);
});
test('invalid, deceptive, truncated, unsupported and oversized images fail safely', async () => {
  const app = makeApp();
  await search(app, png, 'photo.exe', 'image/png').expect(400);
  await search(app, png, 'photo.jpg', 'image/jpeg').expect(400);
  await search(app, Buffer.from('<svg></svg>'), 'photo.png').expect(400);
  await search(app, png.subarray(0, 30)).expect(400);
  await search(app, Buffer.alloc(imageSearchMaxBytes() + 1)).expect(413);
  await request(app).post('/image').field('image', 'not a file').expect(413);
  await expect(fingerprintImage(await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#fff' } }).png().toBuffer())).rejects.toThrow('20 megapixels');
});
test('only one image is accepted and query/page validation is bounded', async () => {
  const app = makeApp();
  await request(app).post('/image').attach('image', png, 'one.png').attach('image', png, 'two.png').expect(413);
  await search(app, png, 'photo.png', 'image/png', '?type=shg').expect(400);
  // Any whole page is allowed (6a64840 removed the 100-result cap); malformed or
  // overflowing pages are still refused before any search work.
  for (const page of ['0', '-1', '1.5', 'abc', '9007199254740991']) await search(app, png, 'photo.png', 'image/png', `?page=${page}`).expect(400);
});
test('anonymous search is allowed; a supplied invalid session is rejected; requests are rate limited', async () => {
  const app = makeApp();
  await request(app).post('/image').set('Authorization', 'Bearer invalid-fixture').attach('image', png, 'photo.png').expect(401);
  for (let i = 0; i < 10; i++) await search(app, Buffer.from('invalid')).expect(400);
  await search(app).expect(429);
});
test('index refresh replaces image references and product saves durably queue refreshes', async () => {
  const p = await indexed(); expect(await Job.exists({ productId: p._id })).toBeTruthy();
  p.images = [url('new-photo')]; await p.save(); await syncProductImageIndex(p._id, async () => webp);
  expect(await Index.countDocuments({ productId: p._id })).toBe(1);
  expect((await Index.findOne({ productId: p._id })).imageUrl).toBe(url('new-photo'));
  p.isDeleted = true; await p.save(); await syncProductImageIndex(p._id); expect(await Index.countDocuments({ productId: p._id })).toBe(0);
});
test('worker fetches only allowlisted public catalogue URLs and indexes real pixels', async () => {
  const p = await Product.create({ type: 'grocery', name: 'Queued', category: id(), price: 1, stock: 1, images: [url('queued')] });
  const fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
  expect(await processImageIndexJob()).toBe(true); expect(await Job.countDocuments()).toBe(0); expect(await Index.exists({ productId: p._id })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const bad of ['http://127.0.0.1/a.png', 'https://localhost/a.png', 'https://res.cloudinary.com.evil.test/x', 'file:///secret', 'https://user:pass@res.cloudinary.com/a.png']) expect(allowedCatalogImageUrl(bad)).toBe(false);
  await expect(downloadCatalogImage('http://127.0.0.1/private')).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('failed downloads retain jobs for bounded retries without changing product data', async () => {
  const p = await indexed(); jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Synthetic download failure'));
  await processImageIndexJob(); const job = await Job.findOne({ productId: p._id }); expect(job.attempts).toBe(1); expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect((await Product.findById(p._id)).images).toEqual(p.images);
});
test('image pagination stays ordered and is derived from live eligible matches', async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(String((await indexed({ name: `Fixture ${i}` }))._id));
  const app = makeApp(), first = await search(app, png, 'p.png', 'image/png', '?type=grocery&page=1&limit=2').expect(200);
  const second = await search(app, png, 'p.png', 'image/png', '?type=grocery&page=2&limit=2').expect(200);
  expect([...first.body.data, ...second.body.data].map(p => p._id)).toEqual(ids.sort());
  expect(second.body.meta).toMatchObject({ page: 2, limit: 2, total: 4 });
});
test('public image errors never expose server paths or stacks even in development', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try { const response = await search(makeApp(), Buffer.from('invalid')).expect(400); expect(response.body.stack).toBeUndefined(); expect(JSON.stringify(response.body)).not.toMatch(/Appzeto|node_modules|imageFingerprint\.service/); }
  finally { process.env.NODE_ENV = previous; }
});
