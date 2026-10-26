import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
const upload = jest.fn(async () => 'https://example.test/review-photo.jpg');
jest.unstable_mockModule('../services/cloudinary.service.js', () => ({ uploadToCloudinary: upload, deleteFromCloudinary: jest.fn() }));
const [{ default: routes }, { default: User }, { default: Product }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../routes/product.routes.js'), import('../models/User.js'), import('../models/Product.js'), import('../middlewares/error.middleware.js'), import('../config/jwt.js'),
]);
const app = express(); app.use(express.json()); app.use('/api/products', routes); app.use(errorHandler);
let db, user, product;
const auth = req => req.set('Authorization', 'Bearer ' + jwt.sign({ id: String(user._id), type: 'user', role: 'buyer' }, JWT_SECRET));
const submit = () => auth(request(app).post('/api/products/' + product._id + '/reviews'));
beforeAll(async () => { db = await MongoMemoryServer.create({ binary: { version: '7.0.14' } }); await mongoose.connect(db.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  jest.clearAllMocks(); upload.mockResolvedValue('https://example.test/review-photo.jpg');
  await Promise.all([User.deleteMany({}), Product.deleteMany({})]);
  user = await User.create({ phone: '9876500456', name: 'Review fixture', roles: ['buyer'] });
  product = await Product.create({ type: 'ecommerce', name: 'Review fixture product', category: new mongoose.Types.ObjectId(),
    images: ['https://example.test/product.jpg'], status: 'approved', isActive: true, variants: [{ name: 'Default', price: 100, mrp: 120, stock: 10, unit: 'piece' }] });
});

test('short text-only JSON reviews still publish and appear on the product page', async () => {
  await submit().send({ rating: 5, comment: 'food product' }).expect(201);
  const res = await request(app).get('/api/products/' + product._id + '/reviews').expect(200);
  expect(res.body.data.reviews[0]).toMatchObject({ comment: 'food product', rating: 5, userName: 'Review fixture', images: [] });
  expect(res.body.data.summary).toMatchObject({ count: 1, average: 5 }); expect(upload).not.toHaveBeenCalled();
});

test('short text-only multipart reviews publish without requiring a photo', async () => {
  await submit().field('rating', '4').field('comment', 'food product').expect(201);
  expect((await Product.findById(product._id)).ratings.reviews[0].comment).toBe('food product');
  expect(upload).not.toHaveBeenCalled();
});

test('photos larger than the default JSON body limit upload as files and persist only URLs', async () => {
  const bytes = Buffer.alloc(256 * 1024, 1);
  await submit().field('rating', '5').field('comment', 'food product')
    .attach('images', bytes, { filename: 'review.jpg', contentType: 'image/jpeg' }).expect(201);
  expect(upload).toHaveBeenCalledWith(bytes, 'reviews', { resource_type: 'image' });
  const stored = await Product.findById(product._id);
  expect(stored.ratings.reviews[0].images).toEqual(['https://example.test/review-photo.jpg']);
  expect(JSON.stringify(stored).length).toBeLessThan(10000);
  const res = await request(app).get('/api/products/' + product._id + '/reviews').expect(200);
  expect(res.body.data.reviews[0].images).toEqual(['https://example.test/review-photo.jpg']);
});

test('four supported review photos can be submitted together', async () => {
  let req = submit().field('rating', '5').field('comment', 'food product');
  for (let i = 0; i < 4; i++) req = req.attach('images', Buffer.alloc(128 * 1024), { filename: 'photo-' + i + '.png', contentType: 'image/png' });
  await req.expect(201); expect(upload).toHaveBeenCalledTimes(4);
  expect((await Product.findById(product._id)).ratings.reviews[0].images).toHaveLength(4);
});

test('oversized photos fail with a useful message before saving or uploading', async () => {
  const res = await submit().field('rating', '5').field('comment', 'food product')
    .attach('images', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.jpg', contentType: 'image/jpeg' }).expect(413);
  expect(res.body.message).toMatch(/5 MB/); expect(upload).not.toHaveBeenCalled();
  expect((await Product.findById(product._id)).ratings.reviews).toHaveLength(0);
});

test('more than four photos or unsupported file types cannot create a review', async () => {
  let req = submit().field('rating', '5').field('comment', 'food product');
  for (let i = 0; i < 5; i++) req = req.attach('images', Buffer.from('fixture'), { filename: i + '.jpg', contentType: 'image/jpeg' });
  expect((await req.expect(400)).body.message).toMatch(/4 review photos/);
  await submit().field('rating', '5').attach('images', Buffer.from('pdf'), { filename: 'photo.pdf', contentType: 'application/pdf' }).expect(400);
  expect(upload).not.toHaveBeenCalled(); expect((await Product.findById(product._id)).ratings.reviews).toHaveLength(0);
});

test('a duplicate review is rejected before uploading another photo', async () => {
  await submit().send({ rating: 5, comment: 'food product' }).expect(201);
  await submit().field('rating', '5').attach('images', Buffer.from('photo'), { filename: 'photo.webp', contentType: 'image/webp' }).expect(400);
  expect(upload).not.toHaveBeenCalled(); expect((await Product.findById(product._id)).ratings.reviews).toHaveLength(1);
});

test('failed photo storage retains no partial review', async () => {
  upload.mockRejectedValueOnce(Object.assign(new Error('Photo upload unavailable'), { status: 503 }));
  await submit().field('rating', '5').field('comment', 'food product')
    .attach('images', Buffer.from('photo'), { filename: 'photo.jpg', contentType: 'image/jpeg' }).expect(503);
  expect((await Product.findById(product._id)).ratings.reviews).toHaveLength(0);
});

test('anonymous photo submissions cannot upload or publish a review', async () => {
  await request(app).post('/api/products/' + product._id + '/reviews').field('rating', '5')
    .attach('images', Buffer.from('photo'), { filename: 'photo.jpg', contentType: 'image/jpeg' }).expect(401);
  expect(upload).not.toHaveBeenCalled();
});
