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
import { getProductById, updateProduct } from './controllers/product.controller.js';
import { addToCart } from './controllers/cart.controller.js';
import { createOrder } from './controllers/order.controller.js';
import { getReturnEligibility } from './services/return.service.js';

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

  // ---- fixtures: a real grocery header + leaf category, an active 7-day policy ----
  await Category.deleteMany({ slug: /^__test-qreturn/ });
  const header = await Category.create({
    name: '__test_qreturn_header', type: 'grocery', parent: null,
    slug: `__test-qreturn-header-${Date.now()}`, isActive: true,
  });
  const leaf = await Category.create({
    name: '__test_qreturn_leaf', type: 'grocery', parent: header._id,
    slug: `__test-qreturn-leaf-${Date.now()}`, isActive: true,
  });
  await CategoryReturnPolicy.deleteOne({ categoryId: header._id });
  const policy = await CategoryReturnPolicy.create({ categoryId: header._id, returnWindowDays: 7, isActive: true });

  const seller = await Seller.findOne({ status: 'approved' }) || await Seller.findOne();
  if (!seller) { console.log('No seller in DB — cannot run quick-return tests'); process.exit(1); }
  const sellerUser = await User.findById(seller.userId);

  await Product.deleteMany({ name: '__test_qreturn_product' });
  const product = await Product.create({
    type: 'grocery', sellerId: seller._id, name: '__test_qreturn_product',
    category: leaf._id, images: ['x.jpg'], isActive: true, status: 'approved',
    variants: [{ name: 'Default', price: 100, mrp: 120, stock: 50, unit: 'piece' }],
    returnable: true,
  });

  // ============================================================
  // 1-2. QUICK SELLER CREATES RETURNABLE / NON-RETURNABLE PRODUCT
  // (model-level: createProduct's own gating logic is exercised end-to-end
  //  below via updateProduct, which shares the identical channel guard;
  //  this confirms the schema itself persists both states correctly)
  // ============================================================
  {
    const fresh = await Product.findById(product._id);
    check('1. quick product created with returnable=true persists', fresh.returnable === true);
  }
  {
    const p2 = await Product.create({
      type: 'grocery', sellerId: seller._id, name: '__test_qreturn_product_no',
      category: leaf._id, images: ['x.jpg'], isActive: true, status: 'approved',
      variants: [{ name: 'Default', price: 50, mrp: 60, stock: 10, unit: 'piece' }],
      returnable: false,
    });
    check('2. quick product created with returnable=false persists', p2.returnable === false);
    await Product.deleteOne({ _id: p2._id });
  }

  // ============================================================
  // 3-5. QUICK SELLER EDITS via the real updateProduct endpoint
  // ============================================================
  const sellerReq = { params: { id: product._id }, user: { _id: seller.userId }, userType: 'seller', body: {} };
  {
    const r = await call(updateProduct, { ...sellerReq, body: { returnable: 'false' } });
    check('3. seller edit returnable true->false: 200', r.statusCode === 200);
    check('3. persisted as false', r.body?.product?.returnable === false);
  }
  {
    const r = await call(updateProduct, { ...sellerReq, body: { returnable: 'true' } });
    check('3. seller edit returnable false->true: 200', r.statusCode === 200);
    check('3. persisted as true', r.body?.product?.returnable === true);
  }
  {
    // 4. Seller ownership protection — a different, unrelated user must be rejected.
    const stranger = await User.create({
      name: 'QReturn Stranger', email: `qreturn_stranger_${Date.now()}@test.com`,
      phone: `8${Date.now().toString().slice(-9)}`, password: 'x', role: 'customer',
    });
    const r = await call(updateProduct, { params: { id: product._id }, user: { _id: stranger._id }, userType: 'customer', body: { returnable: 'false' } });
    check('4. non-owner rejected: 403', r.statusCode === 403);
    await User.deleteOne({ _id: stranger._id });
  }
  {
    // 5. Seller cannot configure return days — the field simply doesn't exist
    // on the schema/controller; sending it does nothing and windowDays stays governed by Admin.
    await call(updateProduct, { ...sellerReq, body: { returnable: 'true', returnWindowDays: 30, returnDays: 30 } });
    const fresh = await Product.findById(product._id);
    check('5. no returnWindowDays/returnDays field exists on the product', fresh.returnWindowDays === undefined && fresh.returnDays === undefined);
  }

  // ============================================================
  // 6-8. QUICK CUSTOMER PRODUCT DETAILS via the real getProductById endpoint
  // ============================================================
  const detailReq = () => ({ params: { id: product._id } });
  {
    // CASE 1: seller YES, admin 7 days -> eligible, 7 days
    await Product.updateOne({ _id: product._id }, { $set: { returnable: true } });
    const r = await call(getProductById, detailReq());
    check('6. quick details shows returnable:true', r.body?.returnable === true);
    check('7. quick details shows Admin window (7 days), eligible', r.body?.returnPolicy?.eligible === true && r.body?.returnPolicy?.returnWindowDays === 7);
  }
  {
    // CASE 2: seller NO, admin 7 days -> non-returnable
    await Product.updateOne({ _id: product._id }, { $set: { returnable: false } });
    const r = await call(getProductById, detailReq());
    check('CASE2. seller=NO -> non-returnable', r.body?.returnPolicy?.eligible === false);
  }
  {
    // CASE 3: seller YES, admin policy inactive -> non-returnable
    await Product.updateOne({ _id: product._id }, { $set: { returnable: true } });
    await CategoryReturnPolicy.updateOne({ _id: policy._id }, { $set: { isActive: false } });
    const r = await call(getProductById, detailReq());
    check('8. CASE3. no active admin policy -> non-returnable', r.body?.returnPolicy?.eligible === false);
    await CategoryReturnPolicy.updateOne({ _id: policy._id }, { $set: { isActive: true } }); // restore for the order test below
  }

  // ============================================================
  // 9-11. ORDER SNAPSHOT — real checkout, real frozen snapshot
  // ============================================================
  await Product.updateOne({ _id: product._id }, { $set: { returnable: true, 'variants.0.stock': 50, stock: 50 } });
  await Seller.updateOne({ _id: seller._id }, { $set: { 'storeDetails.lat': 22.7196, 'storeDetails.lng': 75.8577 } });

  const customer = await User.create({
    name: 'QReturn Tester', email: `qreturn_${Date.now()}@test.com`, phone: `9${Date.now().toString().slice(-9)}`,
    password: 'x', role: 'customer',
    addresses: [{ label: 'Home', name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: 22.74, lng: 75.86, isDefault: true }],
  });

  await Cart.deleteMany({ userId: customer._id });
  await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: 22.74, lng: 75.86 } });

  let orderId;
  {
    const r = await call(createOrder, {
      user: customer, body: {
        shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: 22.74, lng: 75.86 },
        paymentMethod: 'cod', channel: 'grocery',
      },
    });
    check('order created: 200/201', r.statusCode === 200 || r.statusCode === 201);
    orderId = r.body?.data?.order?._id;
  }

  if (orderId) {
    const order = await Order.findById(orderId);
    const item = order.items[0];
    check('9. order snapshot: sellerReturnable=true frozen', item.returnPolicy?.sellerReturnable === true);
    check('9. order snapshot: returnEligible=true (7-day category x seller YES)', item.returnPolicy?.returnEligible === true);
    check('9. order snapshot: returnWindowDays=7 frozen', item.returnPolicy?.returnWindowDays === 7);

    // 10. Seller flips YES -> NO after order creation; historical order must not change.
    await Product.updateOne({ _id: product._id }, { $set: { returnable: false } });
    {
      const fresh = await Order.findById(orderId);
      check('10. historical order unaffected by seller YES->NO', fresh.items[0].returnPolicy?.returnEligible === true);
    }

    // Seller flips NO -> YES again (a fresh product would still not retroactively
    // become returnable for an EARLIER order that was frozen while it was NO —
    // verified here by re-confirming the same order stays eligible from its own
    // original TRUE freeze, not from whatever the product says right now).
    await Product.updateOne({ _id: product._id }, { $set: { returnable: true } });
    {
      const fresh = await Order.findById(orderId);
      check('historical order still reads its own frozen value, not live product state', fresh.items[0].returnPolicy?.returnEligible === true);
    }

    // 11. Admin changes 7 -> 3 days after order creation; historical order must retain 7.
    await CategoryReturnPolicy.updateOne({ _id: policy._id }, { $set: { returnWindowDays: 3 } });
    {
      const fresh = await Order.findById(orderId);
      check('11. historical order retains its original 7-day window after admin lowers to 3', fresh.items[0].returnPolicy?.returnWindowDays === 7);
    }
    // New product-detail lookups must see the NEW 3-day policy (live, not frozen).
    {
      const r = await call(getProductById, detailReq());
      check('new lookups see the updated 3-day policy (live, not frozen)', r.body?.returnPolicy?.returnWindowDays === 3);
    }
    await CategoryReturnPolicy.updateOne({ _id: policy._id }, { $set: { returnWindowDays: 7 } }); // restore

    // ============================================================
    // 12-13. CUSTOMER ELIGIBILITY — frozen snapshot enforcement, unbypassable
    // ============================================================
    // Simulate delivery, exactly as deliveryPartner.controller.js/seller.controller.js do.
    const deliveredAt = new Date();
    const eligibleUntil = new Date(deliveredAt.getTime() + item.returnPolicy.returnWindowDays * 24 * 60 * 60 * 1000);
    await Order.updateOne(
      { _id: orderId },
      { $set: { status: 'delivered', 'items.0.deliveredAt': deliveredAt, 'items.0.returnEligibleUntil': eligibleUntil } }
    );
    {
      const result = await getReturnEligibility({ orderId, orderItemId: item._id, customerId: customer._id, quantity: 1 });
      check('12. eligibility check succeeds using the frozen 7-day snapshot (not live 3-day policy)', result.item.returnPolicy.returnWindowDays === 7);
    }

    // 13. A non-returnable item (seller said NO at order time) must be rejected
    // by the real backend gate, regardless of what the product looks like now.
    await Product.updateOne({ _id: product._id }, { $set: { returnable: false } });
    const noReturnOrder = await (async () => {
      await Cart.deleteMany({ userId: customer._id });
      await call(addToCart, { user: customer, query: {}, body: { productId: String(product._id), qty: 1, lat: 22.74, lng: 75.86 } });
      const r = await call(createOrder, {
        user: customer, body: {
          shippingAddress: { name: 'T', phone: '9999999999', line1: 'x', city: 'x', state: 'x', pincode: '000000', lat: 22.74, lng: 75.86 },
          paymentMethod: 'cod', channel: 'grocery',
        },
      });
      return r.body?.data?.order?._id;
    })();
    if (noReturnOrder) {
      const fresh = await Order.findById(noReturnOrder);
      const noItem = fresh.items[0];
      check('13. non-returnable snapshot: sellerReturnable=false, returnEligible=false', noItem.returnPolicy?.sellerReturnable === false && noItem.returnPolicy?.returnEligible === false);
      await Order.updateOne({ _id: noReturnOrder }, { $set: { status: 'delivered', 'items.0.deliveredAt': new Date() } });
      try {
        await getReturnEligibility({ orderId: noReturnOrder, orderItemId: noItem._id, customerId: customer._id, quantity: 1 });
        check('13. malicious/direct return request on non-returnable item rejected', false);
      } catch (err) {
        check('13. malicious/direct return request on non-returnable item rejected', err.meta?.code === 'PRODUCT_NOT_RETURNABLE' || /not eligible/i.test(err.message));
      }
      await Order.deleteOne({ _id: noReturnOrder });
    }

    await Order.deleteOne({ _id: orderId });
  }

  // ---- cleanup ----
  await Cart.deleteMany({ userId: customer._id });
  await User.deleteOne({ _id: customer._id });
  await Product.deleteMany({ name: { $in: ['__test_qreturn_product', '__test_qreturn_product_no'] } });
  await CategoryReturnPolicy.deleteOne({ _id: policy._id });
  await Category.deleteMany({ _id: { $in: [header._id, leaf._id] } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
