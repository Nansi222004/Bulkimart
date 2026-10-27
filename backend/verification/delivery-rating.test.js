import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import orderRoutes from '../routes/order.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';

const app = express(); app.use(express.json()); app.use('/api/orders', orderRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
let db, userId, partnerId, orderId, deliveryId, token;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  userId = id(); partnerId = id(); orderId = id(); deliveryId = id();
  await User.collection.insertOne({ _id: userId, phone: '9876500001', name: 'Fixture buyer', roles: ['buyer'], isActive: true });
  token = `Bearer ${jwt.sign({ id: String(userId), type: 'user' }, JWT_SECRET)}`;
  await DeliveryPartner.collection.insertOne({ _id: partnerId, userId: id(), rating: 0 });
  await Delivery.collection.insertOne({ _id: deliveryId, orderId, partnerId, direction: 'forward', status: 'delivered' });
  await Order.collection.insertOne({ _id: orderId, orderNo: 'ORD-FIRST', userId, status: 'delivered', type: 'grocery', items: [], deliveryId, deliveryPartnerId: partnerId });
});
const rate = (rating = 4) => request(app).post(`/api/orders/${orderId}/delivery-rating`).set('Authorization', token).send({ rating });

test('the owner rates a completed delivery once and tracking restores the saved rating', async () => {
  const response = await rate().expect(200);
  expect(response.body.data.rating).toBe(4);
  expect((await Delivery.findById(deliveryId)).customerRating.rating).toBe(4);
  expect(await DeliveryPartner.findById(partnerId).lean()).toMatchObject({ rating: 4, ratingCount: 1, ratingTotal: 4 });
  const { getMyProfile } = await import('../controllers/deliveryPartner.controller.js');
  const partner = await DeliveryPartner.findById(partnerId);
  const profile = await new Promise((resolve, reject) => getMyProfile({ user: { _id: partner.userId, name: 'Fixture rider' } }, {
    status() { return this; }, json(body) { resolve(body); },
  }, reject));
  expect(profile.data).toMatchObject({ rating: 4, ratingCount: 1 });
  const tracking = await request(app).get(`/api/orders/${orderId}/track`).set('Authorization', token).expect(200);
  expect(tracking.body.data.deliveryRating).toMatchObject({ eligible: true, rating: 4 });
  await rate(1).expect(409);
  expect((await DeliveryPartner.findById(partnerId)).ratingCount).toBe(1);
});

test('authentication, ownership, completed delivery and integer star bounds are enforced', async () => {
  await request(app).post(`/api/orders/${orderId}/delivery-rating`).send({ rating: 4 }).expect(401);
  for (const value of [0, 6, 2.5, '4', null]) await rate(value).expect(400);
  await Order.updateOne({ _id: orderId }, { $set: { userId: id() } }); await rate().expect(403);
  await Order.updateOne({ _id: orderId }, { $set: { userId, status: 'out_for_delivery' } }); await rate().expect(400);
  await Order.updateOne({ _id: orderId }, { $set: { status: 'delivered' } });
  await Delivery.updateOne({ _id: deliveryId }, { $set: { status: 'in_transit' } }); await rate().expect(409);
  await Delivery.updateOne({ _id: deliveryId }, { $set: { status: 'delivered', direction: 'return_pickup' } }); await rate().expect(409);
  await Order.updateOne({ _id: orderId }, { $unset: { deliveryPartnerId: 1 } }); await rate().expect(400);
  expect((await Delivery.findById(deliveryId)).customerRating?.rating).toBeUndefined();
});

test('concurrent submissions count once and two customers contribute to the average', async () => {
  const results = await Promise.all([rate(5), rate(1)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const first = (await DeliveryPartner.findById(partnerId)).rating;
  const secondOrder = id(), secondDelivery = id();
  await Order.collection.insertOne({ _id: secondOrder, orderNo: 'ORD-SECOND', userId, status: 'delivered', deliveryId: secondDelivery, deliveryPartnerId: partnerId });
  await Delivery.collection.insertOne({ _id: secondDelivery, orderId: secondOrder, partnerId, status: 'delivered' });
  await request(app).post(`/api/orders/${secondOrder}/delivery-rating`).set('Authorization', token).send({ rating: 3 }).expect(200);
  expect(await DeliveryPartner.findById(partnerId).lean()).toMatchObject({ ratingCount: 2, ratingTotal: first + 3, rating: (first + 3) / 2 });
});

test('a missing partner rolls back the delivery rating so a customer can retry', async () => {
  await DeliveryPartner.deleteMany({}); await rate().expect(409);
  expect((await Delivery.findById(deliveryId)).customerRating?.rating).toBeUndefined();
});
