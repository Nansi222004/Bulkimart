import 'dotenv/config';
import { setServers } from 'dns';
if (process.env.NODE_ENV !== 'production') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
import mongoose from 'mongoose';
import Category from './models/Category.js';
import CategoryReturnPolicy from './models/CategoryReturnPolicy.js';
import Product from './models/Product.js';
import Seller from './models/Seller.js';
import User from './models/User.js';
import Cart from './models/Cart.js';
import Order from './models/Order.js';
import DeliveryPartner from './models/DeliveryPartner.js';
import Delivery from './models/Delivery.js';
import Return from './models/Return.js';
import { toGeoPoint } from './models/geoPoint.schema.js';
import { addToCart } from './controllers/cart.controller.js';
import { createOrder } from './controllers/order.controller.js';
import { createReturnRequest, transitionReturnStatus, getReturnEligibility } from './services/return.service.js';
import {
  arrangeReturnPickup, broadcastReturnPickupToRiders, acceptReturnPickup, declineReturnPickup,
  generateReturnPickupOtp, verifyReturnPickupOtp, markReturnDeliveredToSeller,
} from './services/returnPickup.service.js';

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

const CUSTOMER_LOC = { lat: 22.74, lng: 75.86 };
const SHOP_LOC = { lat: 22.7196, lng: 75.8577 };
const RIDER_LOC = { lat: 22.735, lng: 75.855 }; // a couple km from the customer

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // ---- fixtures ----
  await Category.deleteMany({ slug: /^__test-rpu/ });
  const header = await Category.create({ name: '__test_rpu_header', type: 'grocery', parent: null, slug: `__test-rpu-header-${Date.now()}`, isActive: true });
  const leaf = await Category.create({ name: '__test_rpu_leaf', type: 'grocery', parent: header._id, slug: `__test-rpu-leaf-${Date.now()}`, isActive: true });
  await CategoryReturnPolicy.deleteOne({ categoryId: header._id });
  await CategoryReturnPolicy.create({ categoryId: header._id, returnWindowDays: 7, isActive: true });

  const seller = await Seller.findOne({ status: 'approved' }) || await Seller.findOne();
  if (!seller) { console.log('No seller in DB'); process.exit(1); }
  await Seller.updateOne({ _id: seller._id }, { $set: { 'storeDetails.lat': SHOP_LOC.lat, 'storeDetails.lng': SHOP_LOC.lng } });

  await Product.deleteMany({ name: '__test_rpu_product' });
  const product = await Product.create({
    type: 'grocery', sellerId: seller._id, name: '__test_rpu_product', category: leaf._id,
    images: ['x.jpg'], isActive: true, status: 'approved', returnable: true,
    variants: [{ name: 'Default', price: 100, mrp: 120, stock: 50, unit: 'piece' }],
  });

  const customer = await User.create({
    name: 'RPU Tester', email: `rpu_${Date.now()}@test.com`, phone: `9${Date.now().toString().slice(-9)}`,
    password: 'x', role: 'customer',
    addresses: [{ label: 'Home', name: 'T', phone: '9999999999', line1: 'Test Lane', city: 'Indore', state: 'MP', pincode: '452001', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng, isDefault: true }],
  });

  const strangerSeller = await Seller.findOne({ _id: { $ne: seller._id } });

  const riderUser = await User.create({
    name: 'RPU Rider', email: `rpu_rider_${Date.now()}@test.com`, phone: `8${Date.now().toString().slice(-9)}`, password: 'x', role: 'customer',
  });
  const rider = await DeliveryPartner.create({
    userId: riderUser._id, status: 'approved', isAvailable: true,
    vehicleType: 'bike',
    baseLocation: { lat: RIDER_LOC.lat, lng: RIDER_LOC.lng, source: 'gps', point: toGeoPoint(RIDER_LOC.lat, RIDER_LOC.lng) },
  });
  const rider2User = await User.create({
    name: 'RPU Rider2', email: `rpu_rider2_${Date.now()}@test.com`, phone: `7${Date.now().toString().slice(-9)}`, password: 'x', role: 'customer',
  });
  const rider2 = await DeliveryPartner.create({
    userId: rider2User._id, status: 'approved', isAvailable: true, vehicleType: 'bike',
    baseLocation: { lat: RIDER_LOC.lat, lng: RIDER_LOC.lng, source: 'gps', point: toGeoPoint(RIDER_LOC.lat, RIDER_LOC.lng) },
  });

  // ---- place + deliver a real order, create a real Return ----
  await Cart.deleteMany({ userId: customer._id });
  await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng } });
  const orderRes = await call(createOrder, {
    user: customer, body: {
      shippingAddress: { name: 'T', phone: '9999999999', line1: 'Test Lane', city: 'Indore', state: 'MP', pincode: '452001', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng },
      paymentMethod: 'cod', channel: 'grocery',
    },
  });
  check('setup: order created', orderRes.statusCode === 200 || orderRes.statusCode === 201);
  const orderId = orderRes.body?.data?.order?._id;
  const itemId = orderRes.body?.data?.order?.items?.[0]?._id;

  const deliveredAt = new Date();
  const eligibleUntil = new Date(deliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  await Order.updateOne({ _id: orderId }, { $set: { status: 'delivered', 'items.0.deliveredAt': deliveredAt, 'items.0.returnEligibleUntil': eligibleUntil } });

  const ret = await createReturnRequest({ orderId, orderItemId: itemId, customerId: customer._id, quantity: 1, reason: 'DAMAGED', customerDescription: 'dented' });
  check('setup: return created, RETURN_REQUESTED', ret.status === 'RETURN_REQUESTED');

  const adminId = new mongoose.Types.ObjectId();

  // ============================================================
  // ADMIN gate — pickup cannot be arranged before approval
  // ============================================================
  try {
    await arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id });
    check('2. cannot arrange pickup before APPROVED', false);
  } catch (err) {
    check('2. cannot arrange pickup before APPROVED', err.meta?.code === 'RETURN_NOT_APPROVED');
  }

  // ---- Wrong seller rejected ----
  if (strangerSeller) {
    try {
      await arrangeReturnPickup({ returnId: ret._id, sellerId: strangerSeller._id });
      check('13. wrong seller cannot assign rider', false);
    } catch (err) {
      check('13. wrong seller cannot assign rider', err.status === 403);
    }
  } else {
    console.log('(only one seller in DB — skipping cross-seller check)');
  }

  await transitionReturnStatus({ returnId: ret._id, toStatus: 'UNDER_REVIEW', adminId });
  await transitionReturnStatus({ returnId: ret._id, toStatus: 'APPROVED', adminId });

  // ============================================================
  // SELLER arranges pickup -> BROADCAST -> offer created
  // ============================================================
  { const r = await arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id }); check('3. seller (correct) can arrange pickup', String(r._id) === String(ret._id)); }
  await broadcastReturnPickupToRiders(String(ret._id), 1);
  {
    const fresh = await Return.findById(ret._id).lean();
    check('16. rider receives return assignment (offer created)', (fresh.pickup.offerAttempts || []).some((o) => String(o.riderId) === String(rider._id) && o.status === 'OFFERED'));
  }

  // ============================================================
  // RIDER accept / decline / double-accept race
  // ============================================================
  { const { ret: accepted, delivery } = await acceptReturnPickup({ returnId: ret._id, partnerId: rider._id });
    check('17. rider accepts', accepted.pickup.status === 'ASSIGNED');
    check('24. Delivery created with direction return_pickup', delivery.direction === 'return_pickup');
    check('pickup/drop swapped correctly (pickup=customer, drop=seller)', Math.abs(delivery.pickupLocation.lat - CUSTOMER_LOC.lat) < 0.01 && Math.abs(delivery.dropLocation.lat - SHOP_LOC.lat) < 0.01);
  }

  // ---- now that a rider has actually accepted, re-arranging is rejected ----
  try {
    await arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id });
    check('15. seller cannot assign rider twice', false);
  } catch (err) {
    check('15. seller cannot assign rider twice', err.meta?.code === 'PICKUP_ALREADY_ASSIGNED');
  }
  {
    // 19. a second rider cannot accept the same (now-assigned) return
    try {
      await acceptReturnPickup({ returnId: ret._id, partnerId: rider2._id });
      check('19. second rider cannot accept same assignment', false);
    } catch (err) {
      check('19. second rider cannot accept same assignment', err.status === 409);
    }
  }

  // ============================================================
  // 18. RIDER DECLINES — a separate return, so it doesn't disturb the one above
  // ============================================================
  let ret2Id, ret2OrderId;
  {
    await Product.updateOne({ _id: product._id }, { $set: { stock: 50, 'variants.0.stock': 50 } });
    await Cart.deleteMany({ userId: customer._id });
    await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng } });
    const orderRes2 = await call(createOrder, {
      user: customer, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'Test Lane', city: 'Indore', state: 'MP', pincode: '452001', lat: CUSTOMER_LOC.lat, lng: CUSTOMER_LOC.lng },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    ret2OrderId = orderRes2.body?.data?.order?._id;
    const itemId2 = orderRes2.body?.data?.order?.items?.[0]?._id;
    await Order.updateOne({ _id: ret2OrderId }, { $set: { status: 'delivered', 'items.0.deliveredAt': deliveredAt, 'items.0.returnEligibleUntil': eligibleUntil } });

    const ret2 = await createReturnRequest({ orderId: ret2OrderId, orderItemId: itemId2, customerId: customer._id, quantity: 1, reason: 'DAMAGED' });
    ret2Id = ret2._id;
    await transitionReturnStatus({ returnId: ret2Id, toStatus: 'UNDER_REVIEW', adminId });
    await transitionReturnStatus({ returnId: ret2Id, toStatus: 'APPROVED', adminId });
    await arrangeReturnPickup({ returnId: ret2Id, sellerId: seller._id });
    await broadcastReturnPickupToRiders(String(ret2Id), 1);

    const declined = await declineReturnPickup({ returnId: ret2Id, partnerId: rider2._id, reason: 'too far' });
    check('18. rider declines', declined.pickup.offerAttempts.some((o) => String(o.riderId) === String(rider2._id) && o.status === 'DECLINED_BY_RIDER'));
    check('18. return remains awaiting another rider after a decline', declined.pickup.status === 'NOT_ASSIGNED');

    // a duplicate decline from the same rider is idempotent, not an error
    const declinedAgain = await declineReturnPickup({ returnId: ret2Id, partnerId: rider2._id, reason: 'still too far' });
    check('duplicate decline is idempotent', String(declinedAgain._id) === String(ret2Id));

    // the OTHER rider (still OFFERED) can still accept the same return
    const { ret: acceptedByOther } = await acceptReturnPickup({ returnId: ret2Id, partnerId: rider._id });
    check('a decline from one rider does not block another rider from accepting', acceptedByOther.pickup.status === 'ASSIGNED');
  }

  // ============================================================
  // PICKUP OTP
  // ============================================================
  try {
    await generateReturnPickupOtp({ returnId: ret._id, partnerId: rider2._id });
    check('wrong rider cannot generate OTP', false);
  } catch (err) {
    check('wrong rider cannot generate OTP', err.status === 403);
  }
  { const r = await generateReturnPickupOtp({ returnId: ret._id, partnerId: rider._id }); check('20. rider pickup OTP generated', r.sent === true); }

  const deliveryDoc = await Delivery.findOne({ returnId: ret._id });
  try {
    await verifyReturnPickupOtp({ returnId: ret._id, partnerId: rider._id, otp: '0000' });
    check('21. invalid OTP rejected', false);
  } catch (err) {
    check('21. invalid OTP rejected', err.meta?.code === 'WRONG_OTP');
  }
  { const { ret: verified } = await verifyReturnPickupOtp({ returnId: ret._id, partnerId: rider._id, otp: deliveryDoc.otp });
    check('20. rider pickup OTP works -> PICKED_UP', verified.pickup.status === 'PICKED_UP');
    check('23. customer pickup status updates (Return.pickedUpAt stamped)', !!verified.pickedUpAt);
  }

  // ============================================================
  // SELLER RECEIPT — only seller may confirm, only after PICKED_UP
  // ============================================================
  if (strangerSeller) {
    try {
      await markReturnDeliveredToSeller({ returnId: ret._id, sellerId: strangerSeller._id });
      check('50. customer/other-seller cannot mark seller receipt', false);
    } catch (err) {
      check('50. customer/other-seller cannot mark seller receipt', err.status === 403);
    }
  }
  { const r = await markReturnDeliveredToSeller({ returnId: ret._id, sellerId: seller._id });
    check('25. seller receives return (pickup DELIVERED_TO_SELLER)', r.pickup.status === 'DELIVERED_TO_SELLER');
    check('pickup.sellerConfirmedReceivedAt stamped', !!r.pickup.sellerConfirmedReceivedAt);
  }
  { const freshDelivery = await Delivery.findById(deliveryDoc._id);
    check('Delivery closed out (status delivered, earnings computed)', freshDelivery.status === 'delivered' && typeof freshDelivery.partnerEarnings === 'number');
    const freshRider = await DeliveryPartner.findById(rider._id);
    check('rider freed + totalDeliveries incremented', freshRider.isAvailable === true && freshRider.totalDeliveries === 1);
  }
  // 26. duplicate seller receipt prevented
  try {
    await markReturnDeliveredToSeller({ returnId: ret._id, sellerId: seller._id });
    check('26. duplicate seller receipt prevented', false);
  } catch (err) {
    check('26. duplicate seller receipt prevented', err.meta?.code === 'NOT_PICKED_UP');
  }

  // ============================================================
  // REGRESSION — none of this touched Return.status / restock / refund
  // ============================================================
  {
    const fresh = await Return.findById(ret._id);
    check('Return.status untouched by pickup lifecycle (still APPROVED)', fresh.status === 'APPROVED');
    check('restockStatus untouched (still NOT_PROCESSED)', fresh.restockStatus === 'NOT_PROCESSED');
    check('refundStatus untouched (still unset)', fresh.refundStatus === undefined);
  }

  // Admin's EXISTING, unchanged transition still works end-to-end afterward.
  await transitionReturnStatus({ returnId: ret._id, toStatus: 'AWAITING_RETURN', adminId });
  {
    const beforeStock = (await Product.findById(product._id)).stock;
    const r = await transitionReturnStatus({ returnId: ret._id, toStatus: 'RETURN_RECEIVED', adminId, restockDecision: 'RESTOCKABLE' });
    check('27. restock once (admin RETURN_RECEIVED, unchanged Return V1 path)', r.restockStatus === 'RESTOCKED');
    const afterStock = (await Product.findById(product._id)).stock;
    check('stock actually incremented by the returned quantity', afterStock === beforeStock + 1);
  }

  // ---- Authorization: eligibility check still respects the frozen snapshot ----
  {
    const check2 = await getReturnEligibility({ orderId, orderItemId: itemId, customerId: customer._id, quantity: 1 }).catch((e) => e);
    check('customer eligibility respects frozen snapshot (already fully returned -> exceeded)', check2 instanceof Error && check2.meta?.code === 'RETURN_QUANTITY_EXCEEDED');
  }

  // ---- cleanup ----
  await Return.deleteMany({ orderId: { $in: [orderId, ret2OrderId] } });
  await Delivery.deleteMany({ returnId: { $in: [ret._id, ret2Id] } });
  await Order.deleteMany({ _id: { $in: [orderId, ret2OrderId] } });
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
