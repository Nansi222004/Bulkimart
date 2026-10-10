import 'dotenv/config';
import { setServers } from 'dns';
if (process.env.NODE_ENV !== 'production') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
import mongoose from 'mongoose';
import DeliveryPartner from './models/DeliveryPartner.js';
import Delivery from './models/Delivery.js';
import Order from './models/Order.js';
import User from './models/User.js';
import Product from './models/Product.js';
import Category from './models/Category.js';
import Seller from './models/Seller.js';
import CategoryReturnPolicy from './models/CategoryReturnPolicy.js';
import Cart from './models/Cart.js';
import Return from './models/Return.js';
import { toGeoPoint } from './models/geoPoint.schema.js';
import { canTakeAnother, openDeliveryCount, openReturnPickupCount } from './services/riderCapacity.service.js';
import { broadcastReturnPickupToRiders, acceptReturnPickup, arrangeReturnPickup } from './services/returnPickup.service.js';
import { createReturnRequest, transitionReturnStatus } from './services/return.service.js';
import { addToCart } from './controllers/cart.controller.js';
import { createOrder } from './controllers/order.controller.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

function mockRes() {
  let resolveDone;
  const res = { statusCode: 200, done: new Promise((r) => { resolveDone = r; }) };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; resolveDone(); return res; };
  return res;
}
const next = (res) => (err) => { if (err) res.status(err.status || err.statusCode || 500).json({ message: err.message }); };
const call = async (fn, req) => { const res = mockRes(); fn(req, res, next(res)); await res.done; return res; };

