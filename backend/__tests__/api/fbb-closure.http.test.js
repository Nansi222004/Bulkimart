import { jest } from '@jest/globals';
process.env.SHIPROCKET_MODE = 'mock';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../../middlewares/requestContext.middleware.js';

/**
 * Closure regression tests (2026-11-26): FBB courier serviceability at checkout, the seller-level FBB pilot, and
 * financial safety when FBB / charge / pilot switches go off after orders exist. Same harness as fbb.http.test.js.
 */
const checkServiceability = jest.fn(); const createShiprocketOrder = jest.fn(); const assignCourier = jest.fn(); const verifyPickupLocation = jest.fn();
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true, quickCommerce: false }),
  listPickupLocations: jest.fn(async () => []), addPickupLocation: jest.fn(async () => ({})),
  verifyPickupLocation, checkServiceability, createShiprocketOrder, assignCourier, generateLabel: jest.fn(async () => ({})), schedulePickup: jest.fn(async () => ({ pickup_status: 1 })),
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));
const broadcast = jest.fn(async () => {});
jest.unstable_mockModule('../../controllers/deliveryPartner.controller.js', () => ({ broadcastNewOrderToRiders: broadcast }));

const [{ default: orderRoutes }, { default: cartRoutes }, sellerCtl, fulfillment, productCtl, { default: adminRoutes }, { protect, requireRole }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET },
  { saveCommissionVersion }, warehouseSvc, { saveChargeConfig },
  { default: User }, { default: Admin }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }, { default: Payment }, { default: Warehouse }, { default: WarehouseStock }] = await Promise.all([
  import('../../routes/order.routes.js'), import('../../routes/cart.routes.js'), import('../../controllers/seller.controller.js'), import('../../controllers/fulfillment.controller.js'),
  import('../../controllers/product.controller.js'), import('../../routes/admin.routes.js'), import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'),
  import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'), import('../../services/vendorCommission.service.js'), import('../../services/warehouse.service.js'),
  import('../../services/fbbCharges.service.js'),
  import('../../models/User.js'), import('../../models/Admin.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Cart.js'), import('../../models/Order.js'),
  import('../../models/Payment.js'), import('../../models/Warehouse.js'), import('../../models/WarehouseStock.js'),
]);
// Phase 4 audit additions: hand-off races, RTO quarantine and inspection, customer field hiding, rider return list.
const [{ default: Return }, { default: StockMovement }, { default: FbbCharge }, { recordFbbHandoff }, { resolveShipmentException }, { listReturnPickups }, { publicProduct }] = await Promise.all([
  import('../../models/Return.js'), import('../../models/StockMovement.js'), import('../../models/FbbCharge.js'), import('../../services/fbbFulfillment.service.js'),
  import('../../services/courierTracking.service.js'), import('../../controllers/returnDelivery.controller.js'), import('../../utils/publicProduct.js'),
]);
let riderPartner = null;
const app = express(); app.use(requestContext); app.use(express.json());
app.get('/rider/return-pickups', (req, _res, next) => { req.partner = riderPartner; next(); }, listReturnPickups);
app.use('/orders', orderRoutes); app.use('/cart', cartRoutes); app.use('/api/admin', adminRoutes);
const seller = express.Router(); seller.use(protect, requireRole('seller'), requireApprovedSeller);
seller.patch('/orders/:id/status', sellerCtl.updateOrderStatus);
seller.get('/orders/:id', sellerCtl.getSellerOrders);
seller.get('/orders/:id/options', fulfillment.getFulfillmentOptions);
seller.post('/orders/:id/shiprocket', fulfillment.createShiprocketShipment);
seller.get('/fbb', sellerCtl.getSellerFbb);
app.use('/seller', seller);
app.patch('/products/:id/stock', protect, requireRole('seller'), productCtl.adjustProductStock);
app.post('/products/:id/fbb-conversion', protect, requireRole('seller'), productCtl.convertToFbb);
app.use(errorHandler);

