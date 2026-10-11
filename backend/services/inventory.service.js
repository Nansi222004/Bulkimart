import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';

const hasVariants = (product) => Array.isArray(product?.variants) && product.variants.length > 0;

/** Resolve authoritative identity, price and stock. Missing variant IDs are
 * tolerated only for a single-variant product; multi-variant products require
 * explicit selection. The backfill migration must run before serving old rows. */
export const resolveInventoryItem = (product, variantId, { allowLegacyPrimary = false } = {}) => {
  if (!product) throw httpError(404, 'Product not found');
  if (!hasVariants(product)) {
    if (variantId) throw httpError(400, 'This product does not have selectable variants');
    return { productId: product._id, variantId: null, price: product.price, mrp: product.mrp, stock: product.stock, sku: product.sku, unit: product.unit, attributes: [] };
  }

  let variant;
  if (variantId) {
    if (!mongoose.isValidObjectId(variantId)) throw httpError(400, 'Invalid product variant');
    variant = product.variants.find((entry) => String(entry._id) === String(variantId));
    if (!variant) throw httpError(400, 'The selected variant does not belong to this product');
  } else if (product.variants.length === 1 || allowLegacyPrimary) {
    [variant] = product.variants;
  } else {
    throw httpError(400, 'Please select a product variant');
  }
  if (!variant._id) throw httpError(409, 'Product variants require an identifier migration before they can be purchased');
  return {
    productId: product._id, variantId: variant._id, price: variant.price,
    mrp: variant.mrp, stock: variant.stock, sku: variant.sku, variantName: variant.name,
    unit: variant.unit, weight: variant.weight,
    attributes: Array.isArray(variant.attributes) ? variant.attributes : [],
  };
};

/** Atomic stock mutation. Must be called within the caller's transaction.
 * Root stock is a sum projection for variant products and is never decremented
 * independently. For legacy no-variant documents root stock is canonical. */
export const mutateInventory = async ({ productId, variantId = null, quantity, session, restore = false }) => {
  const delta = restore ? Number(quantity) : -Number(quantity);
  if (!Number.isInteger(Math.abs(delta)) || delta === 0) throw httpError(400, 'Invalid inventory quantity');
  // A legacy variant-less order can only be resolved by reading the current
  // product; its pre-variant deduction used the primary variant projection.
  if (!variantId && restore) {
    const current = await Product.findById(productId).session(session || null).select('_id variants stock');
    if (!current) throw httpError(409, 'The product is no longer available');
    if (hasVariants(current)) variantId = current.variants[0]?._id;
  }

  if (!variantId) {
    const filter = { _id: productId, $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] };
    if (!restore) filter.stock = { $gte: quantity };
    const result = await Product.updateOne(filter, { $inc: { stock: delta, __v: 1 } }, { session });
    if (result.modifiedCount !== 1) throw httpError(409, 'There is not enough stock available');
    return;
  }

  if (!variantId || !mongoose.isValidObjectId(variantId)) throw httpError(409, 'The selected product variant is unavailable');
  const filter = { _id: productId, variants: { $elemMatch: { _id: variantId, ...(restore ? {} : { stock: { $gte: quantity } }) } } };
  const result = await Product.updateOne(filter, { $inc: { 'variants.$.stock': delta, __v: 1 } }, { session });
  if (result.modifiedCount !== 1) throw httpError(409, 'The selected variant does not have enough stock');

  // Projection recomputation is in the same transaction. Concurrent mutations
  // to the product document serialize/retry under MongoDB transaction rules.
  await Product.updateOne(
    { _id: productId },
    [{ $set: { stock: { $sum: { $map: { input: '$variants', as: 'variant', in: '$$variant.stock' } } }, __v: { $add: ['$__v', 1] } } }],
    { session }
  );
};

export const inventoryIdentityKey = ({ productId, variantId }) => `${String(productId)}:${variantId ? String(variantId) : 'root'}`;
