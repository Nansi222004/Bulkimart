import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Cart from '../models/Cart.js';
import Category from '../models/Category.js';
import Coupon from '../models/Coupon.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import cartRoutes from '../routes/cart.routes.js';
import couponRoutes from '../routes/coupon.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

let db, app, user, product, token;
beforeAll(async () => {
  db = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  const uri = db.getUri('coupon_automation_test');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri)) throw new Error('Refusing non-local test database');
  await mongoose.connect(uri);
  app = express(); app.use(express.json());
  app.use('/api/cart', cartRoutes); app.use('/api/coupons', couponRoutes); app.use(errorHandler);
  user = await User.create({ name: 'Coupon shopper', phone: '9100000099', roles: ['buyer'] });
  const category = await Category.create({ name: 'Eligible category', slug: 'test-eligible-category', type: 'grocery' });
  product = await Product.create({ name: 'Eligible item', type: 'grocery', category: category._id, price: 85,
    mrp: 100, stock: 20, unit: 'piece', isActive: true, status: 'approved' });
  token = `Bearer ${jwt.sign({ id: String(user._id), type: 'user' }, JWT_SECRET)}`;
}, 300_000);
afterEach(async () => { await Promise.all([Cart.deleteMany({}), Coupon.deleteMany({})]); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

const offer = (extra = {}) => ({ code: 'SAVE20', title: 'Save on your order', discountType: 'percentage', value: 20,
  minOrderValue: 500, channel: 'grocery', isActive: true, isPublic: true, autoApply: true, ...extra });
const add = qty => request(app).post('/api/cart').set('Authorization', token).send({ productId: product.id, qty }).expect(200);
const available = () => request(app).get('/api/coupons/available?channel=grocery').set('Authorization', token).expect(200);

test('threshold uses the engine’s cart subtotal and an opt-in coupon; discovery is read only', async () => {
  await Coupon.create(offer()); await add(4);
  const below = await available();
  expect(below.body.data[0]).toMatchObject({ autoApply: true, applicable: false,
    threshold: { minimumOrderValue: 500, eligibleOrderValue: 340, remainingAmount: 160, progressPercentage: 68 } });
  expect((await request(app).get('/api/cart?channel=grocery').set('Authorization', token)).body.data.appliedCoupon).toBeNull();
  await request(app).put(`/api/cart/${(await Cart.findOne({ userId: user._id })).items[0]._id}`).set('Authorization', token).send({ qty: 6 }).expect(200);
  const reached = await available();
  expect(reached.body.data[0]).toMatchObject({ applicable: true,
    threshold: { eligibleOrderValue: 510, remainingAmount: 0, progressPercentage: 100 } });
  expect((await request(app).post('/api/coupons/validate').set('Authorization', token).send({ code: 'SAVE20', channel: 'grocery' })).body.data)
    .toMatchObject({ valid: true, discount: 102, savings: 102 });
  expect((await Coupon.findOne({ code: 'SAVE20' })).usedCount).toBe(0);
});

test('manual coupons stay manual and invalid or unrelated offers have no progress', async () => {
  await add(4);
  await Coupon.create([offer({ code: 'MANUAL', autoApply: undefined }), offer({ code: 'EXPIRED', expiresAt: new Date('2020-01-01') }),
    offer({ code: 'OTHER', products: [new mongoose.Types.ObjectId()] }), offer({ code: 'EXHAUSTED', totalUsageLimit: 1, usedCount: 1 })]);
  const results = (await available()).body.data;
  expect(results.find(c => c.code === 'MANUAL')).toMatchObject({ autoApply: false, threshold: { remainingAmount: 160 } });
  expect(results.find(c => c.code === 'EXPIRED')).toBeUndefined();
  expect(results.find(c => c.code === 'EXHAUSTED')).toMatchObject({ applicable: false, threshold: null });
  expect(results.find(c => c.code === 'OTHER').threshold).toBeNull();
});

test('free delivery is advertised only when configured and has an authoritative saving', async () => {
  await add(6);
  await Coupon.create(offer({ code: 'SHIP', discountType: 'free_shipping', value: 0 }));
  const found = (await available()).body.data.find(c => c.code === 'SHIP');
  expect(found).toMatchObject({ discountType: 'free_shipping', applicable: true, freeShipping: true });
  const quote = await request(app).post('/api/coupons/validate').set('Authorization', token).send({ code: 'SHIP', channel: 'grocery' }).expect(200);
  expect(quote.body.data.savings).toBeGreaterThan(0);
});

test('category scope is evaluated against the live cart category', async () => {
  await add(6);
  await Coupon.create(offer({ code: 'CATEGORY', categories: [product.category] }));
  const result = (await available()).body.data.find(c => c.code === 'CATEGORY');
  expect(result).toMatchObject({ applicable: true, autoApply: true });
  const quote = await request(app).post('/api/coupons/validate').set('Authorization', token)
    .send({ code: 'CATEGORY', channel: 'grocery' }).expect(200);
  expect(quote.body.data).toMatchObject({ valid: true, discount: 102 });
});