let db, buyer, sellerUser, sellerDoc, admin, plainAdmin, warehouse;
const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 };
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role }, JWT_SECRET)}`);
const asSeller = (req) => auth(req, sellerUser, 'seller');
const asAdmin = (req, who = admin) => req.set('Authorization', `Bearer ${jwt.sign({ id: String(who._id), type: 'admin' }, JWT_SECRET)}`);
const FLAGS = ['DELIVERY_METHODS_ENABLED', 'FBB_ENABLED', 'WAREHOUSE_OPERATIONS_ENABLED', 'FBB_CHARGES_ENABLED'];
const flagsOn = () => FLAGS.forEach((k) => { process.env[k] = 'true'; });

const makeProduct = async (extra = {}) => {
  const product = { _id: id(), sellerId: sellerDoc._id, type: 'ecommerce', category: id(), name: 'Lamp', price: 100, stock: 5, isActive: true, status: 'approved', fulfillmentType: 'physical', gstRate: 0, images: [],
    variants: [{ _id: id(), name: 'One', sku: `L-${randomUUID().slice(0, 6)}`, price: 100, mrp: 100, stock: 5, weight: 500, unit: 'piece' }], ...extra };
  await Product.collection.insertOne(product);
  return Product.findById(product._id).lean();
};
/** An FBB product with `qty` verified units in the warehouse. */
const fbbProduct = async (qty = 5) => {
  const product = await makeProduct();
  await warehouseSvc.convertProductToFbb({ productId: product._id, seller: sellerDoc, userId: sellerUser._id, acceptedChargeVersion: 1 });
  const { receipt } = await warehouseSvc.createReceipt({ warehouseId: warehouse._id, sellerId: sellerDoc._id, idempotencyKey: `K-${id()}`, adminId: admin._id, lines: [{ productId: product._id, variantId: product.variants[0]._id, acceptedQty: qty }] });
  await warehouseSvc.postReceipt({ receiptId: receipt._id, adminId: admin._id });
  return Product.findById(product._id).lean();
};
const fill = (...lines) => Cart.findOneAndUpdate({ userId: buyer._id, channel: 'ecommerce' }, { $set: { items: lines.map(([p, qty = 1]) => ({ productId: p._id, variantId: p.variants[0]._id, sellerId: sellerDoc._id, name: p.name, price: 100, qty })) } }, { upsert: true });
const checkout = (path, extra = {}) => auth(request(app).post(path)).set('Idempotency-Key', randomUUID()).send({ shippingAddress: address, paymentMethod: 'online', channel: 'ecommerce', ...extra });

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { FLAGS.forEach((k) => delete process.env[k]); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  flagsOn();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  verifyPickupLocation.mockImplementation(async (location, store) => ({ pickup_location: location, pin_code: store.pincode }));
  checkServiceability.mockResolvedValue({ available: true, couriers: [{ courier_company_id: 3, courier_name: 'Fixture Courier', rate: 70, freight_charge: 60 }] });
  createShiprocketOrder.mockResolvedValue({ order_id: 'SR-9', shipment_id: 'SH-9' });
  assignCourier.mockResolvedValue({ awb: 'AWB-9', courier_name: 'Fixture Courier' });
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], isActive: true });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved', serviceRadiusKm: 5,
    storeDetails: { name: 'Fixture Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7, lng: 75.85 },
    thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'seller-pickup' }, selfDelivery: { states: ['Maharashtra'] }, fbbPilot: { enabled: true } }); // the FBB pilot seller
  sellerDoc = await Seller.findById(sellerId);
  const [a1, a2] = [id(), id()];
  await Admin.collection.insertMany([
    { _id: a1, name: 'Ops', email: 'ops@example.test', password: 'x', role: 'admin', permissions: ['manage_warehouse', 'manage_finance'], isActive: true },
    { _id: a2, name: 'Catalogue', email: 'cat@example.test', password: 'x', role: 'admin', permissions: ['manage_products'], isActive: true },
  ]);
  [admin, plainAdmin] = [await Admin.findById(a1), await Admin.findById(a2)];
  warehouse = await Warehouse.create({ code: 'MUM-1', name: 'Bulkimart Mumbai', address: { line1: 'Unit 4', city: 'Mumbai', state: 'Maharashtra', pincode: '400070', lat: 19.07, lng: 72.88 }, phone: '9876500099', shiprocketPickupLocation: 'BKM-MUM' });
  await saveCommissionVersion({ vendorType: 'general', channel: 'ecommerce', method: 'percentage', value: 10, minimum: null, maximum: null, base: 'eligible_item_subtotal',
    fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' }, admin._id);
  await saveChargeConfig({ input: { storage: { amount: 1 }, packaging: { amount: 4, basis: 'per_order' }, fulfillment: { amount: 2, basis: 'per_unit' }, reason: 'Fixture FBB rates' }, adminId: admin._id });
});

/* ---- closure fixtures ------------------------------------------------------------------------------------------- */
const EXTRA_FLAGS = ['FBB_SERVICEABILITY_STRICT', 'SHIPROCKET_COD_ENABLED', 'FBB_ALL_SELLERS_ENABLED'];
let otherUser, otherSeller;
beforeEach(async () => {
  EXTRA_FLAGS.forEach((k) => delete process.env[k]);
  otherUser = await User.create({ name: 'Other Seller', phone: '9876500002', roles: ['buyer', 'seller'], isActive: true });
  const otherId = id();
  await Seller.collection.insertOne({ _id: otherId, userId: otherUser._id, businessName: 'Other Store', status: 'approved',
    storeDetails: { name: 'Other Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7, lng: 75.85 } });
  otherSeller = await Seller.findById(otherId);
});
afterAll(() => EXTRA_FLAGS.forEach((k) => delete process.env[k]));

const noCourier = () => checkServiceability.mockResolvedValue({ available: false, couriers: [] });
const anyCourier = () => checkServiceability.mockResolvedValue({ available: true, couriers: [{ courier_company_id: 3, courier_name: 'Fixture Courier', rate: 70, freight_charge: 60 }] });
const stockAt = (product, wh = warehouse) => WarehouseStock.findOne({ productId: product._id, warehouseId: wh._id }).lean();
const paid = async (orderId) => Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
const asOther = (req) => auth(req, otherUser, 'seller');
const pilot = (seller, enabled, note = 'Closure test change') => asAdmin(request(app).put(`/api/admin/fbb/pilot-sellers/${seller._id}`)).send({ enabled, note });
const insertSeller = async (fields) => { const sellerId = id(); await Seller.collection.insertOne({ _id: sellerId, userId: id(), status: 'approved', ...fields }); return Seller.findById(sellerId); };

/* ---- 2. courier serviceability before checkout ------------------------------------------------------------------- */

test('FBB checkout asks Shiprocket about the warehouse → customer route and refuses one no courier serves, writing nothing', async () => {
  const product = await fbbProduct(5);
  noCourier();
  for (const path of ['/orders/unified', '/orders']) {
    await fill([product, 2]);
    const res = await checkout(path).expect(409);
    expect(res.body.message).toMatch(/cannot be delivered to 400001/);
    expect(res.body.meta.code).toBe('FBB_NOT_SERVICEABLE');
  }
  // Warehouse pincode (not the shop's), the customer's pincode, 2 × 500 g, prepaid.
  expect(checkServiceability).toHaveBeenCalledWith({ pickupPostcode: '400070', deliveryPostcode: '400001', weight: 1, cod: false });
  expect(await Order.countDocuments({})).toBe(0);
  expect(await Payment.countDocuments({})).toBe(0);
  expect(await stockAt(product)).toMatchObject({ sellable: 5, reserved: 0 });
});

test('a provider failure lets the FBB order through by default (as before this check); strict mode refuses it', async () => {
  const product = await fbbProduct(5);
  checkServiceability.mockRejectedValue(new Error('provider timeout'));
  await fill([product]);
  await checkout('/orders/unified').expect(201);
  process.env.FBB_SERVICEABILITY_STRICT = 'true';
  for (const path of ['/orders/unified', '/orders']) {
    await fill([product]);
    const res = await checkout(path).expect(409);
    expect(res.body.meta.code).toBe('FBB_SERVICEABILITY_UNVERIFIED');
  }
  checkServiceability.mockResolvedValue({ available: true }); // an answer without couriers is not "serviceable"
  await fill([product]);
  await checkout('/orders').expect(409);
  anyCourier();
  await fill([product]);
  await checkout('/orders').expect(201);
  expect(await stockAt(product)).toMatchObject({ sellable: 3, reserved: 2 });
});

test('COD FBB: while Shiprocket COD is off only a rider can deliver, so Shiprocket is not asked; with it on, a COD "no" refuses', async () => {
  const product = await fbbProduct(5);
  noCourier();
  await fill([product]);
  await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201);
  expect(checkServiceability).not.toHaveBeenCalled();
  process.env.SHIPROCKET_COD_ENABLED = 'true';
  await fill([product]);
  await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
  expect(checkServiceability).toHaveBeenCalledWith(expect.objectContaining({ pickupPostcode: '400070', cod: true }));
});

test('a warehouse with no Shiprocket pickup registered is not asked about (rider only); strict mode refuses it', async () => {
  const product = await fbbProduct(5);
  await Warehouse.updateOne({ _id: warehouse._id }, { $unset: { shiprocketPickupLocation: 1 } });
  noCourier();
  await fill([product]);
  await checkout('/orders/unified').expect(201);
  expect(checkServiceability).not.toHaveBeenCalled();
  process.env.FBB_SERVICEABILITY_STRICT = 'true';
  await fill([product]);
  await checkout('/orders/unified').expect(409);
});

test('Easy Ship checkout is unchanged: no serviceability call even when Shiprocket would say no', async () => {
  noCourier();
  await Seller.updateOne({ _id: sellerDoc._id }, { $unset: { serviceRadiusKm: 1 } });
  const easy = await makeProduct({ name: 'Easy' });
  await fill([easy]);
  await checkout('/orders/unified').expect(201);
  await fill([easy]);
  await checkout('/orders').expect(201);
  expect(checkServiceability).not.toHaveBeenCalled();
});

test('with two warehouses the reservation skips one that cannot reach the address; if only that one has stock, nothing is reserved', async () => {
  const product = await fbbProduct(2); // MUM-1 holds 2
  const far = await Warehouse.create({ code: 'FAR-1', name: 'Bulkimart Far', address: { line1: 'Unit 1', city: 'Guwahati', state: 'Assam', pincode: '781001', lat: 26.14, lng: 91.73 }, phone: '9876500098', shiprocketPickupLocation: 'BKM-FAR' });
  const { receipt } = await warehouseSvc.createReceipt({ warehouseId: far._id, sellerId: sellerDoc._id, idempotencyKey: `K-${id()}`, adminId: admin._id, lines: [{ productId: product._id, variantId: product.variants[0]._id, acceptedQty: 6 }] });
  await warehouseSvc.postReceipt({ receiptId: receipt._id, adminId: admin._id });
  checkServiceability.mockImplementation(async ({ pickupPostcode }) => (pickupPostcode === '781001' ? { available: false, couriers: [] } : { available: true, couriers: [{ courier_company_id: 3 }] }));
  await fill([product]);
  const order = await Order.findById((await checkout('/orders/unified').expect(201)).body.data.orders[0]._id).lean();
  expect(String(order.origin.warehouseId)).toBe(String(warehouse._id)); // not the fuller but unserviceable FAR-1
  expect(await stockAt(product, far)).toMatchObject({ sellable: 6, reserved: 0 });
  await fill([product, 3]); // only FAR-1 still has 3
  await checkout('/orders').expect(409);
  expect(await stockAt(product, far)).toMatchObject({ sellable: 6, reserved: 0 });
  expect(await stockAt(product)).toMatchObject({ sellable: 1, reserved: 1 });
});

/* ---- 3. pilot seller activation ---------------------------------------------------------------------------------- */

test('pilot: with every switch on, FBB stays closed to a seller outside the pilot, enforced by the server and not only the UI', async () => {
  const { deliveryMethodOptions } = await import('../../services/deliveryMethod.service.js');
  const fbbOption = (s) => deliveryMethodOptions(s).options.find((o) => o.value === 'fbb');
  expect(fbbOption(otherSeller.toObject())).toMatchObject({ available: false, reason: 'Coming soon' });
  expect(fbbOption(sellerDoc.toObject())).toMatchObject({ available: true });
  const product = await makeProduct({ sellerId: otherSeller._id });
  const refused = await asOther(request(app).post(`/products/${product._id}/fbb-conversion`)).send({ confirm: true, acceptedChargeVersion: 1 }).expect(403);
  expect(refused.body.meta.code).toBe('FBB_SELLER_NOT_ENABLED');
  expect((await Product.findById(product._id).lean()).deliveryMethod).toBeUndefined();
  await expect(warehouseSvc.createReceipt({ warehouseId: warehouse._id, sellerId: otherSeller._id, idempotencyKey: `K-${id()}`, adminId: admin._id,
    lines: [{ productId: product._id, variantId: product.variants[0]._id, acceptedQty: 1 }] })).rejects.toThrow('not enabled for this store');
  expect((await warehouseSvc.fbbReadiness({ seller: otherSeller })).blockers).toContain('Fulfilled by Bulkimart is not enabled for this store yet');
  expect((await warehouseSvc.fbbReadiness({ seller: sellerDoc })).ready).toBe(true);
  expect((await asOther(request(app).get('/seller/fbb')).expect(200)).body.data).toMatchObject({ available: false, active: false });
  expect((await asSeller(request(app).get('/seller/fbb')).expect(200)).body.data.available).toBe(true);
});

test('pilot: only an admin with manage_warehouse adds a seller, with a recorded reason; other sellers stay closed', async () => {
  const third = await insertSeller({ businessName: 'Third Store' });
  await asAdmin(request(app).put(`/api/admin/fbb/pilot-sellers/${otherSeller._id}`), plainAdmin).send({ enabled: true, note: 'Pilot start' }).expect(403);
  await asAdmin(request(app).put(`/api/admin/fbb/pilot-sellers/${otherSeller._id}`)).send({ enabled: 'yes', note: 'Pilot start' }).expect(400);
  await asAdmin(request(app).put(`/api/admin/fbb/pilot-sellers/${otherSeller._id}`)).send({ enabled: true }).expect(400);
  const res = await pilot(otherSeller, true, 'Pilot start').expect(200);
  expect(res.body.data.fbbPilot).toMatchObject({ enabled: true, note: 'Pilot start' });
  const saved = (await Seller.findById(otherSeller._id).lean()).fbbPilot;
  expect(String(saved.enabledBy)).toBe(String(admin._id));
  expect(String(saved.changedBy)).toBe(String(admin._id));
  const list = (await asAdmin(request(app).get('/api/admin/fbb/pilot-sellers')).expect(200)).body.data;
  expect(list.allSellers).toBe(false);
  expect(list.rows.map((r) => r.businessName).sort()).toEqual(['Fixture Store', 'Other Store']);
  expect((await asAdmin(request(app).get('/api/admin/fbb/pilot-sellers?q=third')).expect(200)).body.data.rows)
    .toEqual([expect.objectContaining({ businessName: 'Third Store', fbbPilot: { enabled: false } })]);
  expect((await asAdmin(request(app).get('/api/admin/fbb/overview')).expect(200)).body.data.counts.pilotSellers).toBe(2);
  const product = await makeProduct({ sellerId: otherSeller._id });
  await asOther(request(app).post(`/products/${product._id}/fbb-conversion`)).send({ confirm: true, acceptedChargeVersion: 1 }).expect(200);
  await expect(warehouseSvc.convertProductToFbb({ productId: (await makeProduct({ sellerId: third._id }))._id, seller: third, userId: id(), acceptedChargeVersion: 1 }))
    .rejects.toThrow('not enabled for this store');
  // A suspended seller cannot be added.
  await Seller.updateOne({ _id: third._id }, { $set: { status: 'suspended' } });
  await pilot(third, true, 'Should not work').expect(409);
  // The general-rollout switch opens FBB to every seller without touching the pilot list.
  process.env.FBB_ALL_SELLERS_ENABLED = 'true';
  await Seller.updateOne({ _id: third._id }, { $set: { status: 'approved' } });
  await expect(warehouseSvc.convertProductToFbb({ productId: (await makeProduct({ sellerId: third._id }))._id, seller: await Seller.findById(third._id), userId: id(), acceptedChargeVersion: 1 }))
    .resolves.toMatchObject({ alreadyConverted: false });
});

/* ---- 4. switches off after orders exist: no new activity, nothing incurred is skipped --------------------------- */

test('removing a seller from the pilot stops new FBB sales and stock at the server; placed orders are still fulfilled, charged and owed', async () => {
  const product = await fbbProduct(5); // storage ₹1 × 5
  await fill([product, 2]);
  const paidId = (await checkout('/orders/unified').expect(201)).body.data.orders[0]._id;
  await paid(paidId);
  await fill([product]);
  const codId = (await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201)).body.data.orders[0]._id;
  const termsBefore = (await Order.findById(paidId).lean()).fbb.chargeTerms;
  await pilot(sellerDoc, false, 'Pilot paused').expect(200);
  // New activity is refused by the server (a stale cart or an old app cannot bypass it).
  await fill([product]);
  await checkout('/orders/unified').expect(409);
  await checkout('/orders').expect(409);
  await expect(warehouseSvc.createReceipt({ warehouseId: warehouse._id, sellerId: sellerDoc._id, idempotencyKey: `K-${id()}`, adminId: admin._id,
    lines: [{ productId: product._id, variantId: product.variants[0]._id, acceptedQty: 1 }] })).rejects.toThrow('not enabled for this store');
  // The paid order is fulfilled to hand-off and charged at its frozen rates.
  for (const step of ['accept', 'pick', 'pack']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${paidId}/${step}`)).expect(200);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${paidId}/fulfillment/manual`)).send({}).expect(200);
  await recordFbbHandoff(paidId, 'rider_pickup');
  const charges = Object.fromEntries((await FbbCharge.find({ orderId: paidId }).lean()).map((c) => [c.type, c.amountPaise]));
  expect(charges).toEqual({ packaging: 400, fulfillment: 400 }); // ₹4 per order; ₹2 × 2 units
  expect((await Order.findById(paidId).lean()).fbb.chargeTerms).toEqual(termsBefore);
  // The COD order is cancelled before leaving: its reservation is released, not lost.
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${codId}/cancel`)).send({ reason: 'Customer asked to cancel' }).expect(200);
  expect(await stockAt(product)).toMatchObject({ sellable: 3, reserved: 0 });
  // What the seller owes is intact, visible to them, and still settles.
  const { fbbObligationSummary, settleFbbObligations } = await import('../../services/fbbCharges.service.js');
  expect((await fbbObligationSummary(sellerDoc._id)).charged).toBe(13); // 5 storage + 4 packaging + 4 fulfilment
  await expect(settleFbbObligations({ sellerId: sellerDoc._id })).resolves.toMatchObject({ settled: 0, outstanding: 13 }); // no eligible earnings yet
  const view = (await asSeller(request(app).get('/seller/fbb')).expect(200)).body.data;
  expect(view).toMatchObject({ available: false, active: true });
  expect(view.obligation.outstanding).toBe(13);
});

