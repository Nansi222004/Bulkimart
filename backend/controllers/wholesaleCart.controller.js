import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import { assertWholesaleBuyer, quoteWholesaleVariant } from '../services/wholesaleEligibility.service.js';
import { buildFulfilmentGroups } from '../services/fulfilmentGroups.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { wholesaleQuoteHash } from '../services/wholesaleQuote.service.js';
import { resolveShippingAddress } from './order.controller.js';

export const wholesaleCartView = async (req) => {
  assertWholesaleBuyer(req);
  let destination = req.query.lat !== undefined && req.query.lng !== undefined ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : undefined;
  if (destination && (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || Math.abs(destination.lat) > 90 || Math.abs(destination.lng) > 180)) throw httpError(400, 'Invalid delivery coordinates');
  try {
    if (req.query.addressId) {
      const address = await resolveShippingAddress({ user: req.user, addressId: req.query.addressId });
      destination = address.lat !== undefined && address.lng !== undefined ? { lat: address.lat, lng: address.lng } : undefined;
    }
    const composed = await buildFulfilmentGroups({ userId: req.user._id, user: req.user, destination, purchaseMode: 'wholesale' });
    return { ...composed, quoteHash: wholesaleQuoteHash(composed), salesChannel: 'wholesale', valid: true };
  } catch (error) {
    if (error.status !== 409 && error.status !== 400) throw error;
    const cart = await Cart.findOne({ userId: req.user._id, channel: 'wholesale' }).lean();
    return { salesChannel: 'wholesale', valid: false, groups: [], items: (cart?.items || []).map(({ _id, productId, variantId, name, qty }) => ({ itemId: _id, productId, variantId, name, qty })), warnings: [error.message], totals: null };
  }
};
export const getWholesaleCart = asyncHandler(async (req, res) => ok(res, await wholesaleCartView(req)));
export const changeWholesaleCart = asyncHandler(async (req, res) => {
  assertWholesaleBuyer(req);
  if (req.body?.channel !== undefined && req.body.channel !== 'wholesale') throw httpError(400, 'Wholesale and retail carts are separate');
  const owner = { userId: req.user._id, channel: 'wholesale' };
  if (req.method === 'DELETE' && !req.params.itemId) {
    await Cart.updateOne(owner, { $set: { items: [] }, $inc: { __v: 1 } });
    return ok(res, await wholesaleCartView(req));
  }
  if (req.params.itemId && !mongoose.isValidObjectId(req.params.itemId)) throw httpError(400, 'Invalid cart line');
  if (req.method === 'POST') {
    try { await Cart.updateOne(owner, { $setOnInsert: { ...owner, items: [], __v: 0 } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const cart = await Cart.findOne(owner).lean();
    if (!cart) throw httpError(404, 'Wholesale cart not found');
    let items = cart.items || [];
    const existing = req.params.itemId ? items.find(line => String(line._id) === req.params.itemId)
      : items.find(line => String(line.productId) === req.body.productId && String(line.variantId) === req.body.variantId);
    if (req.params.itemId && !existing) throw httpError(404, 'Wholesale cart line not found');
    if (req.method === 'DELETE') items = items.filter(line => String(line._id) !== req.params.itemId);
    else {
      const productId = existing?.productId || req.body.productId, variantId = existing?.variantId || req.body.variantId;
      if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) throw httpError(400, 'Valid product and variant IDs are required');
      const product = await Product.findById(productId).select('+variants.wholesalePricing').populate('category', 'isActive');
      const seller = product ? await Seller.findById(product.sellerId).populate('userId', 'isActive') : null;
      if (!product?.category) throw httpError(409, 'Wholesale product category unavailable');
      // Validate the submitted quantity before converting; booleans/null are invalid.
      quoteWholesaleVariant(product, seller, variantId, req.body.qty);
      const qty = req.method === 'POST' ? Number(existing?.qty || 0) + Number(req.body.qty) : Number(req.body.qty);
      const quote = quoteWholesaleVariant(product, seller, variantId, qty);
      if (!existing && items.length >= 100) throw httpError(400, 'Wholesale cart supports at most 100 different variants');
      const line = { _id: existing?._id || new mongoose.Types.ObjectId(), productId: product._id, variantId: quote.inventory.variantId, name: product.name, qty, price: quote.unitPrice, type: product.type, sellerId: seller._id, image: product.images?.[0] || '' };
      items = existing ? items.map(item => String(item._id) === String(existing._id) ? line : item) : [...items, line];
    }
    const result = await Cart.updateOne({ ...owner, __v: cart.__v ?? 0 }, { $set: { items }, $inc: { __v: 1 } }, { runValidators: true });
    if (result.modifiedCount) return ok(res, await wholesaleCartView(req));
  }
  throw httpError(409, 'Wholesale cart changed. Refresh and try again.');
});
