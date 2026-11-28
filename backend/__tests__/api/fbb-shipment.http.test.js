import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../../middlewares/requestContext.middleware.js';

/**
 * Seller "I've sent stock" notices (models/FbbShipment.js): information only, never stock. Linked to the receipt the
 * warehouse counts from it; cancelling that draft receipt puts the shipment back on its way. Same harness as fbb.http.test.js.
 */
const notifyAllAdmins = jest.fn(async () => []);
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins,
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));

const [sellerCtl, { default: adminRoutes }, { protect, requireRole }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET }, warehouseSvc, { saveChargeConfig },
  { default: User }, { default: Admin }, { default: Seller }, { default: Product }, { default: Warehouse }, { default: FbbShipment }, { default: WarehouseStock }] = await Promise.all([
  import('../../controllers/seller.controller.js'), import('../../routes/admin.routes.js'), import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'),
  import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'), import('../../services/warehouse.service.js'), import('../../services/fbbCharges.service.js'),
  import('../../models/User.js'), import('../../models/Admin.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Warehouse.js'),
  import('../../models/FbbShipment.js'), import('../../models/WarehouseStock.js'),
]);

const app = express(); app.use(requestContext); app.use(express.json());
app.use('/api/admin', adminRoutes);
const seller = express.Router(); seller.use(protect, requireRole('seller'), requireApprovedSeller);
seller.get('/fbb', sellerCtl.getSellerFbb);
seller.post('/fbb/shipments', sellerCtl.createSellerFbbShipment);
seller.post('/fbb/shipments/:id/cancel', sellerCtl.cancelSellerFbbShipment);
app.use('/seller', seller);
app.use(errorHandler);

