// Actual controllers, Mongo transactions and workload queries. Only transport
// is replaced; barriers pause real writes and never substitute capacity results.
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const notify = jest.fn(async () => ({}));
jest.unstable_mockModule('../services/notification.service.js', () => ({
  notifyUser: notify, notifySeller: notify, notifyRider: notify, notifyAllAdmins: notify, NOTIFICATION_EVENT: {},
}));
jest.unstable_mockModule('../socket/rooms.js', () => ({
  emitToUser: notify, emitToSeller: notify, emitToRider: notify, emitToAdmins: notify, broadcastToRiders: notify,
}));
const [{ default: Order }, { default: Delivery }, { default: Partner }, { default: User },
  { default: Seller }, { default: Return }, { acceptOrder }, { assignDeliveryPartner },
  { acceptReturnPickup }, { errorHandler }, { RETURN_REASONS }, { canTakeAnother }] = await Promise.all([
  import('../models/Order.js'), import('../models/Delivery.js'), import('../models/DeliveryPartner.js'),
  import('../models/User.js'), import('../models/Seller.js'), import('../models/Return.js'),
  import('../controllers/deliveryPartner.controller.js'), import('../controllers/deliveryAssignment.controller.js'),
  import('../services/returnPickup.service.js'), import('../middlewares/error.middleware.js'),
  import('../constants/enums.js'), import('../services/riderCapacity.service.js'),
]);
let db, driver, partner, sellerId;
const app = express();
app.use(express.json());
app.use(async (req, _res, next) => {
  try { req.user = driver; req.partner = await Partner.findById(partner._id); next(); } catch (e) { next(e); }
});
app.post('/accept/:id', acceptOrder);
app.post('/manual/:id', assignDeliveryPartner);
app.use(errorHandler);
const accept = order => request(app).post(`/accept/${order._id}`).send({}).then(r => r);
const manual = order => request(app).post(`/manual/${order._id}`).send({ partnerId: String(partner._id) }).then(r => r);
const reverse = ret => acceptReturnPickup({ returnId: String(ret._id), partnerId: partner._id });
const makeOrder = () => Order.create({
  userId: driver._id, type: 'grocery', paymentMethod: 'cod', deliveryType: 'internal', status: 'dispatched',
  items: [{ sellerId, productId: new mongoose.Types.ObjectId(), name: 'Synthetic product', qty: 1, price: 10 }],
  shippingAddress: { name: 'Fixture', line1: 'Fixture', pincode: '560001', lat: 12.98, lng: 77.60 },
  pricing: { subtotal: 10, totalAmount: 10 },
});
async function makeReturn() {
  const order = await makeOrder();
  await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered' } });
  const _id = new mongoose.Types.ObjectId();
  await Return.collection.insertOne({ _id, returnNumber: `SYNTHETIC-${_id}`, orderId: order._id,
    orderItemId: order.items[0]._id, customerId: driver._id, sellerId, productId: order.items[0].productId,
    unitPriceSnapshot: 10, quantity: 1, reason: RETURN_REASONS[0],
    pickup: { status: 'NOT_ASSIGNED', offerAttempts: [{ riderId: partner._id, status: 'OFFERED' }] },
  });
  return Return.findById(_id);
}
const active = async () => (await Order.countDocuments({ deliveryPartnerId: partner._id,
  status: { $nin: ['delivered', 'cancelled', 'returned', 'refunded'] } })) +
  await Delivery.countDocuments({ partnerId: partner._id, direction: 'return_pickup',
    status: { $nin: ['rejected', 'delivered', 'failed'] } });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
