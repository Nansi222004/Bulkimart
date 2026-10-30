import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User.js';
import { saveFcmToken } from '../../controllers/notification.controller.js';
import { errorHandler } from '../../middlewares/error.middleware.js';

// Registering a customer/seller/rider device goes through this controller; it once crashed because User was never imported.
let db, userId;
const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.user = { _id: userId }; req.userType = 'user'; req.tokenRole = 'seller'; next(); });
app.post('/notifications/tokens', saveFcmToken);
app.use(errorHandler);
const tokens = async () => (await User.findById(userId).select('+pushTokens')).pushTokens.map(t => [t.token, t.active]);

beforeAll(async () => { db = await MongoMemoryServer.create({ binary: { version: '7.0.14' } }); await mongoose.connect(db.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => { await User.deleteMany({}); });

test('a seller device registers (200), and a new token on the same device replaces the old one', async () => {
  userId = new mongoose.Types.ObjectId();
  await User.create({ _id: userId, name: 'Seller', phone: '9000000003', roles: ['buyer', 'seller'], isActive: true });
  const send = token => request(app).post('/notifications/tokens').set('X-Device-Id', 'dev-1').send({ token, platform: 'web' }).expect(200);
  await send('tok-A'); await send('tok-A'); await send('tok-B');
  expect(await tokens()).toEqual([['tok-A', false], ['tok-B', true]]);
});