let db, sellerUser, sellerDoc, otherUser, admin, warehouse;
const id = () => new mongoose.Types.ObjectId();
const asUser = (req, user) => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role: 'seller' }, JWT_SECRET)}`);
const asAdmin = (req) => req.set('Authorization', `Bearer ${jwt.sign({ id: String(admin._id), type: 'admin' }, JWT_SECRET)}`);
const FLAGS = ['DELIVERY_METHODS_ENABLED', 'FBB_ENABLED', 'WAREHOUSE_OPERATIONS_ENABLED', 'FBB_CHARGES_ENABLED'];

const makeProduct = async (sellerId, extra = {}) => {
  const product = { _id: id(), sellerId, type: 'ecommerce', category: id(), name: 'Juice', price: 50, stock: 0, isActive: true, status: 'approved', fulfillmentType: 'physical', gstRate: 0, images: [],
    deliveryMethod: 'fbb', variants: [{ _id: id(), name: 'Default', sku: `J-${randomUUID().slice(0, 6)}`, price: 50, mrp: 60, stock: 0, weight: 500, unit: 'piece' }], ...extra };
  await Product.collection.insertOne(product);
  return Product.findById(product._id).lean();
};
const send = (body, user = sellerUser) => asUser(request(app).post('/seller/fbb/shipments'), user).send({ idempotencyKey: randomUUID(), warehouseId: warehouse._id, ...body });
const line = (p, qty = 50) => ({ productId: p._id, variantId: p.variants[0]._id, qty });

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => { FLAGS.forEach((k) => delete process.env[k]); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  FLAGS.forEach((k) => { process.env[k] = 'true'; });
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  otherUser = await User.create({ name: 'Other Seller', phone: '9876500002', roles: ['buyer', 'seller'], isActive: true });
  const [s1, s2] = [id(), id()];
  await Seller.collection.insertMany([
    { _id: s1, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved', storeDetails: { name: 'Fixture Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh' }, fbbPilot: { enabled: true } },
    { _id: s2, userId: otherUser._id, businessName: 'Other Store', status: 'approved', storeDetails: { name: 'Other Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh' } },
  ]);
  sellerDoc = await Seller.findById(s1);
  const a1 = id();
  await Admin.collection.insertOne({ _id: a1, name: 'Ops', email: 'ops@example.test', password: 'x', role: 'admin', permissions: ['manage_warehouse', 'manage_finance'], isActive: true });
  admin = await Admin.findById(a1);
  warehouse = await Warehouse.create({ code: 'IDR-1', name: 'Bulkimart Indore', address: { line1: 'Unit 1', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.7, lng: 75.85 }, phone: '9876500099' });
  await saveChargeConfig({ input: { storage: { amount: 1 }, packaging: { amount: 5, basis: 'per_order' }, fulfillment: { amount: 5, basis: 'per_unit' }, reason: 'Fixture FBB rates' }, adminId: admin._id });
});

test('the seller tells Bulkimart stock is on the way: admins are alerted, both sides see "on the way", and stock does not change', async () => {
  const juice = await makeProduct(sellerDoc._id);
  const res = await send({ lines: [line(juice, 50)], courier: 'DTDC', trackingNo: 'D123', invoiceNo: 'INV-7' });
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({ status: 'in_transit', courier: 'DTDC', trackingNo: 'D123', lines: [expect.objectContaining({ productName: 'Juice', variantName: 'Default', qty: 50 })] });
  expect(res.body.data.shipmentNo).toMatch(/^SHP-\d{8}-[A-F0-9]{6}$/);
  expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ title: 'FBB stock on the way', route: '/admin/fbb?section=receiving', dedupeKey: `fbb-shipment:${res.body.data._id}` }));

  const view = await asUser(request(app).get('/seller/fbb'), sellerUser);
  expect(view.body.data.products).toEqual([expect.objectContaining({ name: 'Juice', stage: 'on_the_way', onTheWay: 50, forSale: 0, variantOptions: [{ _id: String(juice.variants[0]._id), name: 'Default' }] })]);
  expect(view.body.data.shipments).toHaveLength(1);
  expect(view.body.data.shipments[0].idempotencyKey).toBeUndefined();

  const adminProducts = await asAdmin(request(app).get('/api/admin/fbb/products'));
  expect(adminProducts.body.data[0]).toMatchObject({ name: 'Juice', onTheWay: 50 });
  expect((await asAdmin(request(app).get('/api/admin/fbb/shipments?status=in_transit'))).body.data).toHaveLength(1);
  expect((await asAdmin(request(app).get('/api/admin/fbb/overview'))).body.data.counts.shipmentsOnTheWay).toBe(1);
  // Information only: nothing is sellable until the warehouse counts and posts it.
  expect(await WarehouseStock.countDocuments()).toBe(0);
  expect((await Product.findById(juice._id).lean()).variants[0].stock).toBe(0);
});

test('a retried submit with the same key records one shipment and alerts once', async () => {
  const juice = await makeProduct(sellerDoc._id);
  const body = { idempotencyKey: 'retry-key-123', lines: [line(juice, 10)] };
  const [a, b] = [await send(body), await send(body)];
  expect([a.status, b.status]).toEqual([201, 200]);
  expect(b.body.data._id).toBe(a.body.data._id);
  expect(await FbbShipment.countDocuments()).toBe(1);
  expect(notifyAllAdmins).toHaveBeenCalledTimes(1);
});

test('refuses another seller\'s product, a non-FBB product, a bad quantity, a duplicate line, an inactive warehouse and a seller outside the pilot', async () => {
  const juice = await makeProduct(sellerDoc._id);
  const easyShip = await makeProduct(sellerDoc._id, { deliveryMethod: undefined, name: 'Plain' });
  const foreign = await makeProduct((await Seller.findOne({ businessName: 'Other Store' }))._id, { name: 'Foreign' });
  expect((await send({ lines: [line(foreign)] })).status).toBe(400);
  expect((await send({ lines: [line(easyShip)] })).status).toBe(409);
  expect((await send({ lines: [line(juice, 0)] })).status).toBe(400);
  expect((await send({ lines: [line(juice, 2.5)] })).status).toBe(400);
  expect((await send({ lines: [line(juice, 1), line(juice, 2)] })).status).toBe(400);
  const closed = await Warehouse.create({ code: 'OLD', name: 'Closed', isActive: false, phone: '9876500098', address: { line1: 'x', city: 'Indore', state: 'MP', pincode: '452001', lat: 22.7, lng: 75.85 } });
  expect((await send({ lines: [line(juice)], warehouseId: closed._id })).status).toBe(400);
  expect((await send({ lines: [line(juice)] }, otherUser)).status).toBe(403);
  expect(await FbbShipment.countDocuments()).toBe(0);
  expect(notifyAllAdmins).not.toHaveBeenCalled();
});

test('counting the delivery links the shipment; cancelling that draft puts it back on its way; only an uncounted shipment can be cancelled', async () => {
  const juice = await makeProduct(sellerDoc._id);
  const shipment = (await send({ lines: [line(juice, 50)] })).body.data;
  const receipt = await asAdmin(request(app).post('/api/admin/fbb/receipts')).send({ idempotencyKey: randomUUID(), warehouseId: warehouse._id, sellerId: sellerDoc._id, shipmentId: shipment._id,
    lines: [{ productId: juice._id, variantId: juice.variants[0]._id, expectedQty: 50, receivedQty: 50, acceptedQty: 50 }] });
  expect(receipt.status).toBe(200);
  expect(await FbbShipment.findById(shipment._id).lean()).toMatchObject({ status: 'received', receiptId: new mongoose.Types.ObjectId(receipt.body.data._id) });
  expect((await asUser(request(app).post(`/seller/fbb/shipments/${shipment._id}/cancel`), sellerUser)).status).toBe(409);

  expect((await asAdmin(request(app).post(`/api/admin/fbb/receipts/${receipt.body.data._id}/cancel`))).status).toBe(200);
  const back = await FbbShipment.findById(shipment._id).lean();
  expect(back.status).toBe('in_transit');
  expect(back.receiptId).toBeUndefined();

  // Another seller cannot cancel it; the owner can.
  expect((await asUser(request(app).post(`/seller/fbb/shipments/${shipment._id}/cancel`), otherUser)).status).toBe(409);
  const cancelled = await asUser(request(app).post(`/seller/fbb/shipments/${shipment._id}/cancel`), sellerUser);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.data.status).toBe('cancelled');
});

test('a receipt for a different seller never claims this seller\'s shipment', async () => {
  const juice = await makeProduct(sellerDoc._id);
  const shipment = (await send({ lines: [line(juice, 5)] })).body.data;
  const other = await Seller.findOneAndUpdate({ businessName: 'Other Store' }, { $set: { fbbPilot: { enabled: true } } }, { returnDocument: 'after' });
  const theirs = await makeProduct(other._id, { name: 'Theirs' });
  const { receipt } = await warehouseSvc.createReceipt({ warehouseId: warehouse._id, sellerId: other._id, idempotencyKey: `K-${id()}`, adminId: admin._id,
    lines: [{ productId: theirs._id, variantId: theirs.variants[0]._id, receivedQty: 5, acceptedQty: 5 }] });
  const { linkShipmentToReceipt } = await import('../../services/fbbShipment.service.js');
  expect(await linkShipmentToReceipt({ shipmentId: shipment._id, receipt })).toBeNull();
  expect((await FbbShipment.findById(shipment._id).lean()).status).toBe('in_transit');
});
