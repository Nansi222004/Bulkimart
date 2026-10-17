import { retailAllowed, retailVisibility } from '../utils/productChannels.js';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';

/**
 * Same eligibility bar the storefront and cart already apply — deleted,
 * unapproved, or deactivated products never enter the wishlist, matching
 * cart.controller.js's own check so "can I wishlist it" and "can I buy it"
 * never disagree at the moment of adding.
 */
const isEligible = (product) =>
  !!product && retailAllowed(product) && product.fulfillmentType !== 'digital' && !product.isDeleted && product.isActive && product.status === 'approved';

/**
 * @desc    The signed-in shopper's wishlist, as live Product data
 * @route   GET /api/wishlist
 * @access  Private
 *
 * Wishlist stores product references only (see User.js) — everything a
 * shopper sees here is read fresh from Product, so a price/image/name
 * change, or a product going out of stock, shows up immediately without
 * ever needing to touch the wishlist array itself.
 *
 * A product id that no longer resolves to any Product document (hard
 * deleted) is dropped from the response AND pruned from the user's
 * wishlist here — not to be aggressive, but because there is nothing left
 * to ever show for it. A product that still exists but is unapproved/
 * deactivated is NOT pruned — that state is often temporary (a seller
 * update pending re-approval), so the reference is kept and simply
 * reported as `available: false` for the frontend to badge accordingly.
 */
export const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('wishlist');
  const ids = user.wishlist || [];

  if (!ids.length) return ok(res, { items: [], productIds: [], count: 0 });

  const products = await Product.find({ _id: { $in: ids }, $and: [retailVisibility()] })
    .select('name images price mrp discountPercent stock isActive isDeleted status type fulfillmentType sellerId shgStoreId')
    .lean();

  const byId = new Map(products.map((p) => [String(p._id), p]));

  const staleIds = ids.filter((id) => !byId.has(String(id)));
  if (staleIds.length) {
    await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: { $in: staleIds } } });
  }

  // Wishlist array order = the order items were added in (addToSet appends).
  const items = ids
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((p) => ({
      _id: p._id,
      id: p._id,
      name: p.name,
      image: p.images?.[0] || '',
      images: p.images || [],
      price: p.price,
      mrp: p.mrp,
      discountPercent: p.discountPercent || 0,
      stock: p.stock,
      inStock: (p.stock || 0) > 0,
      available: isEligible(p),
      type: p.type,
    }));

  return ok(res, { items, productIds: items.map((i) => String(i._id)), count: items.length });
});

/**
 * @desc    Add a product to the signed-in shopper's wishlist
 * @route   POST /api/wishlist/:productId
 * @access  Private
 *
 * `$addToSet` — the database-level guard against duplicates, so a double
 * click or a retried request can never produce two references to the same
 * product no matter what the frontend does.
 */
export const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.isValidObjectId(productId)) throw httpError(400, 'Invalid product id');

  const product = await Product.findById(productId).select('isActive isDeleted status fulfillmentType sellingChannels');
  if (!isEligible(product)) throw httpError(404, 'This product is not available');

  await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: productId } });
  return ok(res, null, 'Added to wishlist');
});

/**
 * @desc    Remove a product from the signed-in shopper's wishlist
 * @route   DELETE /api/wishlist/:productId
 * @access  Private
 *
 * `$pull` is naturally idempotent — removing something already absent is
 * not an error, it's just a no-op that still reports success.
 */
export const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.isValidObjectId(productId)) throw httpError(400, 'Invalid product id');

  await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: productId } });
  return ok(res, null, 'Removed from wishlist');
});
