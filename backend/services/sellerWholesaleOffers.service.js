import { channelAllowed } from '../utils/productChannels.js';
import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { normalizeWholesalePricing } from './wholesalePricing.service.js';
import { httpError } from '../utils/response.js';

export async function saveSellerWholesaleOffers(userId, productId, body) {
  if (!mongoose.isObjectIdOrHexString(productId)) throw httpError(400, 'Invalid product ID');
  const requested = body?.variants;
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw httpError(400, 'Provide between 1 and 100 variant wholesale configurations');
  const ids = requested.map(entry => String(entry?.variantId || ''));
  if (ids.some(id => !mongoose.isObjectIdOrHexString(id)) || new Set(ids).size !== ids.length) throw httpError(400, 'Each wholesale configuration needs a unique valid variant ID');
  if (body.version !== undefined && (!Number.isSafeInteger(body.version) || body.version < 0)) throw httpError(400, 'Invalid product version');
  const normalized = requested.map((entry, i) => {
    if (!Object.hasOwn(entry, 'wholesalePricing')) throw httpError(400, 'Wholesale pricing configuration is required for each variant');
    try { return { variantId: ids[i], wholesalePricing: normalizeWholesalePricing(entry.wholesalePricing) || { enabled: false } }; }
    catch (error) { error.message = `Variant ${i + 1}: ${error.message}`; throw error; }
  });
  const enabling = normalized.some(entry => entry.wholesalePricing.enabled);
  // The existing application already requires replica-set transactions. Writes
  // to Seller/User/Category serialize eligibility changes with this offer write.
  return mongoose.connection.transaction(async session => {
    const seller = await Seller.findOne({ userId }).session(session);
    if (!seller) throw httpError(404, 'Seller profile not found');
    const product = await Product.findOne({ _id: productId, sellerId: seller._id, isDeleted: false }).session(session);
    if (!product) throw httpError(404, 'Product not found');
    const filter = { _id: seller._id, status: 'approved', ...(enabling ? { 'wholesaleChannel.status': 'approved', salesChannels: 'wholesale' } : {}) };
    if (!(await Seller.updateOne(filter, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Wholesale pricing requires an approved Wholesale seller channel');
    if (!(await User.updateOne({ _id: userId, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Seller account is unavailable');
    if (product.fulfillmentType === 'digital' || !['ecommerce', 'grocery'].includes(product.type)) throw httpError(400, 'Wholesale offers are not available for digital or unsupported products');
    if (body.version !== undefined && body.version !== (product.__v ?? 0)) throw httpError(409, 'Product changed. Refresh before saving Wholesale terms.');
    if (enabling) {
      if (!product.isActive || product.status !== 'approved') throw httpError(409, 'An active approved product is required to enable Wholesale');
      if (!(await Category.updateOne({ _id: product.category, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(409, 'The product category is unavailable');
    }
    const set = {}, arrayFilters = [];
    if (enabling && !channelAllowed(product, 'wholesale')) set.sellingChannels = [...product.sellingChannels, 'wholesale'];
    normalized.forEach((entry, i) => {
      const variant = product.variants.find(v => String(v._id) === entry.variantId);
      if (!variant) throw httpError(400, 'A selected variant does not belong to this product');
      if (entry.wholesalePricing.enabled && (!Number.isSafeInteger(variant.stock) || variant.stock < entry.wholesalePricing.minimumQuantity)) throw httpError(409, `Variant ${variant.name}: available stock must meet the Wholesale MOQ`);
      set[`variants.$[offer${i}].wholesalePricing`] = entry.wholesalePricing;
      arrayFilters.push({ [`offer${i}._id`]: variant._id });
    });
    const result = await Product.updateOne({ _id: product._id, sellerId: seller._id, __v: product.__v == null ? { $in: [null, 0] } : product.__v }, { $set: set, $inc: { __v: 1 } }, { session, arrayFilters, runValidators: true });
    if (!result.matchedCount) throw httpError(409, 'Product variants changed; refresh and try again');
    return { variants: normalized, version: (product.__v ?? 0) + 1 };
  });
}
