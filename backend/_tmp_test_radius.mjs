import 'dotenv/config';
import mongoose from 'mongoose';
import Seller from './models/Seller.js';
import DeliveryPartner from './models/DeliveryPartner.js';
import Product from './models/Product.js';
import Category from './models/Category.js';
import User from './models/User.js';
import Cart from './models/Cart.js';
import Order from './models/Order.js';
import { setSellerRadius, setDeliveryPartnerRadius } from './controllers/admin.controller.js';
import { addToCart } from './controllers/cart.controller.js';
import { createOrder } from './controllers/order.controller.js';
import { isWithinRadius } from './services/radius.service.js';

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

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // ---- unit: isWithinRadius ----
  check('unit: within (3km <= 5km)', isWithinRadius({ lat: 22.72, lng: 75.86 }, { lat: 22.75, lng: 75.86 }, 5) === true);
  check('unit: outside (far apart, radius 5km)', isWithinRadius({ lat: 22.72, lng: 75.86 }, { lat: 23.5, lng: 76.5 }, 5) === false);
  check('unit: undefined radius = unrestricted', isWithinRadius({ lat: 22.72, lng: 75.86 }, { lat: 30, lng: 80 }, undefined) === true);
  check('unit: missing coords = false', isWithinRadius(undefined, { lat: 1, lng: 1 }, 5) === false);
  check('unit: boundary distance === radius is WITHIN',
    isWithinRadius({ lat: 22.72, lng: 75.86 }, { lat: 22.72, lng: 75.86 }, 0) === true); // 0km apart, 0 radius

  // ---- admin seller radius CRUD/validation ----
  const seller = await Seller.findOne();
  const originalRadius = seller.serviceRadiusKm;

  { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: -5 } }); check('seller radius -5 rejected: 400', r.statusCode === 400); }
  { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 0 } }); check('seller radius 0 rejected: 400', r.statusCode === 400); }
  { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 'abc' } }); check('seller radius "abc" rejected: 400', r.statusCode === 400); }
  { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 9999 } }); check('seller radius >max rejected: 400', r.statusCode === 400); }
  { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 5 } }); check('seller radius 5 accepted: 200', r.statusCode === 200); check('seller radius saved as 5', r.body?.data?.serviceRadiusKm === 5); }

  // ---- admin delivery-partner radius CRUD/validation ----
  const partner = await DeliveryPartner.findOne();
  if (partner) {
    { const r = await call(setDeliveryPartnerRadius, { params: { id: partner._id }, body: { radiusKm: -1 } }); check('partner radius -1 rejected: 400', r.statusCode === 400); }
    { const r = await call(setDeliveryPartnerRadius, { params: { id: partner._id }, body: { radiusKm: 8 } }); check('partner radius 8 accepted: 200', r.statusCode === 200); }
    { const r = await call(setDeliveryPartnerRadius, { params: { id: partner._id }, body: { radiusKm: null } }); check('partner radius clear (null): 200', r.statusCode === 200); check('partner radius cleared to undefined', r.body?.data?.deliveryRadiusKm === undefined); }
  } else {
    console.log('(no delivery partner in DB — skipping partner radius CRUD checks)');
  }

  // ---- addToCart / createOrder enforcement ----
  await Category.deleteMany({ name: '__test_radius_cat' });
  const cat = await Category.create({ name: '__test_radius_cat', type: 'grocery', slug: `__test-radius-cat-${Date.now()}`, isActive: true });

  // Seller with a real pinned location (Indore-ish) + 5km radius
  await Seller.updateOne({ _id: seller._id }, { $set: { serviceRadiusKm: 5, 'storeDetails.lat': 22.7196, 'storeDetails.lng': 75.8577 } });

  const product = await Product.create({
    name: '__test_radius_product', sellerId: seller._id, price: 200, stock: 10,
    category: cat._id, type: 'grocery', images: ['x.jpg'], isActive: true, status: 'approved',
  });

  const nearAddr = { lat: 22.74, lng: 75.86 };  // ~2.3km away
  const farAddr = { lat: 23.2, lng: 76.4 };     // ~70km away

  const user = await User.create({
    name: 'Radius Tester', email: `rad_${Date.now()}@test.com`, phone: `9${Date.now().toString().slice(-9)}`,
    password: 'x', role: 'customer',
    addresses: [{ label: 'Home', name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: farAddr.lat, lng: farAddr.lng, isDefault: true }],
  });

  await Cart.deleteMany({ userId: user._id });
  // Add to cart with an explicit near address (body lat/lng) -> should succeed even though default saved address is far
  { const r = await call(addToCart, { user, query: {}, body: { productId: String(product._id), qty: 1, lat: nearAddr.lat, lng: nearAddr.lng } });
    check('addToCart within radius (explicit near coords): 200', r.statusCode === 200); }

  await Cart.deleteMany({ userId: user._id });
  // Add to cart with NO explicit coords -> falls back to user's default (far) address -> should be rejected
  { const r = await call(addToCart, { user, query: {}, body: { productId: String(product._id), qty: 1 } });
    check('addToCart outside radius (fallback to far default address): 409', r.statusCode === 409); }

  // Add to cart with explicit near coords again, so we have something in the cart for createOrder tests
  await Cart.deleteMany({ userId: user._id });
  await call(addToCart, { user, query: {}, body: { productId: String(product._id), qty: 1, lat: nearAddr.lat, lng: nearAddr.lng } });

  // createOrder: shipping address FAR -> rejected even though cart add succeeded near
  {
    const r = await call(createOrder, {
      user, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: farAddr.lat, lng: farAddr.lng },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    check('createOrder with far shipping address: 409', r.statusCode === 409);
  }

  // createOrder: shipping address NEAR -> succeeds
  {
    const r = await call(createOrder, {
      user, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: nearAddr.lat, lng: nearAddr.lng },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    check('createOrder with near shipping address: 200/201', r.statusCode === 200 || r.statusCode === 201);
    if (r.body?.data?.order?._id) await Order.deleteOne({ _id: r.body.data.order._id });
  }

  // Widen radius 5km -> 100km, far address should now succeed
  await Seller.updateOne({ _id: seller._id }, { $set: { serviceRadiusKm: 100 } });
  await Cart.deleteMany({ userId: user._id });
  await call(addToCart, { user, query: {}, body: { productId: String(product._id), qty: 1, lat: nearAddr.lat, lng: nearAddr.lng } });
  {
    const r = await call(createOrder, {
      user, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: farAddr.lat, lng: farAddr.lng },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    check('after widening radius 5->100km, far address now succeeds: 200/201', r.statusCode === 200 || r.statusCode === 201);
    if (r.body?.data?.order?._id) await Order.deleteOne({ _id: r.body.data.order._id });
  }

  // restore seller state
  await Seller.updateOne({ _id: seller._id }, { $set: { serviceRadiusKm: originalRadius ?? undefined } });
  if (originalRadius === undefined) await Seller.updateOne({ _id: seller._id }, { $unset: { serviceRadiusKm: '' } });

  await Product.deleteOne({ _id: product._id });
  await Category.deleteOne({ _id: cat._id });
  await Cart.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