// Fail fast if a request exits before reaching its expected actual write.
const reached = (barrier, response) => Promise.race([barrier.promise, response.then(r => {
  throw Error(`Request ended before write barrier: ${r.status} ${r.body?.message || ''}`);
})]);
async function pauseCreated(order, action) {
  const entered = deferred(), release = deferred(), create = Delivery.create.bind(Delivery);
  let writes = 0;
  const spy = jest.spyOn(Delivery, 'create').mockImplementation(async (...args) => {
    const result = await create(...args);
    if (String(args[0]?.[0]?.orderId) === String(order._id)) { writes++; entered.resolve(); await release.promise; }
    return result;
  });
  const first = accept(order);
  try { await reached(entered, first); return await action(first, release.resolve, () => writes); }
  finally { release.resolve(); await first; spy.mockRestore(); }
}
beforeAll(async () => {
  // No dotenv/bootstrap or configured URI is read. The only connection is the
  // newly created loopback replica set. No provider boundary is called.
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI;
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri('shopping-concurrency-isolated'));
  for (const model of [Order, Delivery, Partner, User, Seller, Return]) await model.init();
});
beforeEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  for (const key of Object.keys(process.env)) if (key.startsWith('PARCEL_DELIVERY_')) process.env[key] = 'false';
  process.env.PARCEL_DELIVERY_FULFILMENT_ENABLED = 'false';
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '1';
  driver = await User.create({ phone: '9876500099', roles: ['delivery'] });
  partner = await Partner.create({ userId: driver._id, status: 'approved', isAvailable: true });
  sellerId = new mongoose.Types.ObjectId();
  await Seller.collection.insertOne({ _id: sellerId, userId: new mongoose.Types.ObjectId(), businessName: 'Synthetic store',
    storeDetails: { name: 'Fixture', address: 'Fixture', city: 'Fixture', pincode: '560001', lat: 12.97, lng: 77.59 } });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES; await mongoose.disconnect(); await db?.stop(); });

test.each([1, 2, 0, undefined])('three overlapping shopping claims respect configured limit %s and duty', async limit => {
  if (limit === undefined) delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;
  else process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  const orders = await Promise.all([makeOrder(), makeOrder(), makeOrder()]);
  await pauseCreated(orders[0], async (first, release, writes) => {
    const rest = await Promise.all(orders.slice(1).map(accept)); release();
    const results = [await first, ...rest], expected = limit || 3;
    expect(results.map(r => r.status).sort()).toEqual([...Array(expected).fill(200), ...Array(3 - expected).fill(409)]);
    expect(await active()).toBe(expected);
    expect(await Delivery.countDocuments()).toBe(expected);
    expect((await Partner.findById(partner._id)).isAvailable).toBe(limit !== 1);
    // At limit two and in unlimited mode, the paused transaction necessarily
    // conflicts with a committed driver revision and actually retries its body.
    if (limit !== 1) expect(writes()).toBeGreaterThan(1);
    for (const order of orders) {
      const saved = await Order.findById(order._id);
      expect(saved.status).toBe('dispatched'); expect(saved.pricing.totalAmount).toBe(10);
    }
  });
});

test.each([1, 2])('manual assignment competes with shopping at the final slot, limit %s', async limit => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  if (limit === 2) expect((await accept(await makeOrder())).status).toBe(200);
  const a = await makeOrder(), b = await makeOrder();
  await pauseCreated(a, async (first, release) => {
    expect((await manual(b)).status).toBe(200); release();
    expect((await first).status).toBe(409);
    expect(await active()).toBe(limit); expect(await Delivery.countDocuments()).toBe(limit);
    expect((await Order.findById(a._id)).deliveryPartnerId).toBeUndefined();
  });
});

test.each([1, 2, 0])('two manual assignments recount after a partner-write conflict, limit %s', async limit => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  const a = await makeOrder(), b = await makeOrder(), entered = deferred(), release = deferred();
  const update = Partner.updateOne.bind(Partner); let calls = 0;
  jest.spyOn(Partner, 'updateOne').mockImplementation(async (...args) => {
    if (args[2]?.session && calls++ === 0) { entered.resolve(); await release.promise; }
    return update(...args);
  });
  const first = manual(a);
  try {
    await reached(entered, first); expect((await manual(b)).status).toBe(200); release.resolve();
    expect((await first).status).toBe(limit === 1 ? 409 : 200);
    expect(await active()).toBe(limit === 1 ? 1 : 2);
    expect(await Delivery.countDocuments()).toBe(limit === 1 ? 1 : 2);
    expect((await Partner.findById(partner._id)).isAvailable).toBe(true); // existing manual duty behavior
  } finally { release.resolve(); await first; }
});

test('duplicate simultaneous acceptance and later replay create one Delivery and timeline entry', async () => {
  const order = await makeOrder();
  await pauseCreated(order, async (first, release) => {
    const entered = deferred(), update = Order.findOneAndUpdate.bind(Order);
    jest.spyOn(Order, 'findOneAndUpdate').mockImplementation((...args) => { entered.resolve(); return update(...args); });
    const second = accept(order);
    await reached(entered, second); release();
    const responses = await Promise.all([first, second]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses[0].body.data.deliveryId).toBe(responses[1].body.data.deliveryId);
    expect((await accept(order)).status).toBe(200);
    expect(await Delivery.countDocuments()).toBe(1);
    expect((await Order.findById(order._id)).timeline.filter(t => /assigned/.test(t.note))).toHaveLength(1);
  });
});

