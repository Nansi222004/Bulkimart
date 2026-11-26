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
 * Phase 3 FBB over HTTP: checkout paths, mixed baskets, seller view-only enforcement, admin provider choice from
 * the warehouse (rider or Shiprocket, provider mocked), permissions, and feature-off behaviour.
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

test('FBB checkout reserves warehouse stock, ignores the shop radius, allows COD and records warehouse origin and frozen rates', async () => {
  const product = await fbbProduct(5);
  await fill([product, 2]);
  const res = await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201); // the shop radius (5 km from Indore) does not apply
  const order = await Order.findById(res.body.data.orders[0]._id).lean();
  expect(order).toMatchObject({ deliveryMethod: 'fbb', fulfillmentOwner: 'bulkimart', origin: { kind: 'warehouse' }, fbb: { status: 'awaiting_acceptance' }, paymentMethod: 'cod' });
  expect(String(order.origin.warehouseId)).toBe(String(warehouse._id));
  expect(order.fbb.chargeTerms).toMatchObject({ configVersion: 1, packaging: { amountPaise: 400 } });
  expect(order.pricing.totalAmount).toBe(order.pricing.subtotal + order.pricing.deliveryCharge + (order.pricing.codFeeTotal || 0)); // no FBB fee on the customer
  expect(await WarehouseStock.findOne({ productId: product._id }).lean()).toMatchObject({ sellable: 3, reserved: 2 });
  // Single-order checkout works the same way.
  await fill([product, 1]);
  const single = await checkout('/orders').expect(201);
  expect((await Order.findById(single.body.data.order._id).lean()).origin.kind).toBe('warehouse');
});

test('mixed basket: Easy Ship + FBB keep COD and split into two orders; adding Self Delivery removes COD for all', async () => {
  const fbb = await fbbProduct(5);
  const easy = await makeProduct({ name: 'Easy', sellerId: sellerDoc._id });
  await Seller.updateOne({ _id: sellerDoc._id }, { $unset: { serviceRadiusKm: 1 } });
  await fill([fbb], [easy]);
  const res = await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201);
  expect((await Order.find({ _id: { $in: res.body.data.orders.map((o) => o._id) } }).lean()).map((o) => o.deliveryMethod).sort()).toEqual(['easy_ship', 'fbb']);
  const self = await makeProduct({ name: 'Self', deliveryMethod: 'self_delivery' });
  await fill([fbb], [self]);
  await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
});

