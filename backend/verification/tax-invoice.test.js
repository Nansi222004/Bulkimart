// GST invoices: one per seller on a delivered order, built from the frozen GST snapshot and numbered
// once per seller per financial year.
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
process.env.PAYMENT_GATEWAY = 'razorpay'; process.env.RAZORPAY_MODE = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_gst_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture-razorpay-secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'fixture-webhook-secret';
const push = jest.fn(async () => ({ success: true }));
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification: push, sendBulkNotification: push }));
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToSeller: jest.fn(), emitToRider: jest.fn(), emitToUser: jest.fn(), emitToAdmins: jest.fn(), broadcastToRiders: jest.fn() }));
const { default: orderRoutes } = await import('../routes/order.routes.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { requestContext } = await import('../middlewares/requestContext.middleware.js');
const { JWT_SECRET } = await import('../config/jwt.js');
const { default: User } = await import('../models/User.js'); const { default: Seller } = await import('../models/Seller.js');
const { default: Product } = await import('../models/Product.js'); const { default: Cart } = await import('../models/Cart.js');
const { default: Order } = await import('../models/Order.js');
const { default: TaxInvoice, InvoiceCounter } = await import('../models/TaxInvoice.js');
const { sellerOrderInvoice, financialYearOf, buildInvoiceDocument } = await import('../services/taxInvoice.service.js');
const { resolveIndianState } = await import('../utils/indianStates.js');
const app = express(); app.use(requestContext); app.use(express.json()); app.use('/api/orders', orderRoutes); app.use(errorHandler);

let db, buyer, seller, otherSeller; const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 };
const tokenFor = user => 'Bearer ' + jwt.sign({ id: user._id, type: 'user', role: 'buyer' }, JWT_SECRET);
const auth = req => req.set('Authorization', tokenFor(buyer));
const makeSeller = async (name, phone) => { const user = await User.create({ name, phone, roles: ['buyer', 'seller'], isActive: true }); const sid = id();
  await Seller.collection.insertOne({ _id: sid, userId: user._id, businessName: name, status: 'approved', storeDetails: { name, pincode: '400001', city: 'Mumbai', lat: 19.1, lng: 72.9 }, thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' } });
  return Seller.findById(sid); };
const makeProduct = (owner, name, price, gst) => Product.create({ sellerId: owner._id, type: 'ecommerce', category: id(), name, price, stock: 20, unit: 'piece', status: 'approved', isActive: true,
  fulfillmentType: 'physical', ...gst, variants: [{ name: 'One', sku: `${name}-1`.replace(/\W/g, ''), price, mrp: price, stock: 20, weight: 500, unit: 'piece' }] });
const fill = async lines => Cart.create({ userId: buyer._id, channel: 'ecommerce', items: lines.map(([product, qty]) => ({ productId: product._id, variantId: product.variants[0]._id, sellerId: product.sellerId, name: product.name, price: product.variants[0].price, qty })) });
const place = () => auth(request(app).post('/api/orders/unified')).set('Idempotency-Key', randomUUID()).send({ shippingAddress: address, channel: 'ecommerce', paymentMethod: 'cod' });
const ordersOf = res => Order.find({ _id: { $in: (res.body.data.orders || [res.body.data.order]).map(o => o._id) } }).sort({ _id: 1 });
const deliver = order => Order.collection.updateOne({ _id: order._id }, { $set: { status: 'delivered', deliveredAt: new Date('2026-10-20T10:00:00Z') } });
const invoices = (order, as = buyer) => request(app).get(`/api/orders/${order._id}/invoices`).set('Authorization', tokenFor(as));
// Invoices are dated when issued, so numbers carry the current financial year.
const FY_CODE = financialYearOf(new Date()).replace('-', '').slice(2);
const ownedBy = (orders, owner) => orders.find(o => o.items.some(i => String(i.sellerId) === String(owner._id)));
const placeTwoSellers = async () => {
  const soap = await makeProduct(seller, 'Soap', 118, { gstRate: 18 });
  const rice = await makeProduct(otherSeller, 'Rice', 105, { gstRate: 5 });
  await fill([[soap, 2], [rice, 1]]);
  const res = await place(); expect(res.status).toBe(201);
  return ordersOf(res);
};

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init())); await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], wallet: { balance: 100000 }, isActive: true });
  seller = await makeSeller('GST Store', '9876500001'); otherSeller = await makeSeller('Other Store', '9876500002');
});

test('states are recognised by name or short form, and financial years run April to March in India time', () => {
  expect(resolveIndianState('Mp')).toEqual({ code: '23', name: 'Madhya Pradesh' });
  expect(resolveIndianState(' madhya-pradesh ')).toEqual({ code: '23', name: 'Madhya Pradesh' });
  expect(resolveIndianState('Jammu & Kashmir').code).toBe('01');
  expect(resolveIndianState('Atlantis')).toBeNull();
  expect(financialYearOf(new Date('2026-03-31T18:29:00Z'))).toBe('2025-26'); // 23:59 IST, 31 March
  expect(financialYearOf(new Date('2026-03-31T18:31:00Z'))).toBe('2026-27'); // 00:01 IST, 1 April
});

test('no invoice before delivery, and none for another customer', async () => {
  const [order] = await placeTwoSellers();
  const early = await invoices(order); expect(early.status).toBe(409); expect(early.body.message).toBe('An invoice is available once the order is delivered');
  await deliver(order);
  const stranger = await User.create({ name: 'Stranger', phone: '9876500099', roles: ['buyer'], isActive: true });
  expect((await invoices(order, stranger)).status).toBe(403);
  expect(await TaxInvoice.countDocuments()).toBe(0);
});

