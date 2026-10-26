import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';

const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
let db, sellerId, otherSellerId, emptySellerId, customerId, riderUserId, partnerId, paymentId, deliveryId, deliveredId, pendingId, token;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  const adminId = id(); sellerId = id(); otherSellerId = id(); emptySellerId = id(); customerId = id(); riderUserId = id(); partnerId = id(); paymentId = id(); deliveryId = id(); deliveredId = id(); pendingId = id();
  await Admin.collection.insertOne({ _id: adminId, name: 'Fixture admin', email: 'orders@example.test', role: 'admin', isActive: true });
  token = `Bearer ${jwt.sign({ id: String(adminId), type: 'admin' }, JWT_SECRET)}`;
  await User.collection.insertMany([{ _id: customerId, name: 'Fixture Buyer', phone: '9876500001', roles: ['buyer'], isActive: true },
    { _id: riderUserId, name: 'Fixture Rider', phone: '9876500002', roles: ['delivery'], isActive: true }]);
  await Seller.collection.insertMany([
    { _id: sellerId, userId: customerId, businessName: 'Fixture Business', status: 'approved', totalOrders: 999, totalRevenue: 999999,
      storeDetails: { name: 'Fixture Store', address: 'Store Road', city: 'Indore', phone: '9876500003' } },
    { _id: otherSellerId, userId: id(), businessName: 'Other Store' }, { _id: emptySellerId, userId: id(), businessName: 'Empty Store', totalOrders: 888, totalRevenue: 888888 },
  ]);
  await DeliveryPartner.collection.insertOne({ _id: partnerId, userId: riderUserId, vehicleType: 'bike', vehicleNo: 'MP09AA1234' });
  await Payment.collection.insertOne({ _id: paymentId, userId: customerId, method: 'online', status: 'paid', amount: 440 });
  await Delivery.collection.insertOne({ _id: deliveryId, orderId: deliveredId, partnerId, status: 'delivered', otp: '1234', otpVerified: true, endTime: new Date() });
  const item = (seller, price, qty = 1) => ({ _id: id(), productId: id(), sellerId: seller, name: 'Fixture product', price, qty });
  const base = { userId: customerId, type: 'grocery', createdAt: new Date(), updatedAt: new Date(), paymentMethod: 'cod' };
  await Order.collection.insertMany([
    { ...base, _id: deliveredId, orderNo: 'ORD-QCOM-FIXTURE', status: 'delivered', paymentMethod: 'online', paymentId, deliveryId, deliveryPartnerId: partnerId,
      items: [item(sellerId, 100, 2), item(sellerId, 300)], pricing: { discountRepresentation: 'components-v1', subtotal: 500, couponDiscount: 100, deliveryCharge: 40, totalAmount: 440 },
      shippingAddress: { name: 'Fixture Recipient', phone: '9876500004', line1: 'Customer Road', city: 'Indore', pincode: '452001' } },
    { ...base, _id: id(), orderNo: 'ORD-MULTISTORE', status: 'delivered', items: [item(sellerId, 25), item(otherSellerId, 999)], pricing: { totalAmount: 1024 } },
    { ...base, _id: pendingId, orderNo: 'ORD-PENDING', status: 'placed', items: [item(sellerId, 100)], pricing: { totalAmount: 100 } },
    { ...base, _id: id(), orderNo: 'ORD-CANCELLED', status: 'cancelled', items: [item(sellerId, 50)], pricing: { totalAmount: 50 } },
    { ...base, _id: id(), orderNo: 'ORD-OTHER', status: 'delivered', items: [item(otherSellerId, 9999)], pricing: { totalAmount: 9999 } },
  ]);
});

test('seller cards count each order once and show only the seller’s delivered item revenue', async () => {
  const result = await request(app).get(`/api/admin/sellers/${sellerId}`).set('Authorization', token).expect(200);
  expect(result.body.data.metrics).toMatchObject({ totalOrders: 4, deliveredOrders: 2, totalRevenue: 525 });
  await Order.updateOne({ _id: pendingId }, { $set: { status: 'delivered' } });
  const updated = await request(app).get(`/api/admin/sellers/${sellerId}`).set('Authorization', token).expect(200);
  expect(updated.body.data.metrics).toMatchObject({ totalOrders: 4, deliveredOrders: 3, totalRevenue: 625 });
  expect((await Seller.findById(sellerId)).totalOrders).toBe(999);
});

test('a seller without orders has real zero cards despite old stored counters', async () => {
  const result = await request(app).get(`/api/admin/sellers/${emptySellerId}`).set('Authorization', token).expect(200);
  expect(result.body.data.metrics).toMatchObject({ totalOrders: 0, deliveredOrders: 0, totalRevenue: 0 });
});

test('Quick Commerce supplies the saved total, order number and complete store/payment/rider details without exposing the OTP', async () => {
  const result = await request(app).get('/api/admin/consumers/orders?type=grocery').set('Authorization', token).expect(200);
  const row = result.body.data.find(order => order._id === String(deliveredId));
  expect(row.orderNo).toBe('ORD-QCOM-FIXTURE'); expect(row.pricing.totalAmount).toBe(440);
  expect(row.items[0].sellerId.storeDetails.name).toBe('Fixture Store');
  expect(row.paymentId).toMatchObject({ status: 'paid', method: 'online' });
  expect(row.deliveryPartnerId.userId).toMatchObject({ name: 'Fixture Rider', phone: '9876500002' });
  expect(row.deliveryId).toMatchObject({ status: 'delivered', otpVerified: true });
  expect(row.deliveryId.otp).toBeUndefined();
  expect(row.shippingAddress.line1).toBe('Customer Road');
});

test('seller and order details require an authenticated admin', async () => {
  await request(app).get(`/api/admin/sellers/${sellerId}`).expect(401);
  await request(app).get('/api/admin/consumers/orders?type=grocery').expect(401);
});
