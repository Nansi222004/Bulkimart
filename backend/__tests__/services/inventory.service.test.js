import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import { inventoryIdentityKey, resolveInventoryItem } from '../../services/inventory.service.js';
import { planVariantIdBackfill } from '../../migrations/backfill-product-variant-ids.mjs';

describe('variant-aware inventory contract (database independent)', () => {
  test('legacy product without variants uses root price and stock', () => {
    const product = { _id: new mongoose.Types.ObjectId(), price: 11, mrp: 12, stock: 4, sku: 'ROOT', unit: 'piece' };
    expect(resolveInventoryItem(product)).toMatchObject({ productId: product._id, variantId: null, price: 11, stock: 4, sku: 'ROOT' });
  });

  test('selected variant is the authority for price, SKU, attributes and stock', () => {
    const id = new mongoose.Types.ObjectId();
    const product = { _id: new mongoose.Types.ObjectId(), sellerId: new mongoose.Types.ObjectId(), price: 2, stock: 100, variants: [{ _id: id, name: '1kg', price: 42, mrp: 50, stock: 3, sku: 'RICE-1K', unit: 'kg', attributes: [{ name: 'Pack', value: '1kg' }] }] };
    expect(resolveInventoryItem(product, String(id))).toMatchObject({ variantId: id, price: 42, stock: 3, sku: 'RICE-1K', variantName: '1kg' });
  });

  test('rejects invalid, foreign and omitted multi-variant selections', () => {
    const a = new mongoose.Types.ObjectId();
    const product = { _id: new mongoose.Types.ObjectId(), variants: [{ _id: a, price: 1, stock: 1 }, { _id: new mongoose.Types.ObjectId(), price: 2, stock: 1 }] };
    expect(() => resolveInventoryItem(product, 'not-an-id')).toThrow('Invalid product variant');
    expect(() => resolveInventoryItem(product, new mongoose.Types.ObjectId())).toThrow('does not belong');
    expect(() => resolveInventoryItem(product)).toThrow('Please select');
  });

  test('cart identity keeps product variants as separate lines while root products stay distinct', () => {
    const productId = new mongoose.Types.ObjectId();
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    expect(inventoryIdentityKey({ productId, variantId: first })).not.toBe(inventoryIdentityKey({ productId, variantId: second }));
    expect(inventoryIdentityKey({ productId })).not.toBe(inventoryIdentityKey({ productId, variantId: first }));
  });

  test('variant subdocuments receive stable schema IDs and root stock validates as the sum projection', async () => {
    const doc = new Product({ type: 'ecommerce', name: 'Rice', category: new mongoose.Types.ObjectId(), price: 20, stock: 0, variants: [
      { name: '500g', price: 20, mrp: 22, stock: 4, unit: 'pack' },
      { name: '1kg', price: 38, mrp: 42, stock: 7, unit: 'pack' },
    ] });
    const ids = doc.variants.map((v) => String(v._id));
    await doc.validate();
    expect(doc.stock).toBe(11);
    expect(new Set(ids).size).toBe(2);
    const stableId = doc.variants[0]._id;
    doc.name = 'Rice premium';
    await doc.validate();
    expect(doc.variants[0]._id).toEqual(stableId);
  });

  test('backfill planner only assigns missing IDs and reports duplicate IDs and stock discrepancies', () => {
    const productId = new mongoose.Types.ObjectId();
    const duplicate = new mongoose.Types.ObjectId();
    const report = planVariantIdBackfill([
      { _id: productId, stock: 2, variants: [{ _id: duplicate, stock: 1 }, { stock: 5 }] },
      { _id: new mongoose.Types.ObjectId(), stock: 1, variants: [{ _id: duplicate, stock: 1 }] },
    ]);
    expect(report.plan).toHaveLength(1);
    expect(report.issues.some((issue) => issue.reason === 'duplicate_variant_id')).toBe(true);
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].variantStockSum).toBe(6);
  });
});
