import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

const users = new Map();
const sellersByUser = new Map();
const orders = new Map();
const User = { findById: jest.fn((id) => ({ select: async () => users.get(String(id)) || null })) };
const Seller = { findOne: jest.fn(({ userId }) => Promise.resolve(sellersByUser.get(String(userId)) || null)) };
const Order = {
  find: jest.fn((filter) => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [...orders.values()].filter((order) =>
      order.items.some((item) => String(item.sellerId) === String(filter['items.sellerId']))),
  })),
  countDocuments: jest.fn(async (filter) => [...orders.values()].filter((order) =>
    order.items.some((item) => String(item.sellerId) === String(filter['items.sellerId']))).length),
  findById: jest.fn(async (id) => orders.get(String(id)) || null),
};

jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: Seller }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/Product.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/Notification.js', () => ({ default: {} }));
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({ uploadToCloudinary: jest.fn() }));
jest.unstable_mockModule('../../services/sameDay.service.js', () => ({ parseSellerSameDay: jest.fn() }));
jest.unstable_mockModule('../../services/radiusSetting.service.js', () => ({ getRadiusSetting: jest.fn() }));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}),
  notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn() }));

const [{ getSellerOrders, updateOrderStatus }, { protect }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../controllers/seller.controller.js'),
  import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/vendor.middleware.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
]);

const app = express();
app.use(express.json());
app.get('/api/sellers/orders', protect, requireApprovedSeller, getSellerOrders);
app.patch('/api/sellers/orders/:id/status', protect, requireApprovedSeller, updateOrderStatus);
app.use(errorHandler);

let sellerUser;
let otherSellerUser;
let seller;
let otherSeller;
let ownOrder;
let token;
let otherToken;
const bearer = (value) => ({ Authorization: `Bearer ${value}` });

beforeEach(() => {
  users.clear(); sellersByUser.clear(); orders.clear();
  sellerUser = { _id: new mongoose.Types.ObjectId(), isActive: true, roles: ['buyer', 'seller'] };
  otherSellerUser = { _id: new mongoose.Types.ObjectId(), isActive: true, roles: ['buyer', 'seller'] };
  seller = { _id: new mongoose.Types.ObjectId(), userId: sellerUser._id, status: 'approved' };
  otherSeller = { _id: new mongoose.Types.ObjectId(), userId: otherSellerUser._id, status: 'approved' };
  users.set(String(sellerUser._id), sellerUser);
  users.set(String(otherSellerUser._id), otherSellerUser);
  sellersByUser.set(String(sellerUser._id), seller);
  sellersByUser.set(String(otherSellerUser._id), otherSeller);
  ownOrder = {
    _id: new mongoose.Types.ObjectId(), orderNo: 'SELLER-ORDER-1', type: 'grocery',
    status: 'placed', paymentMethod: 'cod', createdAt: new Date(),
    shippingAddress: { name: 'Buyer', city: 'Pune', pincode: '411001' },
    items: [
      { sellerId: seller._id, productId: new mongoose.Types.ObjectId(), name: 'Own item', price: 10.25, qty: 2 },
      { sellerId: otherSeller._id, productId: new mongoose.Types.ObjectId(), name: 'Other seller item', price: 90, qty: 1 },
    ],
    timeline: [],
    async save() { return this; },
  };
  orders.set(String(ownOrder._id), ownOrder);
  token = jwt.sign({ id: String(sellerUser._id), type: 'user', role: 'seller' }, JWT_SECRET);
  otherToken = jwt.sign({ id: String(otherSellerUser._id), type: 'user', role: 'seller' }, JWT_SECRET);
  jest.clearAllMocks();
});

test('seller order listing is scoped to their line items and omits competitors’ items', async () => {
  const response = await request(app).get('/api/sellers/orders').set(bearer(token)).expect(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0].items.map((item) => item.name)).toEqual(['Own item']);
  expect(response.body.data[0].subtotal).toBe(20.5);
  expect(Order.find).toHaveBeenCalledWith({ 'items.sellerId': seller._id });
});

test('seller cannot update another seller’s order and unsupported transitions are rejected', async () => {
  const unrelated = {
    ...ownOrder,
    _id: new mongoose.Types.ObjectId(),
    items: [{ sellerId: otherSeller._id, name: 'Private item', price: 1, qty: 1 }],
  };
  orders.set(String(unrelated._id), unrelated);
  await request(app).patch(`/api/sellers/orders/${unrelated._id}/status`).set(bearer(token))
    .send({ status: 'confirmed' }).expect(403);
  ownOrder.items = ownOrder.items.slice(0, 1);
  await request(app).patch(`/api/sellers/orders/${ownOrder._id}/status`).set(bearer(token))
    .send({ status: 'delivered' }).expect(400);
  expect(ownOrder.status).toBe('placed');
});

test('seller can make an allowed transition, while an unapproved seller cannot enter the panel', async () => {
  ownOrder.items = ownOrder.items.slice(0, 1);
  await request(app).patch(`/api/sellers/orders/${ownOrder._id}/status`).set(bearer(token))
    .send({ status: 'confirmed' }).expect(200);
  expect(ownOrder.status).toBe('confirmed');
  expect(ownOrder.timeline).toHaveLength(1);

  otherSeller.status = 'pending';
  await request(app).get('/api/sellers/orders').set(bearer(otherToken)).expect(403);
});

test('multi-store order cannot be globally accepted by a single seller', async () => {
  await request(app).patch(`/api/sellers/orders/${ownOrder._id}/status`).set(bearer(token)).send({ status: 'confirmed' }).expect(409);
  expect(ownOrder.status).toBe('placed');
  const response = await request(app).get('/api/sellers/orders').set(bearer(token)).expect(200);
  expect(response.body.data[0].permittedActions).toEqual([]);
  expect(response.body.data[0].pricing).toBeUndefined();
});
