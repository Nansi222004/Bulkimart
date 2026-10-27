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

// Delivery Fleet operations screens: Live Dispatch, Active Deliveries,
// Tracking, Completed Deliveries (+ CSV) and Delivery Zones.
const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const IST_MS = 5.5 * 3600 * 1000;
const istDayStart = (now) => { const d = new Date(now + IST_MS); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MS); };
const minutesAgo = (n) => new Date(Date.now() - n * 60000);
let db, token, ids;

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  const adminId = id();
  ids = { asha: id(), ravi: id(), off: id(), ashaUser: id(), raviUser: id(), offUser: id(), buyer: id(), formula: id(),
    preOrder: id(), roadOrder: id(), transitOrder: id(), waitingPaid: id(), waitingUnpaid: id(), waitingCod: id(), paid: id(), unpaid: id(), preTrip: id() };
  await Admin.collection.insertOne({ _id: adminId, name: 'Ops admin', email: 'ops@example.test', role: 'admin', isActive: true });
  token = `Bearer ${jwt.sign({ id: String(adminId), type: 'admin' }, JWT_SECRET)}`;
  await User.collection.insertMany([
    { _id: ids.ashaUser, name: 'Asha Rider', phone: '9811100001', roles: ['delivery'], isActive: true },
    { _id: ids.raviUser, name: 'Ravi Rider', phone: '9811100002', roles: ['delivery'], isActive: true },
    { _id: ids.offUser, name: 'Offline Rider', phone: '9811100003', roles: ['delivery'], isActive: true },
    { _id: ids.buyer, name: 'Meera Buyer', phone: '9811100004', roles: ['buyer'], isActive: true },
    { _id: ids.formula, name: '=HYPERLINK("http://x")', phone: '9811100005', roles: ['buyer'], isActive: true },
  ]);
  await DeliveryPartner.collection.insertMany([
    { _id: ids.asha, userId: ids.ashaUser, status: 'approved', isAvailable: true, vehicleType: 'bike', zones: ['452001'], baseLocation: { pincode: '452001', city: 'Indore', state: 'Madhya Pradesh' } },
    { _id: ids.ravi, userId: ids.raviUser, status: 'approved', isAvailable: true, vehicleType: 'bike', zones: ['452001', '452015'] },
    { _id: ids.off, userId: ids.offUser, status: 'approved', isAvailable: false, vehicleType: 'scooter', zones: ['452015'] },
  ]);
  await Payment.collection.insertMany([
    { _id: ids.paid, userId: ids.buyer, method: 'online', status: 'paid', amount: 300 },
    { _id: ids.unpaid, userId: ids.buyer, method: 'online', status: 'pending', amount: 300 },
  ]);
  const order = (extra) => ({ userId: ids.buyer, type: 'grocery', deliveryType: 'internal', paymentMethod: 'cod', items: [], pricing: { totalAmount: 300 }, createdAt: minutesAgo(90), updatedAt: new Date(), ...extra });
  await Order.collection.insertMany([
    order({ _id: ids.preOrder, orderNo: 'ORD-PRE', status: 'dispatched', deliveryId: ids.preTrip, deliveryPartnerId: ids.asha }),
    order({ _id: ids.roadOrder, orderNo: 'ORD-ROAD', status: 'out_for_delivery', shippingAddress: { name: 'Road Recipient' } }),
    order({ _id: ids.transitOrder, orderNo: 'ORD-TRANSIT', status: 'out_for_delivery', userId: ids.formula }),
    order({ _id: ids.waitingPaid, orderNo: 'ORD-WAIT-PAID', status: 'dispatched', paymentMethod: 'online', paymentId: ids.paid }),
    order({ _id: ids.waitingUnpaid, orderNo: 'ORD-WAIT-UNPAID', status: 'dispatched', paymentMethod: 'online', paymentId: ids.unpaid }),
    order({ _id: ids.waitingCod, orderNo: 'ORD-WAIT-COD', status: 'dispatched', needsManualAssignment: true }),
    order({ _id: id(), orderNo: 'ORD-COURIER', status: 'dispatched', deliveryType: 'shiprocket' }),
  ]);
  const todayStart = istDayStart(Date.now());
  const trip = (extra) => ({ partnerId: ids.asha, direction: 'forward', otpVerified: false, createdAt: minutesAgo(60), updatedAt: new Date(), ...extra });
  await Delivery.collection.insertMany([
    trip({ _id: ids.preTrip, orderId: ids.preOrder, status: 'accepted', createdAt: minutesAgo(70), route: { distanceKm: 3, durationMin: 10 }, dropLocation: { address: 'Pre drop', lat: 22.7, lng: 75.8 } }),
    // Picked up 40 min ago on a 20 min estimate: past ETA.
    trip({ _id: id(), orderId: ids.roadOrder, partnerId: ids.ravi, status: 'picked_up', startTime: minutesAgo(40), route: { distanceKm: 6, durationMin: 20 },
      partnerLocation: { lat: 22.70, lng: 75.80, updatedAt: minutesAgo(3) }, dropLocation: { address: 'Road drop', lat: 22.72, lng: 75.82 } }),
    // No estimate recorded: never flagged either way.
    trip({ _id: id(), orderId: ids.transitOrder, partnerId: ids.ravi, status: 'in_transit', startTime: minutesAgo(5) }),
    trip({ _id: id(), orderId: id(), status: 'rejected' }),
    trip({ _id: id(), orderId: ids.roadOrder, status: 'delivered', startTime: minutesAgo(50), endTime: new Date(todayStart.getTime() + 60000), otpVerified: true }),
    trip({ _id: id(), orderId: ids.transitOrder, partnerId: ids.ravi, status: 'failed', endTime: new Date(todayStart.getTime() + 120000) }),
    // One minute before today's IST midnight: yesterday.
    trip({ _id: id(), orderId: ids.preOrder, status: 'delivered', startTime: new Date(todayStart.getTime() - 30 * 60000), endTime: new Date(todayStart.getTime() - 60000), otpVerified: true }),
  ]);
});