test.each([1, 2])('reverse commit forces a paused shopping claim to recount shared workload, limit %s', async limit => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  const order = await makeOrder(), ret = await makeReturn();
  await pauseCreated(order, async (first, release) => {
    const result = await reverse(ret); expect(result.delivery.direction).toBe('return_pickup'); release();
    expect((await first).status).toBe(limit === 1 ? 409 : 200);
    expect(await active()).toBe(limit);
    expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
  });
});

test.each(['accept', 'manual'])('in-flight reverse token blocks %s even with parcel flags disabled', async mode => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '0';
  const ret = await makeReturn(), order = await makeOrder(), entered = deferred(), release = deferred();
  const create = Delivery.create.bind(Delivery);
  jest.spyOn(Delivery, 'create').mockImplementation(async (...args) => {
    const result = await create(...args);
    if (args[0]?.[0]?.direction === 'return_pickup') { entered.resolve(); await release.promise; }
    return result;
  });
  const pending = reverse(ret).then(value => ({ value }), error => ({ error }));
  try {
    await Promise.race([entered.promise, pending.then(r => { throw r.error || Error('Reverse missed barrier'); })]);
    // Unlimited capacity cannot hide a missing token guard. The forward request
    // must refuse while the reverse transaction remains paused, before release.
    const forward = await (mode === 'manual' ? manual(order) : accept(order));
    expect(forward.status).toBe(409); release.resolve(); expect((await pending).error).toBeUndefined();
    expect(await active()).toBe(1); expect(await Delivery.countDocuments()).toBe(1);
  } finally { release.resolve(); await pending; }
});

test('failed forward claim rolls back Order, Delivery, duty and offer history; retry succeeds', async () => {
  const order = await makeOrder(), update = Partner.updateOne.bind(Partner);
  const before = await Partner.findById(partner._id);
  const spy = jest.spyOn(Partner, 'updateOne').mockImplementation(async (...args) => {
    const result = await update(...args);
    if (args[2]?.session) throw Error('Synthetic failure after authoritative driver write');
    return result;
  });
  expect((await accept(order)).status).toBe(500); spy.mockRestore();
  const saved = await Order.findById(order._id), rider = await Partner.findById(partner._id);
  expect(saved.deliveryPartnerId).toBeUndefined(); expect(saved.deliveryId).toBeUndefined();
  expect(saved.timeline.filter(t => /assigned/.test(t.note))).toHaveLength(0);
  expect(await Delivery.countDocuments()).toBe(0); expect(rider.isAvailable).toBe(true); expect(rider.__v).toBe(before.__v);
  expect((await accept(order)).status).toBe(200); expect(await Delivery.countDocuments()).toBe(1);
});

test('failed manual reassignment restores previous rider, Delivery and history', async () => {
  const order = await makeOrder(); expect((await manual(order)).status).toBe(200);
  const original = await Order.findById(order._id), oldDelivery = await Delivery.findById(original.deliveryId);
  const secondUser = await User.create({ phone: '9876500098', roles: ['delivery'] });
  const target = await Partner.create({ userId: secondUser._id, status: 'approved', isAvailable: true });
  const spy = jest.spyOn(Delivery, 'create').mockRejectedValueOnce(Error('Synthetic creation failure'));
  expect((await request(app).post(`/manual/${order._id}`).send({ partnerId: String(target._id) })).status).toBe(500);
  spy.mockRestore();
  const saved = await Order.findById(order._id);
  expect(String(saved.deliveryPartnerId)).toBe(String(partner._id)); expect(String(saved.deliveryId)).toBe(String(oldDelivery._id));
  expect(saved.assignmentHistory).toHaveLength(1); expect(saved.assignmentHistory[0].unassignedAt).toBeUndefined();
  expect((await Delivery.findById(oldDelivery._id)).status).toBe('accepted'); expect(await Delivery.countDocuments()).toBe(1);
  expect((await Partner.findById(target._id)).__v).toBe(target.__v);
});

