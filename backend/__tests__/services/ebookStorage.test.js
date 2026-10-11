import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Product from '../../models/Product.js';
import { ebookStorageDirectory, removeStoredEbook, storeEbookPdf, validateEbookPdf } from '../../services/ebookStorage.service.js';
import { isProductImageMime } from '../../middlewares/upload.middleware.js';
import { assertEbookReadyForApproval, assertEbookUploadOwnership } from '../../services/digitalProduct.service.js';

const validPdf = (name = 'book.pdf') => {
  const buffer = Buffer.from('%PDF-1.7\n% test fixture\n');
  return { originalname: name, mimetype: 'application/pdf', size: buffer.length, buffer };
};

describe('private e-book foundation', () => {
  let tempDir;
  let originalStorageDir;

  beforeEach(async () => {
    originalStorageDir = process.env.EBOOK_STORAGE_DIR;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-ebook-test-'));
    process.env.EBOOK_STORAGE_DIR = tempDir;
  });

  afterEach(async () => {
    if (originalStorageDir === undefined) delete process.env.EBOOK_STORAGE_DIR;
    else process.env.EBOOK_STORAGE_DIR = originalStorageDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('accepts PDF signature and rejects extension, MIME, and signature mismatches', () => {
    expect(validateEbookPdf(validPdf()).format).toBe('pdf');
    expect(() => validateEbookPdf(validPdf('book.epub'))).toThrow('Only PDF');
    expect(() => validateEbookPdf({ ...validPdf(), mimetype: 'application/octet-stream' })).toThrow('declared as a PDF');
    expect(() => validateEbookPdf({ ...validPdf(), buffer: Buffer.from('not a book') })).toThrow('not a valid PDF');
    expect(() => validateEbookPdf(validPdf(), 2)).toThrow('upload limit');
    expect(isProductImageMime('image/jpeg')).toBe(true);
    expect(isProductImageMime('application/pdf')).toBe(false);
  });

  test('writes with a random private identifier and removes only a valid identifier', async () => {
    const stored = await storeEbookPdf(validPdf('../../not-the-path.pdf'));
    expect(stored.fileId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(path.join(ebookStorageDirectory(), `${stored.fileId}.pdf`), 'utf8')).toContain('%PDF-');
    await expect(removeStoredEbook('../../escape')).rejects.toThrow('Invalid private file identifier');
    await removeStoredEbook(stored.fileId);
  });

  test('storage failures return a safe message without leaking the configured path', async () => {
    const blocker = path.join(tempDir, 'not-a-directory');
    await writeFile(blocker, 'x');
    process.env.EBOOK_STORAGE_DIR = blocker;
    await expect(storeEbookPdf(validPdf())).rejects.toThrow('Private e-book storage is unavailable');
  });

  test('refuses a configured path inside the frontend public tree before writing', async () => {
    process.env.EBOOK_STORAGE_DIR = path.resolve(process.cwd(), '../forntend/public/ebook-test-only');
    await expect(storeEbookPdf(validPdf())).rejects.toThrow('Private e-book storage is unavailable');
  });

  test('digital products require author, language, and PDF metadata while legacy physical products remain valid', async () => {
    const category = '64b000000000000000000001';
    const physical = new Product({ type: 'ecommerce', name: 'Existing item', category, price: 4, stock: 3 });
    await expect(physical.validate()).resolves.toBeUndefined();
    expect(physical.fulfillmentType).toBe('physical');

    const incomplete = new Product({ type: 'ecommerce', fulfillmentType: 'digital', name: 'Book title', category,
      price: 10, stock: 0, variants: [{ name: 'E-book', price: 10, mrp: 10, stock: 0, unit: 'piece' }],
      digital: { format: 'pdf' } });
    await expect(incomplete.validate()).rejects.toThrow(/author|language/i);

    const ebook = new Product({ type: 'ecommerce', fulfillmentType: 'digital', name: 'Book title', category,
      status: 'pending', isActive: false,
      price: 10, stock: 0, variants: [{ name: 'E-book', price: 10, mrp: 10, stock: 0, unit: 'piece' }],
      digital: { author: 'Test author', language: 'English', format: 'pdf' } });
    await expect(ebook.validate()).resolves.toBeUndefined();

    const activeWithoutFile = new Product({ type: 'ecommerce', fulfillmentType: 'digital', name: 'Active book', category,
      price: 10, stock: 0, variants: [{ name: 'E-book', price: 10, mrp: 10, stock: 0, unit: 'piece' }],
      digital: { author: 'Test author', language: 'English', format: 'pdf' } });
    await expect(activeWithoutFile.validate()).rejects.toThrow(/private PDF/i);
  });

  test('seller upload ownership and admin approval require the associated private file', () => {
    const sellerId = '64b000000000000000000002';
    const productId = '64b000000000000000000003';
    const product = {
      _id: productId, sellerId, fulfillmentType: 'digital',
      digital: { author: 'Author', language: 'English', format: 'pdf', file: {
        fileId: 'server-generated-id', productId, ownerSellerId: sellerId, sizeBytes: 12, status: 'uploaded',
      } },
    };
    expect(() => assertEbookUploadOwnership(product, sellerId)).not.toThrow();
    expect(() => assertEbookUploadOwnership(product, '64b000000000000000000004')).toThrow('not found');
    expect(() => assertEbookReadyForApproval(product)).not.toThrow();
    expect(() => assertEbookReadyForApproval({ ...product, digital: { ...product.digital, file: { ...product.digital.file, ownerSellerId: '64b000000000000000000004' } } })).toThrow('incomplete');
  });

  test('the private upload API requires authentication and exposes no download route', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const router = (await import('../../routes/product.routes.js')).default;
    const app = express();
    app.use('/api/products', router);
    const response = await request(app).post('/api/products/64b000000000000000000003/digital-file');
    expect(response.status).toBe(401);
    const fileRoutes = router.stack.filter((layer) => layer.route && String(layer.route.path).includes('digital-file'));
    expect(fileRoutes).toHaveLength(1);
    expect(fileRoutes[0].route.methods.post).toBe(true);
    expect(fileRoutes[0].route.methods.get).toBeUndefined();
  });
});
