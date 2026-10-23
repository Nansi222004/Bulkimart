import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import { channelAllowed } from '../utils/productChannels.js';
import { httpError } from '../utils/response.js';
export const advertisingId = value => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw httpError(400, 'Invalid advertising reference');
  return new mongoose.Types.ObjectId(value);
};
export const advertisingChannel = module => {
  if (!['QUICK', 'ECOMMERCE'].includes(module)) throw httpError(400, 'Select Quick or Shop All');
  return module === 'QUICK' ? 'grocery' : 'ecommerce';
};
// This validates campaign authoring, not customer-specific delivery. A later
// serving adapter must also apply the customer's live serviceability verdict.
export async function validateAdvertisingSelection(campaign, session) {
  const a = campaign.advertising, channel = advertisingChannel(campaign.module);
  const seller = await Seller.findOne({ _id: campaign.sellerId, status: 'approved' }).session(session).lean();
  if (!seller || !await User.exists({ _id: seller.userId, isActive: true, roles: 'seller' }).session(session)) throw httpError(409, 'Seller is no longer eligible');
  if (!seller.salesChannels?.includes(channel)) throw httpError(409, 'Seller channel is unavailable');
  if (!a.categoryId || !a.items?.length) throw httpError(400, 'Select a category and products');
  let category = await Category.findById(a.categoryId).session(session).lean();
  if (!category || category.type !== channel) throw httpError(400, 'Category does not belong to this module');
  const visited = new Set();
  while (category) {
    const key = String(category._id);
    if (visited.has(key) || visited.size >= 20 || category.isActive === false || category.type !== channel) throw httpError(409, 'Category is unavailable');
    visited.add(key);
    if (!category.parent) break;
    category = await Category.findById(category.parent).session(session).lean();
    if (!category) throw httpError(409, 'Category ancestry is unavailable');
  }
  const products = await Product.find({ _id: { $in: a.items.map(i => i.productId) }, sellerId: seller._id }).session(session).lean();
  const seen = new Set();
  for (const item of a.items) {
    const product = products.find(p => String(p._id) === String(item.productId));
    const key = String(item.productId);
    if (seen.has(key)) throw httpError(400, 'Select each product once');
    seen.add(key);
    if (!product || product.status !== 'approved' || !product.isActive || product.isDeleted || product.shgStoreId || product.type === 'shg' || product.fulfillmentType === 'digital' || !channelAllowed(product, channel)) throw httpError(409, 'Selected product is unavailable or not owned by this seller');
    const categories = [];
    if (product.type === channel) categories.push(product.category, product.subCategory);
    for (const cross of product.channels || []) if (cross.type === channel && cross.isActive !== false) categories.push(cross.category, cross.subCategory);
    if (!categories.some(c => c && String(c) === String(a.categoryId))) throw httpError(409, 'Product does not match the selected category and channel');
    const variant = product.variants?.length ? product.variants.find(v => String(v._id) === String(item.variantId)) : product;
    if (!variant || (!product.variants?.length && item.variantId) || !Number.isSafeInteger(variant.stock) || variant.stock < 1 || !Number.isFinite(variant.price) || variant.price <= 0) throw httpError(409, 'Select an available purchasable variant');
  }
  return { seller, products };
}