test('live dispatch summarises every live trip, riders on shift and today’s IST outcomes from real records', async () => {
  const { body } = await request(app).get('/api/admin/delivery-live').set('Authorization', token).expect(200);
  expect(body.data.summary).toMatchObject({
    activeTrips: 3, prePickup: 1, onTheRoad: 2, overEta: 1,
    // Paid online + COD wait; the unpaid one, the courier order and the order with a live trip do not.
    awaitingRider: 2, needsManualAssignment: 1,
    ridersOnline: 2, ridersBusy: 2, ridersFree: 0,
    deliveredToday: 1, failedToday: 1, todaySuccessRate: 50,
  });
  expect(body.data.summary.byStage).toMatchObject({ accepted: 1, picked_up: 1, in_transit: 1, assigned: 0 });
  const byRef = Object.fromEntries(body.data.trips.map((t) => [t.ref, t]));
  expect(byRef['ORD-PRE']).toMatchObject({ reassignable: true, pickedUp: false, overEta: null, rider: { name: 'Asha Rider' } });
  expect(byRef['ORD-ROAD']).toMatchObject({ customer: 'Road Recipient', overEta: true, etaMinutes: 20, reassignable: false, lastPingMinutes: 3 });
  expect(byRef['ORD-ROAD'].remainingKm).toBeGreaterThan(0);
  expect(byRef['ORD-TRANSIT']).toMatchObject({ overEta: null, etaMinutes: null });
  expect(body.data.trips[0].ref).toBe('ORD-PRE');
});

test('live dispatch filters without changing the summary and rejects bad parameters', async () => {
  const get = (query) => request(app).get(`/api/admin/delivery-live${query}`).set('Authorization', token);
  const late = (await get('?overEta=true').expect(200)).body.data;
  expect(late.trips.map((t) => t.ref)).toEqual(['ORD-ROAD']);
  expect(late.summary.activeTrips).toBe(3);
  expect((await get('?stage=accepted').expect(200)).body.data.trips.map((t) => t.ref)).toEqual(['ORD-PRE']);
  expect((await get('?search=asha').expect(200)).body.data.trips.map((t) => t.ref)).toEqual(['ORD-PRE']);
  expect((await get('?search=1100002').expect(200)).body.data.meta.total).toBe(2);
  // Regex syntax is searched as text: "(" finds the customer whose name contains one.
  expect((await get(`?search=${encodeURIComponent('(')}`).expect(200)).body.data.trips.map((t) => t.ref)).toEqual(['ORD-TRANSIT']);
  expect((await get(`?search=${encodeURIComponent('[*')}`).expect(200)).body.data.trips).toEqual([]);
  await get('?stage=delivered').expect(400);
  await get('?search=a&search=b').expect(400);
  await request(app).get('/api/admin/delivery-live').expect(401);
});