test('switched off: FBB items cannot be bought, but existing orders can still be fulfilled', async () => {
  const product = await fbbProduct(3);
  await fill([product]);
  const placed = await checkout('/orders/unified').expect(201);
  await Payment.updateOne({ _id: (await Order.findById(placed.body.data.orders[0]._id)).paymentId }, { $set: { status: 'paid' } });
  delete process.env.FBB_ENABLED;
  await fill([product]);
  await checkout('/orders/unified').expect(409);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${placed.body.data.orders[0]._id}/accept`)).expect(200);
});

test('the seller views FBB orders and stock but cannot change status, book couriers or edit stock', async () => {
  const product = await fbbProduct(4);
  await fill([product]);
  const res = await checkout('/orders/unified').expect(201);
  const orderId = res.body.data.orders[0]._id;
  await Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
  await asSeller(request(app).patch(`/seller/orders/${orderId}/status`)).send({ status: 'confirmed' }).expect(403);
  await asSeller(request(app).get(`/seller/orders/${orderId}/options`)).expect(403);
  await asSeller(request(app).post(`/seller/orders/${orderId}/shiprocket`)).send({ confirm: true }).expect(403);
  await asSeller(request(app).patch(`/products/${product._id}/stock`)).send({ delta: 5 }).expect(409);
  const detail = (await asSeller(request(app).get(`/seller/orders/${orderId}`)).expect(200)).body.data;
  expect(detail.permittedActions).toEqual([]);
  const fbb = (await asSeller(request(app).get('/seller/fbb')).expect(200)).body.data;
  expect(fbb.stock).toEqual([expect.objectContaining({ sellable: 3, reserved: 1 })]);
  expect(fbb.obligation.outstanding).toBe(4); // ₹1 storage × 4 units received
});

test('admin fulfils from the warehouse: accept → pick → pack → Bulkimart rider (warehouse pickup)', async () => {
  const product = await fbbProduct(4);
  await fill([product]);
  const orderId = (await checkout('/orders/unified').expect(201)).body.data.orders[0]._id;
  await Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
  for (const step of ['accept', 'pick', 'pack']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/${step}`)).expect(200);
  const options = (await asAdmin(request(app).get(`/api/admin/fbb/orders/${orderId}/fulfillment-options`)).expect(200)).body.data;
  expect(options.pickup).toMatchObject({ pincode: '400070', city: 'Mumbai', name: 'Bulkimart Mumbai' });
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/fulfillment/manual`)).send({}).expect(200);
  const saved = await Order.findById(orderId).lean();
  expect(saved).toMatchObject({ status: 'dispatched', deliveryType: 'internal', fulfillment: { method: 'manual', selectedBy: 'admin' } });
  expect(broadcast).toHaveBeenCalledTimes(1);
});

test('admin books Shiprocket from the warehouse pickup, and the hand-off moves stock out once', async () => {
  const product = await fbbProduct(4);
  await fill([product]);
  const orderId = (await checkout('/orders/unified').expect(201)).body.data.orders[0]._id;
  await Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
  for (const step of ['accept', 'pick', 'pack']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/${step}`)).expect(200);
  const booked = await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/fulfillment/shiprocket`)).send({ confirm: true, quotedCourierCharge: 70, package: { length: 10, breadth: 10, height: 10 } });
  expect(booked.status).toBe(200);
  expect(checkServiceability).toHaveBeenCalledWith(expect.objectContaining({ pickupPostcode: '400070' }));
  expect(createShiprocketOrder.mock.calls[0][0].pickup_location).toBe('BKM-MUM');
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/handoff`)).expect(200);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/handoff`)).expect(200);
  expect(await WarehouseStock.findOne({ productId: product._id }).lean()).toMatchObject({ sellable: 3, reserved: 0 });
  expect((await Order.findById(orderId).lean())).toMatchObject({ status: 'dispatched', fbb: { status: 'handed_over' } });
});

test('warehouse operations need manage_warehouse; charges need manage_finance', async () => {
  await asAdmin(request(app).get('/api/admin/fbb/overview'), plainAdmin).expect(403);
  await asAdmin(request(app).get('/api/admin/fbb/finance/charges'), plainAdmin).expect(403);
  const overview = (await asAdmin(request(app).get('/api/admin/fbb/overview')).expect(200)).body.data;
  expect(overview.readiness.ready).toBe(true);
  await asAdmin(request(app).get('/api/admin/fbb/finance/charge-config')).expect(200);
});

test('conversion through the API needs explicit confirmation and the current charge version', async () => {
  const product = await makeProduct();
  await auth(request(app).post(`/products/${product._id}/fbb-conversion`), sellerUser, 'seller').send({ acceptedChargeVersion: 1 }).expect(400);
  await auth(request(app).post(`/products/${product._id}/fbb-conversion`), sellerUser, 'seller').send({ confirm: true, acceptedChargeVersion: 7 }).expect(409);
  await auth(request(app).post(`/products/${product._id}/fbb-conversion`), sellerUser, 'seller').send({ confirm: true, acceptedChargeVersion: 1 }).expect(200);
  expect((await Product.findById(product._id).lean())).toMatchObject({ deliveryMethod: 'fbb', stock: 0 });
});

/* ---- Phase 4 audit ------------------------------------------------------------------------------------------------ */

/** An FBB order taken to the given point: 'packed', 'rider' (dispatched with a rider, not yet picked up) or 'courier' (handed over via Shiprocket). */
const fbbOrderAt = async (point, { qty = 1, paymentMethod = 'online', stock = 4 } = {}) => {
  const product = await fbbProduct(stock);
  await fill([product, qty]);
  const orderId = (await checkout('/orders/unified', { paymentMethod }).expect(201)).body.data.orders[0]._id;
  if (paymentMethod === 'online') await Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
  for (const step of ['accept', 'pick', 'pack']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/${step}`)).expect(200);
  if (point === 'rider') await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/fulfillment/manual`)).send({}).expect(200);
  if (point === 'courier') {
    await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/fulfillment/shiprocket`)).send({ confirm: true, quotedCourierCharge: 70, package: { length: 10, breadth: 10, height: 10 } }).expect(200);
    await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/handoff`)).expect(200);
  }
  return { product, orderId };
};

test('simultaneous hand-off signals (rider pickup, courier scan, admin confirm) move stock and book the fulfilment charge exactly once', async () => {
  const { product, orderId } = await fbbOrderAt('rider', { qty: 2 });
  const results = await Promise.allSettled([
    recordFbbHandoff(orderId, 'rider_pickup'), recordFbbHandoff(orderId, 'courier_scan'), recordFbbHandoff(orderId, 'rider_pickup'),
    asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/handoff`)).then((r) => { if (r.status !== 200) throw new Error(`admin ${r.status}`); return r; }),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  expect(results.slice(0, 3).filter((r) => r.value.alreadyRecorded === false).length).toBeLessThanOrEqual(1);
  expect(await WarehouseStock.findOne({ productId: product._id }).lean()).toMatchObject({ sellable: 2, reserved: 0 });
  expect(await StockMovement.countDocuments({ referenceId: new mongoose.Types.ObjectId(String(orderId)), reason: 'fbb_dispatch' })).toBe(1);
  expect(await FbbCharge.countDocuments({ orderId, type: 'fulfillment' })).toBe(1);
  expect(await FbbCharge.countDocuments({ orderId, type: 'packaging' })).toBe(1);
});