const SHOP_LOC = { lat: 22.7196, lng: 75.8577 };
const CUSTOMER_LOC = { lat: 22.74, lng: 75.86 };
const RIDER_LOC = { lat: 22.735, lng: 75.855 };

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const originalLimitEnv = process.env.RIDER_MAX_CONCURRENT_DELIVERIES;

  const riderUser = await User.create({
    name: 'Cap Rider', email: `cap_rider_${Date.now()}@test.com`, phone: `6${Date.now().toString().slice(-9)}`, password: 'x', role: 'customer',
  });
  const rider = await DeliveryPartner.create({
    userId: riderUser._id, status: 'approved', isAvailable: true, vehicleType: 'bike',
    baseLocation: { lat: RIDER_LOC.lat, lng: RIDER_LOC.lng, source: 'gps', point: toGeoPoint(RIDER_LOC.lat, RIDER_LOC.lng) },
  });

  // ============================================================
  // 9/10. RAW COUNTERS — forward vs return-pickup, isolated
  // ============================================================
  check('9. openDeliveryCount starts at 0', await openDeliveryCount(rider._id) === 0);
  check('10. openReturnPickupCount starts at 0', await openReturnPickupCount(rider._id) === 0);

  const activeDelivery = await Delivery.create({ partnerId: rider._id, direction: 'return_pickup', status: 'accepted' });
  check('10. return pickup counts (status=accepted)', await openReturnPickupCount(rider._id) === 1);

  // ============================================================
  // 11/12/13. Terminal statuses never count
  // ============================================================
  await Delivery.updateOne({ _id: activeDelivery._id }, { $set: { status: 'delivered' } });
  check('11. completed (delivered) return pickup does not count', await openReturnPickupCount(rider._id) === 0);

  await Delivery.updateOne({ _id: activeDelivery._id }, { $set: { status: 'rejected' } });
  check('12. rejected/cancelled return pickup does not count', await openReturnPickupCount(rider._id) === 0);

  await Delivery.updateOne({ _id: activeDelivery._id }, { $set: { status: 'failed' } });
  check('13. failed/expired return pickup does not count', await openReturnPickupCount(rider._id) === 0);

  await Delivery.deleteOne({ _id: activeDelivery._id });

  // ============================================================
  // 14/15. combined capacity — return pickup blocks a NEW offer of EITHER kind
  // ============================================================
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '1';
  const busyDelivery = await Delivery.create({ partnerId: rider._id, direction: 'return_pickup', status: 'accepted' });
  {
    const cap = await canTakeAnother(rider._id);
    check('14. rider holding a return pickup is at capacity (limit=1)', cap.ok === false);
  }

  // ---- fixtures for a real return-pickup broadcast, to prove the offer never reaches this rider ----
  await Category.deleteMany({ slug: /^__test-cap/ });
  const header = await Category.create({ name: '__test_cap_header', type: 'grocery', parent: null, slug: `__test-cap-header-${Date.now()}`, isActive: true });
  const leaf = await Category.create({ name: '__test_cap_leaf', type: 'grocery', parent: header._id, slug: `__test-cap-leaf-${Date.now()}`, isActive: true });
  await CategoryReturnPolicy.create({ categoryId: header._id, returnWindowDays: 7, isActive: true });

  const seller = await Seller.findOne({ status: 'approved' }) || await Seller.findOne();
  await Seller.updateOne({ _id: seller._id }, { $set: { 'storeDetails.lat': SHOP_LOC.lat, 'storeDetails.lng': SHOP_LOC.lng } });

  const product = await Product.create({
    type: 'grocery', sellerId: seller._id, name: '__test_cap_product', category: leaf._id,
    images: ['x.jpg'], isActive: true, status: 'approved', returnable: true,
    variants: [{ name: 'Default', price: 100, mrp: 120, stock: 50, unit: 'piece' }],
  });

  const customer = await User.create({
    name: 'Cap Customer', email: `cap_cust_${Date.now()}@test.com`, phone: `5${Date.now().toString().slice(-9)}`,
    password: 'x', role: 'customer',
    addresses: [{ label: 'Home', name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng, isDefault: true }],
  });

  await Cart.deleteMany({ userId: customer._id });
  await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng } });
  const orderRes = await call(createOrder, {
    user: customer, body: {
      shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng },
      paymentMethod: 'cod', channel: 'grocery',
    },
  });
  const orderId = orderRes.body?.data?.order?._id;
  const itemId = orderRes.body?.data?.order?.items?.[0]?._id;
  const deliveredAt = new Date();
  await Order.updateOne({ _id: orderId }, { $set: { status: 'delivered', 'items.0.deliveredAt': deliveredAt, 'items.0.returnEligibleUntil': new Date(deliveredAt.getTime() + 7 * 864e5) } });

  const ret = await createReturnRequest({ orderId, orderItemId: itemId, customerId: customer._id, quantity: 1, reason: 'DAMAGED' });
  const adminId = new mongoose.Types.ObjectId();
  await transitionReturnStatus({ returnId: ret._id, toStatus: 'UNDER_REVIEW', adminId });
  await transitionReturnStatus({ returnId: ret._id, toStatus: 'APPROVED', adminId });
  await arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id });
  await broadcastReturnPickupToRiders(String(ret._id), 1);

  {
    const fresh = await Return.findById(ret._id).lean();
    check('15. rider at capacity does not receive the return pickup offer', !(fresh.pickup.offerAttempts || []).some((o) => String(o.riderId) === String(rider._id)));
  }

  // ---- 17. capacity frees after completion (return pickup) ----
  await Delivery.updateOne({ _id: busyDelivery._id }, { $set: { status: 'delivered' } });
  {
    const cap = await canTakeAnother(rider._id);
    check('17. capacity frees after return pickup completes', cap.ok === true);
  }

  // ---- 16. forward capacity: a busy forward order blocks, completing frees it ----
  // (run only now that the return pickup above is freed, so this isolates the forward signal)
  {
    await Cart.deleteMany({ userId: customer._id });
    await Product.updateOne({ _id: product._id }, { $set: { stock: 50, 'variants.0.stock': 50 } });
    await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng } });
    const fwdOrderRes = await call(createOrder, {
      user: customer, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    const fwdOrderId = fwdOrderRes.body?.data?.order?._id;
    await Order.updateOne({ _id: fwdOrderId }, { $set: { deliveryPartnerId: rider._id, status: 'dispatched' } });
    { const cap = await canTakeAnother(rider._id); check('16. an active forward order blocks capacity (limit=1)', cap.ok === false); }
    await Order.updateOne({ _id: fwdOrderId }, { $set: { status: 'delivered' } });
    { const cap = await canTakeAnother(rider._id); check('16. capacity frees after forward delivery completes', cap.ok === true); }
    await Order.deleteOne({ _id: fwdOrderId });
  }

  // Now the SAME rider, freed up, CAN accept this return pickup.
  {
    const { ret: accepted } = await acceptReturnPickup({ returnId: ret._id, partnerId: rider._id });
    check('accept succeeds once capacity is free', accepted.pickup.status === 'ASSIGNED');
  }

  // ---- 18/20. two riders cannot accept the same return; a stale accept is rejected ----
  const rider2User = await User.create({
    name: 'Cap Rider2', email: `cap_rider2_${Date.now()}@test.com`, phone: `4${Date.now().toString().slice(-9)}`, password: 'x', role: 'customer',
  });
  const rider2 = await DeliveryPartner.create({
    userId: rider2User._id, status: 'approved', isAvailable: true, vehicleType: 'bike',
    baseLocation: { lat: RIDER_LOC.lat, lng: RIDER_LOC.lng, source: 'gps', point: toGeoPoint(RIDER_LOC.lat, RIDER_LOC.lng) },
  });
  try {
    await acceptReturnPickup({ returnId: ret._id, partnerId: rider2._id });
    check('18/20. second/stale accept on an already-assigned return is rejected', false);
  } catch (err) {
    check('18/20. second/stale accept on an already-assigned return is rejected', err.status === 409);
  }

  // ---- 19. forward capacity check unaffected by an UNRELATED rider's return pickup (isolation) ----
  {
    const cap = await canTakeAnother(rider2._id);
    check('19. an unrelated rider\'s capacity is untouched by another rider\'s return pickup', cap.ok === true);
  }

  // ---- cleanup ----
  if (originalLimitEnv === undefined) delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES;
  else process.env.RIDER_MAX_CONCURRENT_DELIVERIES = originalLimitEnv;

  await Return.deleteMany({ orderId });
  await Delivery.deleteMany({ partnerId: { $in: [rider._id, rider2._id] } });
  await Order.deleteOne({ _id: orderId });
  await Cart.deleteMany({ userId: customer._id });
  await User.deleteMany({ _id: { $in: [customer._id, riderUser._id, rider2User._id] } });
  await DeliveryPartner.deleteMany({ _id: { $in: [rider._id, rider2._id] } });
  await Product.deleteOne({ _id: product._id });
  await CategoryReturnPolicy.deleteMany({ categoryId: header._id });
  await Category.deleteMany({ _id: { $in: [header._id, leaf._id] } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
