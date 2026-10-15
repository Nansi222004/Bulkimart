import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const remote = new Map();
const list = jest.fn(async () => [...remote.values()]);
const add = jest.fn(async payload => { remote.set(payload.pickup_location, { ...payload, id: `fixture-${payload.pickup_location}`, status: 2, phone_verified: 1 }); });
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true }), listPickupLocations: list, addPickupLocation: add,
  verifyPickupLocation: async () => null, checkServiceability: async () => ({ available: false, couriers: [] }), createShiprocketOrder: jest.fn(), assignCourier: jest.fn(), generateLabel: jest.fn(), schedulePickup: jest.fn(),
}));
const [{ default: routes }, { default: Seller }, { default: User }, sync, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../routes/seller.routes.js'), import('../../models/Seller.js'), import('../../models/User.js'), import('../../services/sellerPickupSync.service.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'),
]);
let database, user, seller, token;
const app = express(); app.use(express.json()); app.use('/api/sellers', routes); app.use(errorHandler);
const call = (method, path) => request(app)[method]('/api/sellers' + path).set('Authorization', `Bearer ${token}`);
const store = { name: 'Fixture Store', address: 'Fixture pickup street 123', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', phone: '9876500001', email: 'pickup@example.invalid', lat: 19.1, lng: 72.9 };
const step = changes => call('put', '/step/1').send({ businessName: 'Fixture Store', businessType: 'proprietorship', storeDetails: { ...store, ...changes } });
const due = async () => Seller.updateOne({ _id: seller._id }, { $set: { 'pickupSync.nextAttemptAt': new Date(0) } });
beforeAll(async () => { database = await MongoMemoryServer.create({ binary: { version: '7.0.14' } }); await mongoose.connect(database.getUri('isolated_pickup_sync')); });
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  remote.clear(); jest.clearAllMocks();
  user = await User.create({ name: 'Fixture seller', phone: store.phone, roles: ['buyer', 'seller'], isActive: true });
  seller = await Seller.create({ userId: user._id, status: 'incomplete', onboardingStep: 1, storeDetails: store });
  token = jwt.sign({ id: user._id, type: 'user', role: 'seller' }, JWT_SECRET);
});
test('valid onboarding saves a durable job, synchronizes verified provider reference, and never grants shipping approval', async () => {
  await step().expect(200); let saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.status).toBe('pending'); expect(add).not.toHaveBeenCalled();
  await sync.syncSellerPickup(seller._id); saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.status).toBe('registered'); expect(saved.pickupSync.providerId).toMatch(/^fixture-/);
  expect(saved.thirdPartyFulfillment.enabled).toBe(false); expect(add).toHaveBeenCalledTimes(1);
  expect(add.mock.calls[0][0]).toMatchObject({ address: store.address, phone: store.phone, email: store.email, country: 'India', pin_code: store.pincode });
  expect(add.mock.calls[0][0].pickup_location.length).toBeLessThanOrEqual(36);
  await call('post', '/pickup-sync/retry').send({}).expect(200);
  await sync.syncSellerPickup(seller._id); expect(add).toHaveBeenCalledTimes(1);
});
test('incomplete provider address does not fail seller registration or create a location', async () => {
  await step({ address: 'short' }).expect(200); await sync.syncSellerPickup(seller._id);
  expect((await Seller.findById(seller._id)).pickupSync.status).toBe('needs_attention'); expect(add).not.toHaveBeenCalled();
});
test('transient listing failure is recorded safely and retry succeeds', async () => {
  await step().expect(200); list.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR'));
  await sync.syncSellerPickup(seller._id); let saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.status).toBe('pending'); expect(saved.pickupSync.lastError).not.toContain('PRIVATE_PROVIDER_ERROR');
  await due(); await sync.syncSellerPickup(seller._id); expect((await Seller.findById(seller._id)).pickupSync.status).toBe('registered');
});
test('concurrent workers and repeated registration events create one location', async () => {
  await step().expect(200); await Promise.all([sync.syncSellerPickup(seller._id), sync.syncSellerPickup(seller._id)]);
  await step().expect(200); await sync.syncSellerPickup(seller._id);
  expect(add).toHaveBeenCalledTimes(1); expect((await Seller.findById(seller._id)).pickupSync.status).toBe('registered');
});
test('lost create acknowledgement reconciles an existing provider location without another POST', async () => {
  await step().expect(200);
  add.mockImplementationOnce(async payload => { remote.set(payload.pickup_location, { ...payload, id: 'remote-accepted', status: 2, phone_verified: 1 }); throw new Error('Fixture timeout'); });
  await sync.syncSellerPickup(seller._id); expect((await Seller.findById(seller._id)).pickupSync.status).toBe('pending');
  await due(); await sync.syncSellerPickup(seller._id);
  expect((await Seller.findById(seller._id)).pickupSync.providerId).toBe('remote-accepted'); expect(add).toHaveBeenCalledTimes(1);
});
test('ambiguous absent result never repeats creation; retries stop and remain manually reconcilable', async () => {
  await step().expect(200); add.mockRejectedValueOnce(new Error('Fixture timeout'));
  for (let i = 0; i < 6; i++) { await due(); await sync.syncSellerPickup(seller._id); }
  const saved = await Seller.findById(seller._id); expect(saved.pickupSync.status).toBe('failed'); expect(saved.pickupSync.attempts).toBe(5); expect(add).toHaveBeenCalledTimes(1);
});
test('meaningful address change invalidates readiness, creates a new name and preserves the old reference', async () => {
  await step().expect(200); await sync.syncSellerPickup(seller._id); const first = await Seller.findById(seller._id);
  await step({ address: 'Different fixture street 456' }).expect(200); let saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.status).toBe('pending'); expect(sync.pickupReadyForShipping(saved, user)).toBe(false);
  expect(saved.pickupSync.history.some(entry => entry.locationName === first.pickupSync.locationName)).toBe(true);
  await sync.syncSellerPickup(seller._id); saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.locationName).not.toBe(first.pickupSync.locationName); expect(remote.has(first.pickupSync.locationName)).toBe(true);
});
test('existing seller with an owned matching admin pickup reuses it without creating another', async () => {
  const payload = sync.pickupDefinition(seller, user).payload;
  remote.set('legacy-owned', { ...payload, pickup_location: 'legacy-owned', id: 'legacy-id', status: 2, phone_verified: 1 });
  await Seller.updateOne({ _id: seller._id }, { $set: { 'thirdPartyFulfillment.shiprocketPickupLocation': 'legacy-owned', 'thirdPartyFulfillment.enabled': true } });
  await sync.queueSellerPickupSync(seller._id); await sync.syncSellerPickup(seller._id);
  expect((await Seller.findById(seller._id)).pickupSync.locationName).toBe('legacy-owned'); expect(add).not.toHaveBeenCalled();
});
test('provider mismatch and unverified locations never become registered', async () => {
  await step().expect(200); const saved = await Seller.findById(seller._id); const definition = sync.pickupDefinition(saved, user);
  remote.set(definition.locationName, { ...definition.payload, id: 'unverified', status: 1, phone_verified: 0 });
  await sync.syncSellerPickup(seller._id); expect((await Seller.findById(seller._id)).pickupSync.status).toBe('needs_attention'); expect(add).not.toHaveBeenCalled();
});
test('retry is owner-scoped, rejects browser identity/address overrides and leaves another seller untouched', async () => {
  await request(app).post('/api/sellers/pickup-sync/retry').send({}).expect(401);
  await call('post', '/pickup-sync/retry').send({ sellerId: new mongoose.Types.ObjectId(), address: 'Untrusted' }).expect(400);
  const other = await Seller.create({ userId: new mongoose.Types.ObjectId(), status: 'approved' });
  await call('post', '/pickup-sync/retry').send({}).expect(200);
  expect((await Seller.findById(other._id)).pickupSync.status).toBeUndefined();
  await call('get', '/pickup-sync').expect(200);
});