test('an RTO parcel is held for inspection (never auto-damaged or auto-restocked) and is inspected exactly once', async () => {
  process.env.SHIPROCKET_COD_ENABLED = 'true'; // test-only: a COD parcel booked with Shiprocket
  const { product, orderId } = await fbbOrderAt('courier', { qty: 2, paymentMethod: 'cod' }).finally(() => { delete process.env.SHIPROCKET_COD_ENABLED; });
  await Order.updateOne({ _id: orderId }, { $set: { 'shiprocket.exception': { status: 'open', type: 'RTO_DELIVERED', detectedAt: new Date() } } });
  await resolveShipmentException({ orderId, adminId: admin._id, decision: 'CANCEL_AND_REFUND', restock: true, note: 'Parcel back at the warehouse' });
  expect(await WarehouseStock.findOne({ productId: product._id }).lean()).toMatchObject({ sellable: 2, reserved: 0, damaged: 0, quarantine: 2 }); // restock=true still does not put it on sale
  expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(2);
  expect((await Order.findById(orderId).lean()).fbb.returnInspection).toMatchObject({ status: 'pending', lines: [expect.objectContaining({ qty: 2 })] });
  // The work queue lists it; a split that does not add up is refused; other admins cannot inspect.
  const queue = (await asAdmin(request(app).get('/api/admin/fbb/orders?stage=inspection')).expect(200)).body.data.rows;
  expect(queue.map((o) => String(o._id))).toEqual([String(orderId)]);
  const line = { productId: String(product._id), variantId: String(product.variants[0]._id) };
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/inspect`)).send({ lines: [{ ...line, sellableQty: 2, damagedQty: 1 }] }).expect(400);
  await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/inspect`), plainAdmin).send({ lines: [{ ...line, sellableQty: 1, damagedQty: 1 }] }).expect(403);
  // Two simultaneous submissions: one applies, the other is refused.
  const both = await Promise.all([1, 2].map(() => asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/inspect`)).send({ lines: [{ ...line, sellableQty: 1, damagedQty: 1 }], note: 'Box dented' })));
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await WarehouseStock.findOne({ productId: product._id }).lean()).toMatchObject({ sellable: 3, damaged: 1, quarantine: 0 });
  expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(3);
  expect(await StockMovement.countDocuments({ referenceId: new mongoose.Types.ObjectId(String(orderId)), reason: 'fbb_inspection' })).toBe(4);
  // Charges incurred before the RTO stay (approved policy: returns and RTO keep the charges).
  expect(await FbbCharge.countDocuments({ orderId, status: { $ne: 'reversed' } })).toBe(2);
});

test('the customer sees "Fulfilled by Bulkimart" but never the seller FBB rates or staff ids', async () => {
  const { product, orderId } = await fbbOrderAt('packed');
  expect(publicProduct(await Product.findById(product._id).lean())).toMatchObject({ fulfilledByBulkimart: true });
  expect(publicProduct(await makeProduct())).not.toHaveProperty('fulfilledByBulkimart');
  const list = (await auth(request(app).get('/orders')).expect(200)).body.data;
  const mine = list.find((o) => String(o._id) === String(orderId));
  expect(mine).toMatchObject({ deliveryMethod: 'fbb', fbb: { status: 'packed' } });
  expect(mine.fbb).not.toHaveProperty('chargeTerms');
  expect(mine.fbb).not.toHaveProperty('acceptedBy');
  const one = (await auth(request(app).get(`/orders/${orderId}`)).expect(200)).body.data;
  expect(one.fbb).not.toHaveProperty('chargeTerms');
  expect(one.fbb).not.toHaveProperty('packedBy');
  expect((await Order.findById(orderId).lean()).fbb.chargeTerms).toBeDefined(); // still stored for billing
});

test('the rider return-pickup list shows the warehouse as the drop for FBB returns and the shop for others', async () => {
  const { orderId } = await fbbOrderAt('rider');
  const shopOrder = await Order.collection.insertOne({ orderNo: 'SHOP-1', userId: buyer._id, items: [], deliveryMethod: 'easy_ship', shippingAddress: address });
  riderPartner = { _id: id(), baseLocation: { lat: 19.1, lng: 72.9 } };
  const pickup = { status: 'ASSIGNED', partnerId: riderPartner._id };
  await Return.collection.insertMany([
    { returnNumber: 'R-FBB', productName: 'Lamp', quantity: 1, sellerId: sellerDoc._id, orderId: new mongoose.Types.ObjectId(String(orderId)), status: 'APPROVED', pickupMethod: 'MANUAL', pickup },
    { returnNumber: 'R-SHOP', productName: 'Lamp', quantity: 1, sellerId: sellerDoc._id, orderId: shopOrder.insertedId, status: 'APPROVED', pickupMethod: 'MANUAL', pickup },
  ]);
  const { active } = (await request(app).get('/rider/return-pickups').expect(200)).body.data;
  const byNo = Object.fromEntries(active.map((r) => [r.returnNumber, r]));
  expect(byNo['R-FBB'].sellerId).toMatchObject({ businessName: 'Bulkimart Mumbai', isWarehouseOrigin: true, storeDetails: { pincode: '400070', city: 'Mumbai' } });
  expect(byNo['R-SHOP'].sellerId).toMatchObject({ businessName: 'Fixture Store', storeDetails: { pincode: '452001' } });
  expect(byNo['R-SHOP'].sellerId).not.toHaveProperty('isWarehouseOrigin');
});

test('a customer cannot cancel an FBB order after it left the warehouse', async () => {
  const { orderId } = await fbbOrderAt('rider');
  await recordFbbHandoff(orderId, 'rider_pickup');
  const res = await auth(request(app).patch(`/orders/${orderId}/cancel`)).send({ reason: 'Changed my mind' });
  expect([400, 409]).toContain(res.status);
  expect((await Order.findById(orderId).lean()).status).not.toBe('cancelled');
});

test('FBB is paid: with charges off, new FBB sales and receipt posting pause, but existing orders are still charged from their frozen terms', async () => {
  const product = await fbbProduct(4);
  await fill([product]);
  const orderId = (await checkout('/orders/unified').expect(201)).body.data.orders[0]._id;
  await Payment.updateOne({ _id: (await Order.findById(orderId)).paymentId }, { $set: { status: 'paid' } });
  delete process.env.FBB_CHARGES_ENABLED;
  await fill([product]);
  await checkout('/orders/unified').expect(409);
  await checkout('/orders').expect(409);
  // The master switch also stops FBB sales on its own.
  process.env.FBB_CHARGES_ENABLED = 'true'; delete process.env.DELIVERY_METHODS_ENABLED;
  await checkout('/orders/unified').expect(409);
  flagsOn(); delete process.env.FBB_CHARGES_ENABLED;
  // Receiving: the draft is kept, posting is refused.
  const { receipt } = await warehouseSvc.createReceipt({ warehouseId: warehouse._id, sellerId: sellerDoc._id, idempotencyKey: `K-${id()}`, adminId: admin._id, lines: [{ productId: product._id, variantId: product.variants[0]._id, acceptedQty: 2 }] });
  await expect(warehouseSvc.postReceipt({ receiptId: receipt._id, adminId: admin._id })).rejects.toThrow('Posting receipts is paused');
  expect((await mongoose.models.WarehouseReceipt.findById(receipt._id).lean()).status).toBe('draft');
  // The order placed earlier is still fulfilled and charged at its frozen rate.
  for (const step of ['accept', 'pick', 'pack']) await asAdmin(request(app).post(`/api/admin/fbb/orders/${orderId}/${step}`)).expect(200);
  expect(await FbbCharge.findOne({ orderId, type: 'packaging' }).lean()).toMatchObject({ ratePaise: 400, amountPaise: 400 });
  expect((await warehouseSvc.fbbReadiness()).blockers).toContain('FBB charges are switched off');
});

test('Easy Ship end to end with every switch on: seller accepts, books Shiprocket COD from the shop (fee as its own line, totals reconcile)', async () => {
  process.env.SHIPROCKET_COD_ENABLED = 'true';
  try {
    await Seller.updateOne({ _id: sellerDoc._id }, { $unset: { serviceRadiusKm: 1 } });
    const product = await makeProduct({ name: 'Kettle' });
    await fill([product, 2]);
    const orderId = (await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201)).body.data.orders[0]._id;
    const placed = await Order.findById(orderId).lean();
    expect(placed).toMatchObject({ deliveryMethod: 'easy_ship', paymentMethod: 'cod' });
    expect(placed.origin).toBeUndefined();
    expect(placed.fbb).toBeUndefined();
    expect((await Product.findById(product._id).lean()).variants[0].stock).toBe(3); // seller-held stock, not a warehouse
    await asSeller(request(app).patch(`/seller/orders/${orderId}/status`)).send({ status: 'confirmed' }).expect(200);
    await asSeller(request(app).patch(`/seller/orders/${orderId}/status`)).send({ status: 'preparing' }).expect(200);
    await asSeller(request(app).patch(`/seller/orders/${orderId}/status`)).send({ status: 'ready_for_pickup' }).expect(200);
    const booked = await asSeller(request(app).post(`/seller/orders/${orderId}/shiprocket`)).send({ confirm: true, quotedCourierCharge: 70, package: { length: 10, breadth: 10, height: 10 } });
    expect(booked.status).toBe(200);
    expect(checkServiceability).toHaveBeenCalledWith(expect.objectContaining({ pickupPostcode: '452001' }));
    const body = createShiprocketOrder.mock.calls[0][0];
    expect(body).toMatchObject({ pickup_location: 'seller-pickup', payment_method: 'COD' });
    const order = await Order.findById(orderId).lean();
    const collect = body.sub_total + body.shipping_charges - body.total_discount;
    expect(Math.round(collect * 100)).toBe(Math.round(order.pricing.totalAmount * 100));
    const feeLine = body.order_items.find((l) => l.sku === 'BULKIMART-COD-FEE');
    if (order.pricing.codFeeTotal > 0) expect(feeLine).toMatchObject({ units: 1, selling_price: order.pricing.codFeeTotal });
    else expect(feeLine).toBeUndefined();
  } finally { delete process.env.SHIPROCKET_COD_ENABLED; }
});

test('Quick Commerce is untouched with every delivery switch on: no method, origin, FBB stage or warehouse stock', async () => {
  const grocery = await makeProduct({ name: 'Milk', type: 'grocery' });
  await Cart.findOneAndUpdate({ userId: buyer._id, channel: 'grocery' }, { $set: { items: [{ productId: grocery._id, variantId: grocery.variants[0]._id, sellerId: sellerDoc._id, name: 'Milk', price: 100, qty: 1 }] } }, { upsert: true });
  const near = { ...address, city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.701, lng: 75.851 };
  const res = await auth(request(app).post('/orders/unified')).set('Idempotency-Key', randomUUID()).send({ shippingAddress: near, paymentMethod: 'online', channel: 'grocery' });
  expect(res.status).toBe(201);
  const order = await Order.findById(res.body.data.orders[0]._id).lean();
  expect(order.type).toBe('grocery');
  expect(order.deliveryMethod).toBeUndefined();
  expect(order.origin).toBeUndefined();
  expect(order.fbb).toBeUndefined();
  expect(await WarehouseStock.countDocuments({ productId: grocery._id })).toBe(0);
  expect((await Product.findById(grocery._id).lean()).variants[0].stock).toBe(4);
});
