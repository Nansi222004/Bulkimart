import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Cart from '../models/Cart.js';
import Category from '../models/Category.js';
import Coupon from '../models/Coupon.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import CouponRedemption from '../models/CouponRedemption.js';
import cartRoutes from '../routes/cart.routes.js';
import couponRoutes from '../routes/coupon.routes.js';
import orderRoutes from '../routes/order.routes.js';
import { createCoupon, updateCoupon, listCoupons } from '../controllers/coupon.controller.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

let db, app, user, product, token, adminToken;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  const uri = db.getUri('coupon_automation_test');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri)) throw new Error('Refusing non-local test database');
  await mongoose.connect(uri);
  app = express(); app.use(express.json());
  app.use('/api/cart', cartRoutes); app.use('/api/coupons', couponRoutes); app.use('/api/orders', orderRoutes);
  app.post('/api/admin/coupons', protect, requireAdmin, createCoupon);
  app.put('/api/admin/coupons/:id', protect, requireAdmin, updateCoupon);
  app.get('/api/admin/coupons', protect, requireAdmin, listCoupons);
  app.use(errorHandler);
  user = await User.create({ name: 'Coupon shopper', phone: '9100000099', roles: ['buyer'] });
  const sellerUser = await User.create({ name: 'Coupon store owner', phone: '9100000098', roles: ['buyer', 'seller'] });
  const sellerId = new mongoose.Types.ObjectId();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, status: 'approved', businessName: 'Coupon store', storeDetails: { name: 'Coupon store', lat: 19.1, lng: 72.9 } });
  const adminId = new mongoose.Types.ObjectId();
  await Admin.collection.insertOne({ _id: adminId, email: 'coupons@fixture.test', role: 'superAdmin', isActive: true });
  adminToken = `Bearer ${jwt.sign({ id: String(adminId), type: 'admin' }, JWT_SECRET)}`;
  const category = await Category.create({ name: 'Eligible category', slug: 'test-eligible-category', type: 'grocery' });
  product = await Product.create({ name: 'Eligible item', type: 'grocery', category: category._id, price: 85,
    mrp: 100, stock: 20, unit: 'piece', sellerId, isActive: true, status: 'approved' });
  await mongoose.models.CheckoutAttempt.createIndexes();
  token = `Bearer ${jwt.sign({ id: String(user._id), type: 'user' }, JWT_SECRET)}`;
}, 300_000);
afterEach(async () => {
  await Promise.all([Cart.deleteMany({}), Coupon.deleteMany({}), CouponRedemption.deleteMany({}), Order.deleteMany({}),
    Product.deleteMany({ _id: { $ne: product._id } }), Product.updateOne({ _id: product._id }, { $set: { stock: 20, 'variants.$[].stock': 20 } })]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

const offer = (extra = {}) => ({ code: 'SAVE20', title: 'Save on your order', discountType: 'percentage', value: 20,
  minOrderValue: 500, channel: 'grocery', isActive: true, isPublic: true, ...extra });
const add = qty => request(app).post('/api/cart').set('Authorization', token).send({ productId: product.id, qty }).expect(200);
const available = () => request(app).get('/api/coupons/available?channel=grocery').set('Authorization', token).expect(200);

test('ordinary SAVE20 moves from 340/500 progress to a confirmed 500/500 quote without a toggle', async () => {
  await Coupon.create(offer()); await add(4);
  const below = await available();
  expect(below.body.data[0]).toMatchObject({ applicable: false, discountType: 'percentage', value: 20,
    threshold: { minimumOrderValue: 500, eligibleOrderValue: 340, remainingAmount: 160, progressPercentage: 68 } });
  expect(below.body.data[0]).not.toHaveProperty('autoApply');
  expect((await request(app).get('/api/cart?channel=grocery').set('Authorization', token)).body.data.appliedCoupon).toBeNull();
  const extra = await Product.create({ name: 'Threshold item', type: 'grocery', category: product.category, sellerId: product.sellerId,
    price: 160, mrp: 160, stock: 20, unit: 'piece', isActive: true, status: 'approved' });
  await request(app).post('/api/cart').set('Authorization', token).send({ productId: extra.id, qty: 1 }).expect(200);
  const reached = await available();
  expect(reached.body.data[0]).toMatchObject({ applicable: true,
    threshold: { eligibleOrderValue: 500, remainingAmount: 0, progressPercentage: 100 } });
  expect((await request(app).post('/api/coupons/validate').set('Authorization', token).send({ code: 'SAVE20', channel: 'grocery' })).body.data)
    .toMatchObject({ valid: true, discount: 100, savings: 100 });
  const repriced = await request(app).get('/api/cart?channel=grocery&coupon=SAVE20').set('Authorization', token).expect(200);
  expect(repriced.body.data).toMatchObject({ appliedCoupon: { code: 'SAVE20' }, couponSavings: 100, pricing: { subtotal: 500, couponDiscount: 100 } });
  expect((await Coupon.findOne({ code: 'SAVE20' })).usedCount).toBe(0);
});

test('ordinary coupons participate while invalid or unrelated offers have no progress', async () => {
  await add(4);
  await Coupon.create([offer({ code: 'ORDINARY' }), offer({ code: 'EXPIRED', expiresAt: new Date('2020-01-01') }),
    offer({ code: 'OTHER', products: [new mongoose.Types.ObjectId()] }), offer({ code: 'EXHAUSTED', totalUsageLimit: 1, usedCount: 1 })]);
  const results = (await available()).body.data;
  expect(results.find(c => c.code === 'ORDINARY')).toMatchObject({ applicable: false, threshold: { remainingAmount: 160 } });
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
  expect(result).toMatchObject({ applicable: true });
  const quote = await request(app).post('/api/coupons/validate').set('Authorization', token)
    .send({ code: 'CATEGORY', channel: 'grocery' }).expect(200);
  expect(quote.body.data).toMatchObject({ valid: true, discount: 102 });
});

test.each([false, true])('persisted legacy autoApply=%s neither gates eligibility nor leaks into DTOs', async legacy => {
  const coupon = await Coupon.create(offer());
  await Coupon.collection.updateOne({ _id: coupon._id }, { $set: { autoApply: legacy } });
  await add(6);
  const result = (await available()).body.data.find(c => c.code === 'SAVE20');
  expect(result).toMatchObject({ applicable: true, savingNow: 102 });
  expect(result).not.toHaveProperty('autoApply');
  expect(Coupon.schema.path('autoApply')).toBeUndefined();
  const list = await request(app).get('/api/admin/coupons').set('Authorization', adminToken).expect(200);
  expect(list.body.data[0]).not.toHaveProperty('autoApply');
  const edited = await request(app).put(`/api/admin/coupons/${coupon.id}`).set('Authorization', adminToken).send({ title: 'Updated title', autoApply: !legacy }).expect(200);
  expect(edited.body.data).not.toHaveProperty('autoApply');
  expect((await Coupon.collection.findOne({ _id: coupon._id })).autoApply).toBe(legacy);
});

test('admin creates an eligible coupon without an automatic-application field', async () => {
  const res = await request(app).post('/api/admin/coupons').set('Authorization', adminToken).send(offer()).expect(201);
  expect(res.body.data).not.toHaveProperty('autoApply');
  await add(6);
  expect((await available()).body.data[0]).toMatchObject({ code: 'SAVE20', applicable: true, savingNow: 102 });
});

test.each([
  ['disabled', { isActive: false }], ['expired', { expiresAt: new Date('2020-01-01') }],
  ['future', { startsAt: new Date('2099-01-01') }], ['wrong channel', { channel: 'ecommerce' }],
])('%s coupons are absent from discovery', async (_name, fields) => {
  await Coupon.create(offer(fields)); await add(6);
  expect((await available()).body.data).toEqual([]);
});

test.each([
  ['usage-exhausted', { totalUsageLimit: 1, usedCount: 1 }],
  ['wrong product', { products: [new mongoose.Types.ObjectId()] }],
  ['wrong vendor', { sellers: [new mongoose.Types.ObjectId()] }],
  ['wrong category', { categories: [new mongoose.Types.ObjectId()] }],
])('%s coupons cannot apply or advertise progress below or above the minimum', async (_name, fields) => {
  await Coupon.create(offer(fields)); await add(4);
  expect((await available()).body.data[0]).toMatchObject({ applicable: false, threshold: null });
  await add(2);
  expect((await available()).body.data[0]).toMatchObject({ applicable: false, threshold: null });
});

test.each(['per-user limit', 'first-order restriction'])('%s is enforced before progress or application', async condition => {
  const coupon = await Coupon.create(offer({ firstOrderOnly: condition === 'first-order restriction' }));
  if (condition === 'per-user limit') await CouponRedemption.create({ couponId: coupon._id, code: coupon.code, userId: user._id, discountAmount: 1 });
  else await Order.collection.insertOne({ userId: user._id, status: 'delivered' });
  await add(4);
  expect((await available()).body.data[0]).toMatchObject({ applicable: false, threshold: null });
  await add(2);
  expect((await available()).body.data[0]).toMatchObject({ applicable: false, threshold: null });
});

test('unverified membership coupons expose no progress and are marked for exclusion from automatic selection', async () => {
  await Coupon.create(offer({ cdsMembersOnly: true })); await add(4);
  expect((await available()).body.data[0]).toMatchObject({ cdsMembersOnly: true, threshold: null });
  await add(2);
  expect((await available()).body.data[0]).toMatchObject({ cdsMembersOnly: true, threshold: null });
});

test('selection uses quoted savings, then minimum and code, including candidates beyond the old database limit', async () => {
  await add(6);
  await Coupon.create(Array.from({ length: 35 }, (_, n) => offer({ code: `SMALL${n}`, discountType: 'fixed', value: 1, minOrderValue: 0 })));
  await Coupon.create([offer({ code: 'BEST', discountType: 'fixed', value: 170 }),
    offer({ code: 'BTIE', discountType: 'fixed', value: 100, minOrderValue: 300 }),
    offer({ code: 'ATIE', discountType: 'fixed', value: 100, minOrderValue: 300 }),
    offer({ code: 'LATER', discountType: 'fixed', value: 100, minOrderValue: 400 })]);
  expect((await available()).body.data.slice(0, 4).map(c => c.code)).toEqual(['BEST', 'ATIE', 'BTIE', 'LATER']);
});

const checkout = code => request(app).post('/api/orders').set('Authorization', token)
  .set('Idempotency-Key', `coupon-${new mongoose.Types.ObjectId()}`).send({ channel: 'grocery', coupon: code, paymentMethod: 'cod',
    shippingAddress: { name: 'Coupon shopper', phone: '9100000099', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 } });

test.each([
  ['disabled', { isActive: false }], ['expired', { expiresAt: new Date('2020-01-01') }],
  ['exhausted', { totalUsageLimit: 1, usedCount: 1 }],
])('checkout revalidates a discovered coupon that becomes %s before order placement', async (_name, fields) => {
  const coupon = await Coupon.create(offer()); await add(6);
  expect((await available()).body.data[0].applicable).toBe(true);
  await Coupon.updateOne({ _id: coupon._id }, { $set: fields });
  const response = await checkout('SAVE20'); expect(response.status).toBe(400);
  expect(await Order.countDocuments({ userId: user._id })).toBe(0);
  expect(await CouponRedemption.countDocuments({ userId: user._id })).toBe(0);
});

test('checkout redeems the ordinary discovered coupon in the existing order transaction', async () => {
  const coupon = await Coupon.create(offer()); await add(6);
  expect((await available()).body.data[0]).toMatchObject({ applicable: true, savingNow: 102 });
  const response = await checkout('SAVE20'); expect({ status: response.status, error: response.status >= 400 ? response.body.message : undefined }).toEqual({ status: 201, error: undefined });
  expect(response.body.data.order.pricing).toMatchObject({ couponCode: 'SAVE20', couponDiscount: 102 });
  expect((await Coupon.findById(coupon._id)).usedCount).toBe(1);
  expect(await CouponRedemption.countDocuments({ couponId: coupon._id, userId: user._id })).toBe(1);
});

test('offer-list visibility is not an automatic eligibility gate, and manual codes still work', async () => {
  await Coupon.create(offer({ isPublic: false })); await add(6);
  expect((await available()).body.data[0]).toMatchObject({ code: 'SAVE20', isPublic: false, applicable: true });
  const response = await request(app).post('/api/coupons/validate').set('Authorization', token).send({ code: 'SAVE20', channel: 'grocery' }).expect(200);
  expect(response.body.data).toMatchObject({ valid: true, savings: 102 });
});