test('an empty fleet reports zeros, not invented numbers', async () => {
  for (const collection of Object.values(mongoose.connection.collections)) if (collection.collectionName !== 'admins') await collection.deleteMany({});
  const { body } = await request(app).get('/api/admin/delivery-live').set('Authorization', token).expect(200);
  expect(body.data.summary).toMatchObject({ activeTrips: 0, awaitingRider: 0, ridersOnline: 0, deliveredToday: 0, todaySuccessRate: null });
  expect(body.data.trips).toEqual([]);
});

test('completed deliveries search the whole history before paginating', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ _id: id(), partnerId: ids.asha, orderId: ids.preOrder, status: 'delivered', direction: 'forward', endTime: minutesAgo(i), createdAt: minutesAgo(100), updatedAt: new Date() }));
  await Delivery.collection.insertMany(many);
  const get = (query) => request(app).get(`/api/admin/delivery-history${query}`).set('Authorization', token);
  const page1 = (await get('?limit=20').expect(200)).body;
  expect(page1.meta.total).toBe(28);
  expect(page1.data).toHaveLength(20);
  // Ravi's only finished trip is found however far down the history it sits.
  const ravi = (await get('?search=ravi&limit=20').expect(200)).body;
  expect(ravi.meta.total).toBe(1);
  expect(ravi.data[0]).toMatchObject({ partner: 'Ravi Rider', status: 'failed' });
  expect((await get('?search=ORD-ROAD').expect(200)).body.meta.total).toBe(1);
  expect((await get('?status=failed').expect(200)).body.meta.total).toBe(1);
  expect((await get(`?search=${encodeURIComponent('[')}`).expect(200)).body.meta.total).toBe(0);
  await get('?status=rejected').expect(400);
});

test('completed deliveries export a real CSV with escaping and formula protection', async () => {
  const res = await request(app).get('/api/admin/delivery-history/export').set('Authorization', token).expect(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  expect(res.headers['content-disposition']).toMatch(/attachment; filename="bulkimart-delivery-history-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
  expect(lines[0]).toBe('"Order ref","Trip type","Delivery partner","Customer","Assigned (IST)","Picked up (IST)","Finished (IST)","Trip duration (min)","OTP verified","Status"');
  expect(lines).toHaveLength(4);
  // The customer's name starts with "=": written as text, never as a formula.
  expect(res.text).toContain('"\'=HYPERLINK(""http://x"")"');
  const filtered = await request(app).get('/api/admin/delivery-history/export?status=failed').set('Authorization', token).expect(200);
  expect(filtered.text.trim().split('\r\n')).toHaveLength(2);
  await request(app).get('/api/admin/delivery-history/export').expect(401);
});

test('delivery zones list uncovered approved stores as inactive and treat search as text', async () => {
  await Seller.collection.insertMany([
    { _id: id(), userId: id(), businessName: 'Covered', status: 'approved', storeDetails: { name: 'Covered Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh' } },
    { _id: id(), userId: id(), businessName: 'Gap', status: 'approved', storeDetails: { name: 'Gap Store', pincode: '452099', city: 'Indore', state: 'Madhya Pradesh' } },
    { _id: id(), userId: id(), businessName: 'Rejected', status: 'rejected', storeDetails: { name: 'Rejected Store', pincode: '452098', city: 'Indore', state: 'Madhya Pradesh' } },
  ]);
  const get = (query = '') => request(app).get(`/api/admin/delivery-zones${query}`).set('Authorization', token);
  const zones = Object.fromEntries((await get().expect(200)).body.data.zones.map((z) => [z.zoneCode, z]));
  expect(zones['452001']).toMatchObject({ riders: 2, activeRiders: 2, status: 'Active', stores: ['Covered Store'] });
  expect(zones['452015']).toMatchObject({ riders: 2, activeRiders: 1, status: 'Active' });
  expect(zones['452099']).toMatchObject({ riders: 0, activeRiders: 0, status: 'Inactive', stores: ['Gap Store'], radiusKm: null });
  expect(zones['452098']).toBeUndefined();
  expect((await get('?status=Inactive').expect(200)).body.data.zones.map((z) => z.zoneCode)).toEqual(['452099']);
  expect((await get(`?search=${encodeURIComponent('(')}`).expect(200)).body.data.zones).toEqual([]);
});