test('failed reverse Delivery creation rolls back Return and token; replay cannot duplicate a committed pickup', async () => {
  const ret = await makeReturn();
  const spy = jest.spyOn(Delivery, 'create').mockRejectedValueOnce(Error('Synthetic reverse creation failure'));
  await expect(reverse(ret)).rejects.toThrow('Synthetic reverse creation failure'); spy.mockRestore();
  const saved = await Return.findById(ret._id);
  expect(saved.pickup.status).toBe('NOT_ASSIGNED'); expect(saved.pickup.partnerId).toBeUndefined();
  expect(saved.pickup.offerAttempts[0].status).toBe('OFFERED'); expect(await Delivery.countDocuments()).toBe(0);
  expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
  await reverse(ret); await expect(reverse(ret)).rejects.toMatchObject({ status: 409 });
  expect(await Delivery.countDocuments()).toBe(1); expect((await Partner.findById(partner._id)).isAvailable).toBe(true);
});

test('capacity counts existing return pickups and preserves terminal exclusions', async () => {
  const ret = await makeReturn(); await reverse(ret);
  expect((await canTakeAnother(partner._id)).ok).toBe(false);
  expect((await accept(await makeOrder())).status).toBe(409);
  await Delivery.updateOne({ returnId: ret._id }, { $set: { status: 'delivered' } });
  expect((await canTakeAnother(partner._id)).ok).toBe(true);
  expect((await accept(await makeOrder())).status).toBe(200);
});

test.each([1, 2, 0])('shopping commit wins against a paused manual driver write, limit %s', async limit => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  const a = await makeOrder(), b = await makeOrder(), entered = deferred(), release = deferred();
  const update = Partner.updateOne.bind(Partner); let held = false;
  jest.spyOn(Partner, 'updateOne').mockImplementation(async (...args) => {
    if (args[2]?.session && !held) { held = true; entered.resolve(); await release.promise; }
    return update(...args);
  });
  const first = manual(a);
  try {
    await reached(entered, first); expect((await accept(b)).status).toBe(200); release.resolve();
    expect((await first).status).toBe(limit === 1 ? 409 : 200);
    expect(await active()).toBe(limit === 1 ? 1 : 2);
    expect((await Partner.findById(partner._id)).isAvailable).toBe(limit !== 1);
  } finally { release.resolve(); await first; }
});

test('shopping and reverse share the final slot when limit two already has one forward task', async () => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '2';
  expect((await accept(await makeOrder())).status).toBe(200);
  const order = await makeOrder(), ret = await makeReturn();
  await pauseCreated(order, async (first, release) => {
    await reverse(ret); release(); expect((await first).status).toBe(409);
    expect(await active()).toBe(2); expect(await Delivery.countDocuments()).toBe(2);
  });
});

test.each([1, 2])('reverse acceptance recounts a committed manual workload, limit %s', async limit => {
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = String(limit);
  const order = await makeOrder(), ret = await makeReturn(), entered = deferred(), release = deferred();
  const claim = Partner.findOneAndUpdate.bind(Partner);
  // Pause before actually acquiring the reverse token. Manual must commit first.
  jest.spyOn(Partner, 'findOneAndUpdate').mockImplementation(async (...args) => {
    entered.resolve(); await release.promise; return claim(...args);
  });
  const pending = reverse(ret).then(value => ({ value }), error => ({ error }));
  try {
    await entered.promise; expect((await manual(order)).status).toBe(200); release.resolve();
    const result = await pending;
    if (limit === 1) expect(result.error).toMatchObject({ status: 409 });
    else { expect(result.error).toBeUndefined(); expect(result.value.delivery.direction).toBe('return_pickup'); }
    expect(await active()).toBe(limit);
    expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
  } finally { release.resolve(); await pending; }
});

test('simultaneous reverse requests cannot duplicate a pickup or strand its token', async () => {
  const ret = await makeReturn(), entered = deferred(), release = deferred(), create = Delivery.create.bind(Delivery);
  jest.spyOn(Delivery, 'create').mockImplementation(async (...args) => {
    const result = await create(...args); entered.resolve(); await release.promise; return result;
  });
  const first = reverse(ret);
  try {
    await entered.promise;
    await expect(reverse(ret)).rejects.toMatchObject({ status: 409 });
    release.resolve(); await first;
    expect(await Delivery.countDocuments()).toBe(1);
    expect((await Partner.findById(partner._id)).parcelReturnClaim?.token).toBeUndefined();
  } finally { release.resolve(); await first; }
});