test('expired worker leases recover and stale in-flight work cannot register a changed store address', async () => {
  await step().expect(200);
  let release;
  list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = sync.syncSellerPickup(seller._id);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await step({ address: 'Updated fixture street 789' }).expect(200);
  release([]); await old;
  let saved = await Seller.findById(seller._id); expect(saved.pickupSync.status).toBe('pending'); expect(add).not.toHaveBeenCalled();
  await Seller.updateOne({ _id: seller._id }, { $set: { 'pickupSync.status': 'syncing', 'pickupSync.leaseUntil': new Date(0) } });
  await sync.syncSellerPickup(seller._id); saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.status).toBe('registered'); expect(add.mock.calls[0][0].address).toBe('Updated fixture street 789');
});

test('maintenance dry-run reports only scoped IDs/status and does not change seller records', async () => {
  const before = JSON.stringify(await Seller.findById(seller._id).lean());
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/syncSellerPickups.mjs', '--database=isolated_pickup_sync', '--limit=1'], {
    cwd: process.cwd(), env: { ...process.env, MONGO_URI: database.getUri('isolated_pickup_sync'), NODE_ENV: 'test' }, windowsHide: true, timeout: 20000,
  });
  expect(stdout).toContain('dry-run'); expect(stdout).not.toContain(store.phone); expect(stdout).not.toContain(store.address); expect(stdout).not.toContain(store.email);
  expect(JSON.stringify(await Seller.findById(seller._id).lean())).toBe(before);
});

test('returning to an older address preserves unknown creation intent instead of issuing a second POST', async () => {
  await step().expect(200); add.mockRejectedValueOnce(new Error('Fixture uncertain outcome'));
  await sync.syncSellerPickup(seller._id);
  const original = await Seller.findById(seller._id);
  await step({ address: 'Temporary fixture pickup 456' }).expect(200); await sync.syncSellerPickup(seller._id);
  await step().expect(200); await sync.syncSellerPickup(seller._id);
  const saved = await Seller.findById(seller._id);
  expect(saved.pickupSync.locationName).toBe(original.pickupSync.locationName);
  expect(saved.pickupSync.createStartedAt).toEqual(original.pickupSync.createStartedAt);
  expect(saved.pickupSync.status).toBe('pending'); expect(add).toHaveBeenCalledTimes(2);
});
