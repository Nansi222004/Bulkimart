import SubscriptionBasket from '../models/SubscriptionBasket.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { CHANNEL, SUBSCRIPTION_MAX_WEIGHT_KG } from '../constants/enums.js';
import { weightKgOf, assertWeightWithinLimit } from '../services/subscription.service.js';

/**
 * The subscription basket a customer is still building.
 *
 * This is the staging area behind "add to basket" on the Subscription
 * screen — before a schedule is picked or anything is paid. It is kept
 * so that basket, unlike the in-memory React state it replaces, survives a
 * refresh or a return visit: add three items, close the tab, come back
 * tomorrow, they're still there.
 *
 * One basket per (customer, seller) — see SubscriptionBasket.js for why a
 * subscription can never mix sellers. Only `productId`/`qty` are stored;
 * every read re-resolves against the live product so a basket never shows a
 * stale price or a delisted item.
 */

/** Load one vendor's basket, reconciled against live products, persisting any fixes. */
const loadReconciled = async (basket) => {
  if (!basket || basket.items.length === 0) return null;

  const products = await Product.find({ _id: { $in: basket.items.map((i) => i.productId) } })
    .populate('sellerId', 'storeDetails businessName')
    .populate('shgStoreId', 'groupName village district state')
    .populate('category', 'name')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const keep = [];
  const warnings = [];
  let mutated = false;

  for (const line of basket.items) {
    const p = byId.get(String(line.productId));
    if (!p || p.isDeleted || !p.isActive || p.status !== 'approved') {
      warnings.push(`An item in your basket is no longer available and was removed.`);
      mutated = true;
      continue;
    }
    if (p.stock <= 0) {
      warnings.push(`"${p.name}" is out of stock and was removed from your basket.`);
      mutated = true;
      continue;
    }
    keep.push({ line, product: p });
  }

  if (mutated) {
    basket.items = keep.map((k) => k.line);
    if (basket.items.length === 0) {
      await basket.deleteOne();
    } else {
      await basket.save();
    }
  }

  if (keep.length === 0) return null;

  const items = keep.map(({ line, product }) => ({
    productId: product._id,
    name: product.name,
    image: product.images?.[0] || '',
    price: product.price,
    unit: product.unit,
    weight: product.weight,
    category: product.category?.name || '',
    stock: product.stock,
    qty: line.qty,
    lineTotal: Math.round(product.price * line.qty * 100) / 100,
  }));

  const seller = keep[0].product.sellerId;
  const shgStore = keep[0].product.shgStoreId;
  const weightKg = Math.round(
    keep.reduce((sum, { line, product }) => sum + weightKgOf(product) * line.qty, 0) * 100
  ) / 100;

  return {
    sellerId: basket.sellerId,
    shgStoreId: basket.shgStoreId,
    // One generic "seller" shape either way, so the storefront never has to
    // know which kind of vendor this basket belongs to — lat/lng travel
    // with a Seller (for a distance-based delivery fee); an SHGStore has no
    // pinned location today, so those are simply absent for one.
    seller: seller ? {
      _id: seller._id,
      name: seller.storeDetails?.name || seller.businessName || 'Seller',
      lat: seller.storeDetails?.lat,
      lng: seller.storeDetails?.lng,
    } : (shgStore ? {
      _id: shgStore._id,
      name: shgStore.groupName || 'SHG Store',
      lat: undefined,
      lng: undefined,
    } : null),
    items,
    weightKg,
    subtotal: Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100,
    warnings,
  };
};

// @desc    All of the shopper's in-progress subscription baskets, one per seller
// @route   GET /api/subscription-baskets
// @access  Private
export const getMyBaskets = asyncHandler(async (req, res) => {
  const baskets = await SubscriptionBasket.find({ userId: req.user._id });
  const resolved = await Promise.all(baskets.map(loadReconciled));
  return ok(res, resolved.filter(Boolean), 'Your subscription baskets');
});

// @desc    Add/update an item — qty <= 0 removes it. Basket is keyed by the
//          product's seller; adding a second seller's item starts (or adds
//          to) that seller's own separate basket, never merges with another.
// @route   POST /api/subscription-baskets/items
// @access  Private
export const upsertBasketItem = asyncHandler(async (req, res) => {
  const { productId, qty } = req.body;
  if (!productId) throw httpError(400, 'productId is required');
  const nextQty = Number(qty);
  if (!Number.isFinite(nextQty)) throw httpError(400, 'qty must be a number');

  const product = await Product.findById(productId).lean();
  if (!product || product.isDeleted || !product.isActive || product.status !== 'approved') {
    throw httpError(404, 'Product not found or no longer available');
  }
  if (product.type !== CHANNEL.GROCERY) {
    throw httpError(400, `"${product.name}" is not a grocery item — subscriptions are Quick Commerce only`);
  }
  if (!product.sellerId && !product.shgStoreId) {
    throw httpError(400, `"${product.name}" is not sold by a subscribable store`);
  }

  // Which one vendor this basket belongs to — exactly one of the two is
  // ever set on a product, same as everywhere else this pair is used.
  const vendorQuery = product.sellerId ? { sellerId: product.sellerId } : { shgStoreId: product.shgStoreId };

  let basket = await SubscriptionBasket.findOne({ userId: req.user._id, ...vendorQuery });

  if (nextQty <= 0) {
    if (basket) {
      basket.items = basket.items.filter((i) => String(i.productId) !== String(productId));
      if (basket.items.length === 0) {
        await basket.deleteOne();
        return ok(res, null, 'Item removed');
      }
      await basket.save();
    }
  } else {
    if (!basket) {
      basket = new SubscriptionBasket({ userId: req.user._id, ...vendorQuery, items: [] });
    }

    const existing = basket.items.find((i) => String(i.productId) === String(productId));
    if (existing) existing.qty = nextQty;
    else basket.items.push({ productId, qty: nextQty });

    // Checked here, not just at final checkout — a shopper should find out a
    // basket is over the ceiling the moment they add the item that tips it,
    // not three screens later while configuring a schedule.
    const products = await Product.find({ _id: { $in: basket.items.map((i) => i.productId) } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const lines = basket.items.map((i) => ({ product: byId.get(String(i.productId)), qty: i.qty }));
    assertWeightWithinLimit(lines);

    await basket.save();
  }

  const resolved = await loadReconciled(basket);
  return ok(res, resolved, 'Basket updated', { maxWeightKg: SUBSCRIPTION_MAX_WEIGHT_KG });
});

// @desc    Drop one vendor's basket entirely — used after a subscription is
//          confirmed (that basket became the plan) or when a shopper clears it.
//          `:sellerId` names either a Seller or an SHGStore id — whichever
//          one it actually is gets deleted, the other match is simply empty.
// @route   DELETE /api/subscription-baskets/:sellerId
// @access  Private
export const clearBasket = asyncHandler(async (req, res) => {
  await SubscriptionBasket.deleteOne({
    userId: req.user._id,
    $or: [{ sellerId: req.params.sellerId }, { shgStoreId: req.params.sellerId }],
  });
  return ok(res, null, 'Basket cleared');
});
