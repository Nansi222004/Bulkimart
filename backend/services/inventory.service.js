import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';

const hasVariants = (product) => Array.isArray(product?.variants) && product.variants.length > 0;

/**
 * Persist subdocument IDs that Mongoose generated while hydrating legacy
 * products whose stored variants pre-date variant identity.
 *
 * Without this repair, every read invents a different `_id`: the catalogue
 * sends one ID, the detail endpoint sends another, and add-to-cart hydrates a
 * third before correctly rejecting the first two as foreign. The guarded,
 * per-index update never changes price or stock and loses a race harmlessly if
 * another request has already repaired that variant.
 */
export const persistLegacyVariantIds = async (product) => {
  if (!product?._id || !hasVariants(product)) return product;

  const stored = await Product.collection.findOne(
    { _id: product._id },
    { projection: { variants: 1 } },
  );
  if (!stored?.variants?.length) return product;

  let raced = false;
  for (let index = 0; index < stored.variants.length; index += 1) {
    if (stored.variants[index]?._id) continue;
    const generatedId = product.variants[index]?._id;
    if (!generatedId) continue;
    const result = await Product.collection.updateOne(
      { _id: product._id, [`variants.${index}._id`]: { $exists: false } },
      { $set: { [`variants.${index}._id`]: generatedId } },
    );
    if (result.modifiedCount !== 1) raced = true;
  }

  // If another request won a repair race, copy the winner's durable IDs onto
  // this already-populated document. Refetching through the model here would
  // discard any category/seller populations the calling endpoint requested.
  if (raced) {
    const repaired = await Product.collection.findOne(
      { _id: product._id },
      { projection: { variants: 1 } },
    );
    repaired?.variants?.forEach((variant, index) => {
      if (variant?._id && product.variants[index]) product.variants[index]._id = variant._id;
    });
  }
  return product;
};

/** Resolve authoritative identity, price and stock. Missing variant IDs are
 * tolerated only for a single-variant product; multi-variant products require
 * explicit selection. Public product reads repair legacy missing IDs before a
 * shopper can select them; the standalone backfill remains available for bulk
 * maintenance. */
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
    { session, updatePipeline: true }
  );
};

export const inventoryIdentityKey = ({ productId, variantId }) => `${String(productId)}:${variantId ? String(variantId) : 'root'}`;
