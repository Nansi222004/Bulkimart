import { jest } from '@jest/globals';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// Mock Cloudinary upload so external network calls are not made
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({
  uploadToCloudinary: jest.fn(async () => 'https://test.invalid/product-cover.png'),
}));

const [
  { default: productRoutes },
  { default: cartRoutes },
  { errorHandler },
  { default: User },
  { default: Seller },
  { default: Category },
  { default: Product },
  { JWT_SECRET }
] = await Promise.all([
  import('../../routes/product.routes.js'),
  import('../../routes/cart.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../models/User.js'),
  import('../../models/Seller.js'),
  import('../../models/Category.js'),
  import('../../models/Product.js'),
  import('../../config/jwt.js'),
]);

describe('Seller Product Creation & E-book Flow API', () => {
  let memoryServer;
  let app;
  let sellerUser;
  let otherSellerUser;
  let seller;
  let otherSeller;
  let sellerToken;
  let otherSellerToken;
  let buyerUser;
  let buyerToken;
  let parentEcomCategory;
  let leafEcomCategory;
  let leafGroceryCategory;
  let tempStorageDir;
  let originalStorageDir;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const tokenFor = (id) => jwt.sign({ id: String(id), type: 'user' }, JWT_SECRET);

  beforeAll(async () => {
    originalStorageDir = process.env.EBOOK_STORAGE_DIR;
    tempStorageDir = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-product-ebook-test-'));
    process.env.EBOOK_STORAGE_DIR = tempStorageDir;

    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('seller_product_creation_test'), { autoIndex: true });

    app = express();
    app.use(express.json());
    app.use('/api/products', productRoutes);
    app.use('/api/cart', cartRoutes);
    app.use(errorHandler);

    // Create users & sellers
    [sellerUser, otherSellerUser, buyerUser] = await User.create([
      { phone: '9100000010', name: 'Seller User 1', roles: ['seller'] },
      { phone: '9100000011', name: 'Seller User 2', roles: ['seller'] },
      { phone: '9100000012', name: 'Buyer User', roles: ['buyer'] },
    ]);

    [seller, otherSeller] = await Seller.create([
      { userId: sellerUser._id, status: 'approved', businessName: 'Seller Store One' },
      { userId: otherSellerUser._id, status: 'approved', businessName: 'Seller Store Two' },
    ]);

    sellerToken = tokenFor(sellerUser._id);
    otherSellerToken = tokenFor(otherSellerUser._id);
    buyerToken = tokenFor(buyerUser._id);

    // Create categories: parent ecom, leaf ecom, leaf grocery
    parentEcomCategory = await Category.create({
      name: 'Electronics & Media',
      slug: 'electronics-media',
      type: 'ecommerce',
      isActive: true,
    });

    leafEcomCategory = await Category.create({
      name: 'Books & E-books',
      slug: 'books-and-ebooks',
      type: 'ecommerce',
      parent: parentEcomCategory._id,
      isActive: true,
    });

    leafGroceryCategory = await Category.create({
      name: 'Fresh Vegetables',
      slug: 'fresh-vegetables',
      type: 'grocery',
      isActive: true,
    });
  });

  afterAll(async () => {
    if (originalStorageDir === undefined) delete process.env.EBOOK_STORAGE_DIR;
    else process.env.EBOOK_STORAGE_DIR = originalStorageDir;
    await rm(tempStorageDir, { recursive: true, force: true }).catch(() => {});
    await mongoose.disconnect();
    if (memoryServer) await memoryServer.stop();
  });

  describe('Physical Product Creation', () => {
    test('creates a valid physical product with variants and approved status', async () => {
      const variants = [
        { name: 'Standard Edition', price: 299, mrp: 399, stock: 25, unit: 'piece' },
        { name: 'Deluxe Edition', price: 499, mrp: 599, stock: 10, unit: 'piece' },
      ];

      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('fulfillmentType', 'physical')
        .field('name', 'Hardcover Programming Guide')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify(variants))
        .attach('images', Buffer.from('fake image content'), 'cover.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.product.status).toBe('approved');
      expect(res.body.product.isActive).toBe(true);
      expect(res.body.product.sellerId).toBe(String(seller._id));
      expect(res.body.product.variants).toHaveLength(2);
      expect(res.body.product.stock).toBe(35); // 25 + 10
    });

    test('rejects creation when listing into a non-leaf parent category', async () => {
      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('name', 'General Electronics Item')
        .field('category', String(parentEcomCategory._id))
        .field('variants', JSON.stringify([{ name: 'Item', price: 100, mrp: 100, stock: 5 }]))
        .attach('images', Buffer.from('fake image content'), 'img.png');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/sub-category rather than a top-level/i);
    });

    test('rejects physical product when variant selling price > mrp', async () => {
      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('name', 'Overpriced Gadget')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify([{ name: 'Standard', price: 600, mrp: 500, stock: 5 }]))
        .attach('images', Buffer.from('fake image content'), 'img.png');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/price cannot be higher than its MRP/i);
    });

    test('rejects physical product when variant stock is negative', async () => {
      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('name', 'Negative Stock Item')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify([{ name: 'Standard', price: 100, mrp: 150, stock: -2 }]))
        .attach('images', Buffer.from('fake image content'), 'img.png');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/stock cannot be negative/i);
    });

    test('rejects physical product when no images are attached', async () => {
      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('name', 'Image-less Product')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify([{ name: 'Standard', price: 100, mrp: 150, stock: 5 }]));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/upload at least one product image/i);
    });
  });

  describe('E-book Product Creation & Validation', () => {
    let createdEbookId;

    test('creates a valid e-book draft in pending status with zero stock and digital metadata', async () => {
      const ebookVariant = [{ name: 'E-book', price: 199, mrp: 199, stock: 0, unit: 'piece' }];
      const digitalData = {
        author: 'Jane Developer',
        language: 'English',
        format: 'pdf',
        licenseTerms: 'Single-user educational license',
      };

      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('fulfillmentType', 'digital')
        .field('name', 'Mastering Node.js Microservices')
        .field('description', 'A complete guide to backend development')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify(ebookVariant))
        .field('digital', JSON.stringify(digitalData))
        .attach('images', Buffer.from('fake cover image'), 'ebook-cover.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.product.fulfillmentType).toBe('digital');
      expect(res.body.product.status).toBe('pending');
      expect(res.body.product.isActive).toBe(false);
      expect(res.body.product.digital.author).toBe('Jane Developer');
      expect(res.body.product.digital.language).toBe('English');
      expect(res.body.product.digital.format).toBe('pdf');
      expect(res.body.product.stock).toBe(0);

      createdEbookId = res.body.product._id;
    });

    test('rejects e-book creation with missing author or language', async () => {
      const ebookVariant = [{ name: 'E-book', price: 99, mrp: 99, stock: 0, unit: 'piece' }];

      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('fulfillmentType', 'digital')
        .field('name', 'Incomplete E-book')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify(ebookVariant))
        .field('digital', JSON.stringify({ author: '', language: '' }))
        .attach('images', Buffer.from('cover'), 'cover.jpg');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Author and language are required/i);
    });

    test('rejects e-book stock unless the seller sets a copy limit', async () => {
      const ebookVariant = [{ name: 'E-book', price: 99, mrp: 99, stock: 10, unit: 'piece' }];

      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('fulfillmentType', 'digital')
        .field('name', 'E-book with Physical Stock')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify(ebookVariant))
        .field('digital', JSON.stringify({ author: 'Author', language: 'English' }))
        .attach('images', Buffer.from('cover'), 'cover.jpg');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/copy limit/i);
    });

    test('accepts an e-book copy limit and MRP, and rejects fractional copies', async () => {
      const send = (variant) => request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'ecommerce')
        .field('fulfillmentType', 'digital')
        .field('name', 'Limited E-book')
        .field('category', String(leafEcomCategory._id))
        .field('variants', JSON.stringify([variant]))
        .field('digital', JSON.stringify({ author: 'Author', language: 'English', stockTracked: true }))
        .attach('images', Buffer.from('cover'), 'cover.jpg');

      const bad = await send({ name: 'E-book', price: 99, mrp: 149, stock: 2.5, unit: 'piece' });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/whole number/i);

      const res = await send({ name: 'E-book', price: 99, mrp: 149, stock: 25, unit: 'piece' });
      expect(res.status).toBe(201);
      const created = await Product.findOne({ name: 'Limited E-book' });
      expect(created.digital.stockTracked).toBe(true);
      expect(created.variants[0]).toMatchObject({ stock: 25, mrp: 149, price: 99 });
    });

    test('rejects e-book creation under grocery channel', async () => {
      const ebookVariant = [{ name: 'E-book', price: 99, mrp: 99, stock: 0, unit: 'piece' }];

      const res = await request(app)
        .post('/api/products')
        .set(auth(sellerToken))
        .field('type', 'grocery')
        .field('fulfillmentType', 'digital')
        .field('name', 'Grocery E-book')
        .field('category', String(leafGroceryCategory._id))
        .field('variants', JSON.stringify(ebookVariant))
        .field('digital', JSON.stringify({ author: 'Author', language: 'English' }))
        .attach('images', Buffer.from('cover'), 'cover.jpg');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/only be listed in E-Commerce/i);
    });

    test('seller can upload private PDF file to their created e-book', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');

      const res = await request(app)
        .post(`/api/products/${createdEbookId}/digital-file`)
        .set(auth(sellerToken))
        .attach('file', pdfBuffer, 'mastering-nodejs.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.status).toBe('uploaded');
      expect(res.body.data.file.format).toBe('pdf');
      expect(res.body.data.moderationStatus).toBe('pending');

      const updated = await Product.findById(createdEbookId).select('+digital.file.fileId');
      expect(updated.digital.file.status).toBe('uploaded');
      expect(updated.digital.file.ownerSellerId.toString()).toBe(String(seller._id));
      expect(updated.digital.file.fileId).toBeDefined();
    });

    test('another seller cannot upload PDF to this e-book', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\nmalicious');

      const res = await request(app)
        .post(`/api/products/${createdEbookId}/digital-file`)
        .set(auth(otherSellerToken))
        .attach('file', pdfBuffer, 'hijack.pdf');

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });

    test('verifies that no public GET download endpoint exists for digital files', async () => {
      const res = await request(app)
        .get(`/api/products/${createdEbookId}/digital-file`);

      // Express router does not define a GET on /digital-file, resulting in 404
      expect(res.status).toBe(404);
    });

    test('verifies that an unapproved e-book cannot be added to customer cart (404)', async () => {
      const res = await request(app)
        .post('/api/cart')
        .set(auth(buyerToken))
        .send({ productId: createdEbookId, qty: 1 });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('This product is not available');
    });

    test('allows an approved e-book into the customer cart as a quantity-one digital line', async () => {
      // Simulate admin approval of the e-book listing
      await Product.findByIdAndUpdate(createdEbookId, { status: 'approved', isActive: true });

      const res = await request(app)
        .post('/api/cart')
        .set(auth(buyerToken))
        .send({ productId: createdEbookId, qty: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].fulfillmentType).toBe('digital');
      expect(res.body.data.items[0].qty).toBe(1);
      expect(res.body.data.pricing.deliveryCharge).toBe(0);
    });
  });
});
