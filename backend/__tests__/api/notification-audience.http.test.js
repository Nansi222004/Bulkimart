import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Notification from '../../models/Notification.js';
import { getMyNotifications, getUnreadCount, markAllNotificationsRead } from '../../controllers/notification.controller.js';
import { errorHandler } from '../../middlewares/error.middleware.js';

// One login can shop and sell. A parcel booked as a customer must not appear in the seller app, and the reverse.
const userId = new mongoose.Types.ObjectId();
let db, role;
const app = express();
app.use((req, _res, next) => { req.user = { _id: userId }; req.userType = 'user'; req.tokenRole = role; next(); });
app.get('/notifications', getMyNotifications);
app.get('/notifications/unread-count', getUnreadCount);
app.patch('/notifications/read-all', markAllNotificationsRead);
app.use(errorHandler);
const titles = async () => (await request(app).get('/notifications').expect(200)).body.data.map(n => n.title).sort();

beforeAll(async () => { db = await MongoMemoryServer.create({ binary: { version: '7.0.14' } }); await mongoose.connect(db.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  await Notification.deleteMany({});
  const row = (title, extra) => ({ userId, type: 'system', event: 'PARCEL_UPDATED', title, message: 'Fixture', ...extra });
  await Notification.insertMany([
    row('Customer parcel', { audience: 'user', route: '/parcel-delivery/track/1' }),
    row('Seller order', { audience: 'seller', route: '/seller/orders/1', event: 'ORDER_CREATED', type: 'order' }),
    row('Rider parcel', { audience: 'rider', route: '/delivery/parcels' }),
    row('Old customer parcel', { route: '/parcel-delivery/track/2' }),
    row('Old seller return', { route: '/seller/returns/1', event: 'RETURN_REQUESTED' }),
    row('Broadcast', { event: 'ADMIN_BROADCAST', type: 'broadcast' }),
  ]);
});

test('the seller app lists only seller notifications and shared broadcasts', async () => {
  role = 'seller';
  expect(await titles()).toEqual(['Broadcast', 'Old seller return', 'Seller order']);
  expect((await request(app).get('/notifications/unread-count').expect(200)).body.data.count).toBe(3);
});

test('the customer app lists only customer notifications and shared broadcasts', async () => {
  role = 'buyer';
  expect(await titles()).toEqual(['Broadcast', 'Customer parcel', 'Old customer parcel']);
});

test('mark all read in the seller app leaves the customer badge unread', async () => {
  role = 'seller'; await request(app).patch('/notifications/read-all').expect(200);
  role = 'buyer'; expect((await request(app).get('/notifications/unread-count').expect(200)).body.data.count).toBe(2);
});
