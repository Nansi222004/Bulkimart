import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import Cart from '../../models/Cart.js';
import Product from '../../models/Product.js';
import User from '../../models/User.js';
import cartRoutes from '../../routes/cart.routes.js';
import { errorHandler } from '../../middlewares/error.middleware.js';
import { JWT_SECRET } from '../../config/jwt.js';

let memoryServer;
let app;
let shopper;
let otherShopper;
let groceryProduct;
let ecommerceProduct;
let authToken;
let otherAuthToken;
let dbReady = false;

const tokenFor = (userId) => jwt.sign({ id: String(userId), type: 'user' }, JWT_SECRET);
const cartUrl = (channel) => `/api/cart?channel=${channel}`;

beforeAll(async () => {
  // No URI from process.env is ever used here. If the isolated DB cannot start,
  // setup fails rather than falling back to a developer or production DB.
  memoryServer = await MongoMemoryServer.create();
  const isolatedUri = memoryServer.getUri('bulkimart_cart_api_test');
  if (!isolatedUri.startsWith('mongodb://127.0.0.1:') && !isolatedUri.startsWith('mongodb://localhost:')) {
    throw new Error('Cart API tests refused a non-local MongoDB test URI.');
  }
  await mongoose.connect(isolatedUri, { autoIndex: true });
  dbReady = true;

  app = express();
  app.use(express.json());
  app.use('/api/cart', cartRoutes);
  app.use(errorHandler);

  const category = new mongoose.Types.ObjectId();
  const secondCategory = new mongoose.Types.ObjectId();
  [shopper, otherShopper] = await User.create([
    { phone: '9100000001', name: 'Cart API Test Customer', roles: ['buyer'] },
    { phone: '9100000002', name: 'Other Cart API Customer', roles: ['buyer'] },
  ]);
  authToken = tokenFor(shopper._id);
  otherAuthToken = tokenFor(otherShopper._id);

  [groceryProduct, ecommerceProduct] = await Product.create([
    {
      type: 'grocery', name: 'Test Quick Product', category, price: 42, mrp: 50,
      stock: 20, unit: 'piece', images: ['https://test.invalid/quick.png'],
      isActive: true, isDeleted: false, status: 'approved',
    },
    {
      type: 'ecommerce', name: 'Test Shop All Product', category: secondCategory,
      price: 125, mrp: 150, stock: 20, unit: 'piece',
      images: ['https://test.invalid/shop-all.png'],
      isActive: true, isDeleted: false, status: 'approved',
    },
  ]);

  // The application's canonical API channel values are grocery (Quick) and
  // ecommerce (Shop All), not the UI labels "quick" / "shop-all".
  await Cart.createIndexes();
}, 300_000);

