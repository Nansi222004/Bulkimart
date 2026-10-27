import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const { listReturnPickups } = await import('../controllers/returnDelivery.controller.js');
const { getRiderHistory, getEarningsSummary } = await import('../controllers/deliveryPartner.controller.js');
const { default: Return } = await import('../models/Return.js');
const { default: Order } = await import('../models/Order.js');
const { default: Delivery } = await import('../models/Delivery.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: User } = await import('../models/User.js');
const { default: DeliveryPartner } = await import('../models/DeliveryPartner.js');

const id = () => new mongoose.Types.ObjectId();
let db, partner, seller, order;
const call = (handler, req) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve(body); return this; } };
  handler(req, res, reject);
});

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  const [buyer, sellerUser, riderUser] = await User.create([
    { name: 'Fixture buyer', phone: '9876500801', roles: ['buyer'] },
    { name: 'Fixture seller', phone: '9876500802', roles: ['seller'] },
    { name: 'Fixture rider', phone: '9876500803', roles: ['delivery'] },
  ]);
  seller = await Seller.create({ userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved', storeDetails: { name: 'Fixture Store', address: 'Shop 1, Market Road', city: 'Indore', lat: 22.72, lng: 75.86 } });
  partner = await DeliveryPartner.create({ userId: riderUser._id, status: 'approved', currentLocation: { lat: 22.70, lng: 75.85 } });
  order = await Order.create({ userId: buyer._id, status: 'delivered', type: 'grocery', paymentMethod: 'cod', orderNo: 'ORD-FIXTURE',
    pricing: { subtotal: 50, totalAmount: 50 },
    shippingAddress: { name: 'Fixture buyer', line1: '12 Lake View', city: 'Indore', pincode: '452001', lat: 22.75, lng: 75.88 },
    items: [{ productId: id(), sellerId: seller._id, name: 'Fixture item', price: 50, qty: 1 }] });
});

const makeReturn = (pickup, extra = {}) => Return.create({ returnNumber: `RET-FIXTURE-${Math.random().toString(36).slice(2, 7)}`, orderId: order._id,
  orderItemId: order.items[0]._id, customerId: order.userId, sellerId: seller._id, productId: order.items[0].productId, productName: 'Fixture item',
  unitPriceSnapshot: 50, quantity: 1, reason: 'DAMAGED', status: 'APPROVED', pickupMethod: 'MANUAL', pickup, ...extra });

test('return pickups list carries distances for offers and the rider\'s completed pickups with earnings', async () => {
  await makeReturn({ status: 'NOT_ASSIGNED', offerAttempts: [{ riderId: partner._id, status: 'OFFERED' }] });
  const done = await makeReturn({ status: 'DELIVERED_TO_SELLER', partnerId: partner._id, sellerConfirmedReceivedAt: new Date() });
  const trip = await Delivery.create({ returnId: done._id, partnerId: partner._id, direction: 'return_pickup', status: 'delivered', endTime: new Date(), partnerEarnings: 40 });
  await Return.updateOne({ _id: done._id }, { $set: { 'pickup.deliveryId': trip._id } });

  const body = await call(listReturnPickups, { partner });
  const offer = body.data.pending[0];
  expect(offer.orderId.shippingAddress).toMatchObject({ line1: '12 Lake View' });
  expect(offer.sellerId.storeDetails).toMatchObject({ address: 'Shop 1, Market Road' });
  expect(offer.pickupDistanceKm).toBeGreaterThan(0);
  expect(offer.routeDistanceKm).toBeGreaterThan(0);
  expect(body.data.history).toHaveLength(1);
  expect(body.data.history[0]).toMatchObject({ returnNumber: done.returnNumber });
  expect(body.data.history[0].pickup.deliveryId.partnerEarnings).toBe(40);
});

test('rider history and today\'s earnings include return pickups under their return number', async () => {
  const done = await makeReturn({ status: 'DELIVERED_TO_SELLER', partnerId: partner._id });
  await Delivery.create({ returnId: done._id, partnerId: partner._id, direction: 'return_pickup', status: 'delivered', endTime: new Date(), partnerEarnings: 40 });

  const history = await call(getRiderHistory, { partner, query: {} });
  expect(history.data).toEqual([expect.objectContaining({ orderNo: done.returnNumber, kind: 'return_pickup', type: 'DELIVERED', amount: 40 })]);

  const summary = await call(getEarningsSummary, { partner, query: {} });
  expect(summary.data.daily.breakdown).toEqual([expect.objectContaining({ type: 'Return pickup', orderId: done.returnNumber, amount: 40 })]);
});