test('registered seller in the same state: Tax Invoice with CGST + SGST; unregistered seller: plain invoice without GST', async () => {
  await Seller.collection.updateOne({ _id: seller._id }, { $set: { gstin: '27ABCDE1234F1Z5', 'storeDetails.state': 'Maharashtra' } });
  const orders = await placeTwoSellers();
  const all = [];
  for (const order of orders) { await deliver(order); const res = await invoices(order); expect(res.status).toBe(200); all.push(...res.body.data); }
  const registered = all.find(inv => String(inv.sellerId) === String(seller._id)), plain = all.find(inv => String(inv.sellerId) === String(otherSeller._id));
  expect(registered).toMatchObject({ kind: 'tax_invoice', invoiceNumber: `INV${FY_CODE}-000001`, financialYear: financialYearOf(new Date()) });
  expect(registered.document).toMatchObject({ title: 'Tax Invoice', gstSplit: 'cgst_sgst', pricesIncludeGst: true, placeOfSupply: 'Maharashtra (27)',
    seller: { gstin: '27ABCDE1234F1Z5', stateCode: '27' },
    totals: { grossPaise: 23600, taxableValuePaise: 20000, gstPaise: 3600, cgstPaise: 1800, sgstPaise: 1800, igstPaise: 0 } });
  expect(registered.document.lines).toEqual([expect.objectContaining({ description: 'Soap — One', qty: 2, unitPricePaise: 11800, gstRate: 18, gstPaise: 3600 })]);
  expect(registered.document.notes.join(' ')).toMatch(/carry no GST/);
  // Numbers run per seller, so each seller's first invoice is 000001.
  expect(plain).toMatchObject({ kind: 'invoice', invoiceNumber: `INV${FY_CODE}-000001` });
  expect(plain.document).toMatchObject({ title: 'Invoice', gstSplit: 'none', seller: { gstin: null }, totals: { grossPaise: 10500 } });
  expect(plain.document.totals).not.toHaveProperty('gstPaise');
  expect(plain.document.lines[0]).not.toHaveProperty('gstPaise');
  // Asking again returns the same stored invoices.
  const again = await invoices(ownedBy(orders, seller));
  expect(again.body.data.find(inv => String(inv.sellerId) === String(seller._id)).invoiceNumber).toBe(`INV${FY_CODE}-000001`);
  expect(await TaxInvoice.countDocuments()).toBe(2);
});

test('registered seller in another state charges IGST; an unknown state shows GST in total only', async () => {
  await Seller.collection.updateOne({ _id: seller._id }, { $set: { gstin: '23ABCDE1234F1Z5', 'storeDetails.state': 'Mp' } });
  const order = ownedBy(await placeTwoSellers(), seller).toObject(), sellerDoc = await Seller.findById(seller._id).lean();
  expect(buildInvoiceDocument({ order, seller: sellerDoc, issuedAt: new Date(), invoiceNumber: 'X' }))
    .toMatchObject({ gstSplit: 'igst', seller: { stateCode: '23' }, totals: { gstPaise: 3600, igstPaise: 3600, cgstPaise: 0, sgstPaise: 0 } });
  expect(buildInvoiceDocument({ order: { ...order, shippingAddress: { ...order.shippingAddress, state: 'Somewhere' } }, seller: sellerDoc, issuedAt: new Date(), invoiceNumber: 'X' }))
    .toMatchObject({ gstSplit: 'undetermined', totals: { gstPaise: 3600, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 } });
});

test('an invoice is issued once: simultaneous requests share one number, and numbers never skip', async () => {
  const order = ownedBy(await placeTwoSellers(), seller);
  await deliver(order);
  const results = await Promise.all(Array.from({ length: 5 }, () => sellerOrderInvoice(order._id, seller._id)));
  expect(new Set(results.map(inv => inv.invoiceNumber))).toEqual(new Set([`INV${FY_CODE}-000001`]));
  expect(await TaxInvoice.countDocuments({ sellerId: seller._id })).toBe(1);
  expect((await InvoiceCounter.findOne({ sellerId: seller._id })).sequence).toBe(1);
  // The seller's next delivered order gets the next number.
  const soap = await Product.findOne({ name: 'Soap' }); await Cart.deleteMany({}); await fill([[soap, 1]]);
  const [next] = await ordersOf(await place()); await deliver(next);
  expect((await sellerOrderInvoice(next._id, seller._id)).invoiceNumber).toBe(`INV${FY_CODE}-000002`);
  // A seller cannot read an invoice for an order without their items, and stored invoices cannot be edited.
  await expect(sellerOrderInvoice(next._id, otherSeller._id)).rejects.toThrow('Order not found');
  await expect(TaxInvoice.updateOne({ orderId: next._id }, { $set: { invoiceNumber: 'X' } })).rejects.toThrow('Tax invoices are immutable');
});

test('older orders without a GST snapshot get no invoice', async () => {
  const [order] = await placeTwoSellers();
  await Order.collection.updateOne({ _id: order._id }, { $unset: { productTax: '' }, $set: { deliveredAt: new Date() } });
  const res = await invoices(order); expect(res.status).toBe(409); expect(res.body.message).toBe('An invoice is available for orders placed after GST invoicing started');
});