afterEach(async () => {
  if (dbReady) await Cart.deleteMany({});
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

describe('authenticated cart HTTP API', () => {
  test('seller-role token cannot access customer cart even with buyer membership', async () => {
    const token = jwt.sign({ id: String(shopper._id), type: 'user', role: 'seller' }, JWT_SECRET);
    await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`).expect(403);
  });
  test('requires a valid authenticated customer identity', async () => {
    expect((await request(app).get(cartUrl('grocery'))).status).toBe(401);
    expect((await request(app).get(cartUrl('grocery')).set('Authorization', 'Bearer invalid')).status).toBe(401);

    const missingUserToken = tokenFor(new mongoose.Types.ObjectId());
    expect((await request(app).get(cartUrl('grocery')).set('Authorization', `Bearer ${missingUserToken}`)).status).toBe(401);
    expect(await Cart.countDocuments({})).toBe(0);
  });

  test.each([
    ['grocery', () => groceryProduct],
    ['ecommerce', () => ecommerceProduct],
  ])('%s cart supports read, add, quantity, remove, clear, and fresh-request persistence', async (channel, productFactory) => {
    const product = productFactory();
    const auth = { Authorization: `Bearer ${authToken}` };

    const empty = await request(app).get(cartUrl(channel)).set(auth).expect(200);
    expect(empty.body.data.items).toHaveLength(0);

    const added = await request(app).post('/api/cart').set(auth).send({ productId: product.id, qty: 1 }).expect(200);
    expect(added.body.data.items).toHaveLength(1);
    const itemId = added.body.data.items[0]._id;

    // A new HTTP request represents a refreshed client and exercises database persistence.
    const persisted = await request(app).get(cartUrl(channel)).set(auth).expect(200);
    expect(persisted.body.data.items[0]).toMatchObject({ productId: product.id, qty: 1 });

    await request(app).put(`/api/cart/${itemId}`).set(auth).send({ qty: 3 }).expect(200);
    expect((await request(app).get(cartUrl(channel)).set(auth)).body.data.items[0].qty).toBe(3);
    await request(app).put(`/api/cart/${itemId}`).set(auth).send({ qty: 2 }).expect(200);
    expect((await request(app).get(cartUrl(channel)).set(auth)).body.data.items[0].qty).toBe(2);

    await request(app).delete(`/api/cart/${itemId}`).set(auth).expect(200);
    expect((await request(app).get(cartUrl(channel)).set(auth)).body.data.items).toHaveLength(0);

    await request(app).post('/api/cart').set(auth).send({ productId: product.id, qty: 1 }).expect(200);
    await request(app).delete(cartUrl(channel)).set(auth).expect(200);
    expect((await request(app).get(cartUrl(channel)).set(auth)).body.data.items).toHaveLength(0);
  });

  test('rejects malformed IDs, invalid quantities, unknown channels, and unavailable products without corrupting carts', async () => {
    const auth = { Authorization: `Bearer ${authToken}` };
    await request(app).post('/api/cart').set(auth).send({ productId: 'not-an-object-id', qty: 1 }).expect(400);
    await request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 0 }).expect(400);
    await request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 1.5 }).expect(400);
    await request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 21 }).expect(400);
    await request(app).get(cartUrl('quick')).set(auth).expect(400);
    await request(app).put('/api/cart/not-an-object-id').set(auth).send({ qty: 2 }).expect(400);
    await request(app).post('/api/cart').set(auth).send({ productId: new mongoose.Types.ObjectId(), qty: 1 }).expect(404);
    expect(await Cart.countDocuments({})).toBe(0);

    const added = await request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 1 }).expect(200);
    const itemId = added.body.data.items[0]._id;
    await request(app).put(`/api/cart/${itemId}`).set(auth).send({ qty: 21 }).expect(400);
    expect((await request(app).get(cartUrl('grocery')).set(auth)).body.data.items[0].qty).toBe(1);
  });

  test('keeps Quick and Shop All carts isolated and prevents cross-customer item access', async () => {
    const auth = { Authorization: `Bearer ${authToken}` };
    await request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 2 }).expect(200);
    await request(app).post('/api/cart').set(auth).send({ productId: ecommerceProduct.id, qty: 3 }).expect(200);

    const quick = await request(app).get(cartUrl('grocery')).set(auth).expect(200);
    const shopAll = await request(app).get(cartUrl('ecommerce')).set(auth).expect(200);
    expect(quick.body.data.items.map((item) => item.productId)).toEqual([groceryProduct.id]);
    expect(shopAll.body.data.items.map((item) => item.productId)).toEqual([ecommerceProduct.id]);

    const otherAuth = { Authorization: `Bearer ${otherAuthToken}` };
    await request(app).delete(`/api/cart/${quick.body.data.items[0]._id}`).set(otherAuth).expect(404);
    expect((await request(app).get(cartUrl('grocery')).set(otherAuth)).body.data.items).toHaveLength(0);
    expect(await Cart.countDocuments({ userId: shopper._id })).toBe(2);
    expect(await Cart.countDocuments({ userId: otherShopper._id })).toBe(0);
  });

  test('concurrent first adds reuse one unique user/channel cart and preserve quantities', async () => {
    const auth = { Authorization: `Bearer ${authToken}` };
    const responses = await Promise.all([
      request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 1 }),
      request(app).post('/api/cart').set(auth).send({ productId: groceryProduct.id, qty: 1 }),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);

    const carts = await Cart.find({ userId: shopper._id, channel: 'grocery' }).lean();
    expect(carts).toHaveLength(1);
    expect(carts[0].items).toHaveLength(1);
    expect(carts[0].items[0].qty).toBe(2);
    const itemId = carts[0].items[0]._id;
    const quantityUpdates = await Promise.all([
      request(app).put(`/api/cart/${itemId}`).set(auth).send({ qty: 5 }),
      request(app).put(`/api/cart/${itemId}`).set(auth).send({ qty: 5 }),
    ]);
    expect(quantityUpdates.map((res) => res.status)).toEqual([200, 200]);
    const afterConcurrentSet = await request(app).get(cartUrl('grocery')).set(auth).expect(200);
    expect(afterConcurrentSet.body.data.items[0].qty).toBe(5);

    const indexes = await Cart.collection.listIndexes().toArray();
    expect(indexes.some((index) => index.unique && index.key.userId === 1 && index.key.channel === 1)).toBe(true);
  });
});