test('every FBB switch off after orders exist: packaging, fulfilment, RTO inspection and cancellation still work; nothing incurred is skipped', async () => {
  process.env.SHIPROCKET_COD_ENABLED = 'true'; // test-only: one COD parcel is booked with Shiprocket and comes back (RTO)
  const product = await fbbProduct(6);
  await fill([product]);
  const packedId = (await checkout('/orders/unified').expect(201)).body.data.orders[0]._id;
  await paid(packedId);
  await fill([product]);
  const courierId = (await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201)).body.data.orders[0]._id;
  await fill([product]);
  const openId = (await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201)).body.data.orders[0]._id;
  for (const orderId of [packedId, courierId]) for (const step of ['accept', 'pick']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/${step}`)).expect(200);
  const snapshotBefore = (await Order.findById(packedId).lean()).financialSnapshot;

  FLAGS.forEach((k) => delete process.env[k]); // delivery methods, FBB, warehouse operations and FBB charges all off
  await fill([product]);
  await checkout('/orders/unified').expect(409);

  // Packed after the switch-off: packaging is still charged at the frozen rate; the hand-off books fulfilment.
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${packedId}/pack`)).expect(200);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${packedId}/fulfillment/manual`)).send({}).expect(200);
  await recordFbbHandoff(packedId, 'rider_pickup');
  expect((await FbbCharge.find({ orderId: packedId }).lean()).map((c) => [c.type, c.amountPaise]).sort()).toEqual([['fulfillment', 200], ['packaging', 400]]);
  expect((await Order.findById(packedId).lean()).financialSnapshot).toEqual(snapshotBefore); // commission snapshot untouched by FBB charges

  // Courier hand-off, then RTO: quarantined and inspected once, with every switch off.
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${courierId}/pack`)).expect(200);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${courierId}/fulfillment/shiprocket`)).send({ confirm: true, quotedCourierCharge: 70, package: { length: 10, breadth: 10, height: 10 } }).expect(200);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${courierId}/handoff`)).expect(200);
  expect(await FbbCharge.countDocuments({ orderId: courierId })).toBe(2);
  await Order.updateOne({ _id: courierId }, { $set: { 'shiprocket.exception': { status: 'open', type: 'RTO_DELIVERED', detectedAt: new Date() } } });
  await resolveShipmentException({ orderId: courierId, adminId: admin._id, decision: 'CANCEL_AND_REFUND', restock: true, note: 'Parcel back at the warehouse' });
  const line = { productId: String(product._id), variantId: String(product.variants[0]._id) };
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${courierId}/inspect`)).send({ lines: [{ ...line, sellableQty: 1, damagedQty: 0 }] }).expect(200);
  expect(await FbbCharge.countDocuments({ orderId: courierId, status: 'posted' })).toBe(2); // RTO keeps incurred charges

  // A placed order cancelled with the switches off releases its reservation.
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${openId}/cancel`)).send({ reason: 'Stock issue at the warehouse' }).expect(200);
  // 6 received − 1 left with the rider; the RTO unit came back sellable; the cancelled unit was released.
  expect(await stockAt(product)).toMatchObject({ sellable: 5, reserved: 0, quarantine: 0 });
  // Storage booked at receipt is untouched and nothing was charged twice.
  expect(await FbbCharge.countDocuments({ type: 'storage' })).toBe(1);
  expect((await warehouseSvc.fbbReadiness()).ready).toBe(false);
});
