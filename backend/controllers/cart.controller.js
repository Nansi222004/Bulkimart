import { buildCustomerBasket } from '../services/customerBasket.service.js';
import mongoose from 'mongoose';
import { channelAllowed, retailAllowed } from '../utils/productChannels.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { priceOrder, resolveDeliveryType } from '../services/pricing.service.js';
import { CHANNEL, CHANNELS, DELIVERY_MODE, DELIVERY_MODES } from '../constants/enums.js';
import { applyCouponCode } from '../services/coupon.service.js';
import Seller from '../models/Seller.js';
import { checkCartSameDayEligibility } from '../services/sameDay.service.js';
import { buildFulfilmentGroups } from '../services/fulfilmentGroups.service.js';
import { distanceKm } from '../utils/geo.js';
import { resolveCampaignPricesForProducts } from '../services/campaign.service.js';
import { isWithinRadius } from '../services/radius.service.js';
import { getOrCreateWallet, calculateRedemptionEligibility } from '../services/coin.service.js';
import { inventoryIdentityKey, resolveInventoryItem, isUnlimitedDigital } from '../services/inventory.service.js';

/**
 * One cart per channel. Quick and Shop All are fulfilled differently and never
 * ship together, so they never share a basket — switching the storefront toggle
 * switches the cart.
 *
 * Cart lines store a snapshot of name/image/price from when they were added.
 * That snapshot is for display only and is NEVER trusted for money: every read
 * re-checks each line against the live product, because a listing can be
 * delisted, repriced or sold out while it sits in someone's cart.
 */

const MAX_QTY_PER_LINE = 20;

const readChannel = (req) => {
  const c = req.query.channel || req.body?.channel || CHANNEL.ECOM;
  if (!CHANNELS.includes(c)) {
    throw httpError(400, `Unknown storefront "${c}". Expected one of: ${CHANNELS.join(', ')}`);
  }
  return c;
};

/** Load one channel's cart, reconcile it against live products, persist fixes. */
export const loadReconciledCart = async (userId, channel, { persist = true } = {}) => {
  const cart = await Cart.findOne({ userId, channel });
  if (!cart || cart.items.length === 0) return { items: [], warnings: [] };

  const products = await Product.find({ _id: { $in: cart.items.map((i) => i.productId) } })
    .populate('category', 'name')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  // One batched lookup for the whole cart, never one per line — see
  // campaign.service.js. A price shown here is display-only; checkout
  // resolves it again independently, so this can never become the
  // authoritative charge.
  const campaignPrices = await resolveCampaignPricesForProducts(products.map((p) => p._id));

  const warnings = [];
  const keep = [];
  let mutated = false;

  for (const line of cart.items) {
    const p = byId.get(String(line.productId));

    if (!p || !channelAllowed(p, channel) || p.isDeleted || !p.isActive || p.status !== 'approved') {
      warnings.push(`"${line.name}" is no longer available and was removed.`);
      mutated = true;
      continue;
    }
    let inventory;
    try { inventory = resolveInventoryItem(p, line.variantId, { allowLegacyPrimary: !line.variantId }); }
    catch {
      warnings.push(`"${line.name}" variant is unavailable and was removed.`);
      mutated = true;
      continue;
    }
    if (!isUnlimitedDigital(p) && inventory.stock <= 0) {
      warnings.push(`"${p.name}" is out of stock and was removed.`);
      mutated = true;
      continue;
    }
    if (Number(inventory.price) !== Number(line.price)) {
      warnings.push(`"${p.name}" price changed from ₹${line.price} to ₹${inventory.price}.`);
      line.price = inventory.price;
      mutated = true;
    }
    if (!isUnlimitedDigital(p) && inventory.stock < line.qty) {
      warnings.push(`Only ${inventory.stock} left of "${p.name}" — quantity reduced.`);
      line.qty = inventory.stock;
      mutated = true;
    }
    if (line.name !== p.name || line.image !== p.images?.[0] || line.mrp !== p.mrp) {
      line.name = p.name;
      line.image = p.images?.[0] || '';
      line.mrp = p.mrp;
      mutated = true;
    }

    keep.push({ line, product: p, inventory });
  }

  if (mutated && persist) {
    cart.items = keep.map((k) => k.line);
    await cart.save();
  }

  const items = keep.map(({ line, product, inventory }) => {
    const deal = campaignPrices.get(String(product._id));
    const effectivePrice = deal ? Number((inventory.price * (1 - Number(deal.discountValue || 0) / 100)).toFixed(2)) : inventory.price;
    return {
      _id: line._id,
      productId: product._id,
      variantId: inventory.variantId,
      sku: inventory.sku,
      variantName: inventory.variantName,
      variantAttributes: inventory.attributes,
      name: product.name,
      image: product.images?.[0] || '',
      price: effectivePrice,
      originalPrice: deal ? inventory.price : undefined,
      campaign: deal ? { id: deal.campaignId, title: deal.campaignTitle, discountValue: deal.discountValue } : undefined,
      mrp: inventory.mrp,
      qty: line.qty,
      unit: inventory.unit,
      type: product.type,
      fulfillmentType: product.fulfillmentType || 'physical',
      digital: product.fulfillmentType === 'digital' ? {
        author: product.digital?.author,
        language: product.digital?.language,
        licenseTerms: product.digital?.licenseTerms,
      } : undefined,
      sellerId: product.sellerId,
      shgStoreId: product.shgStoreId,
      category: product.category?.name || '',
      categoryId: product.category?._id || product.category,
      stock: isUnlimitedDigital(product) ? 1 : inventory.stock,
      deliveryMode: line.deliveryMode,
      additionalMessage: line.additionalMessage || '',
      lineTotal: Math.round(effectivePrice * line.qty * 100) / 100,
    };
  });

  return { items, warnings };
};

/**
 * A coupon quote is recomputed on every cart read, never stored on the cart.
 * Prices and stock move underneath a cart, so a discount worked out ten minutes
 * ago may no longer be valid — re-evaluating is the only way the number shown
 * can be trusted.
 */
const round2 = (n) => Math.round(n * 100) / 100;

const shape = async (channel, items, warnings, user, code, delivery = {}, useCoins = false) => {
  const allDigital = items.length > 0 && items.every((item) => item.fulfillmentType === 'digital');
  const hasDestination = delivery.lat !== undefined && delivery.lng !== undefined;
  const destination = hasDestination ? { lat: Number(delivery.lat), lng: Number(delivery.lng) } : null;

  /**
   * What delivery this basket can have, and what the chosen one costs.
   *
   * Priced here rather than in the checkout screen, so the figure the customer
   * agrees to is produced by the same function that will charge them. Working it
   * out in the browser would mean two implementations of one rule, and they
   * would eventually disagree — which in this codebase has already happened with
   * claimable statuses, the payout formula and address parsing.
   *
   * Only asked when there is somewhere to deliver to. Without an address the
   * question has no answer, and the cart is shown without one rather than being
   * told "unavailable", which would be a different and wronger claim.
   */
  let sameDayVerdict = null;
  if (channel === CHANNEL.ECOM && items.length > 0 && destination && !allDigital) {
    const lines = [];
    const sellers = new Map();
    for (const i of items) {
      const key = String(i.sellerId);
      if (!sellers.has(key)) sellers.set(key, await Seller.findById(i.sellerId).lean());
      lines.push({
        product: await Product.findById(i.productId).select('type stock sellerId sameDay').lean(),
        seller: sellers.get(key),
        qty: i.qty,
      });
    }
    sameDayVerdict = await checkCartSameDayEligibility({ lines, destination });
  }

  // The chosen mode only prices the basket if it is actually on offer.
  const sameDayChosen = delivery.mode === DELIVERY_MODE.SAME_DAY && sameDayVerdict?.available
    ? sameDayVerdict
    : null;

  /**
   * The distance this cart's delivery charge is priced against.
   *
   * A Same-Day basket already had its distance computed by the eligibility
   * check just above — reused. Grocery (always our own rider) is measured
   * fresh from the first item's seller — the same "first item's seller is
   * the pickup" convention documented in fulfilmentGroups.service.js, since
   * this simple (non-unified) path prices the whole basket as one trip.
   * Anything else falls back to the flat admin fee (see priceOrder).
   */
  let cartDistanceKm;
  if (sameDayChosen) {
    cartDistanceKm = sameDayChosen.distanceKm;
  } else if (channel === CHANNEL.GROCERY && items.length > 0 && destination) {
    const firstSeller = await Seller.findById(items[0].sellerId).select('storeDetails').lean();
    cartDistanceKm = distanceKm(firstSeller?.storeDetails, destination);
  }

  const base = priceOrder(items, user, null, null, cartDistanceKm);
  if (allDigital) {
    base.deliveryCharge = 0;
    base.standardFee = 0;
    base.totalAmount = base.subtotal;
  }
  let applied = null;
  let couponError = null;

  if (code) {
    applied = await applyCouponCode(code, {
      items, subtotal: base.subtotal, user, deliveryCharge: base.deliveryCharge,
    });
    if (!applied.ok) {
      couponError = applied.reason;
      applied = null;
    }
  }

  // Each channel is priced on its own — separate fulfilment, separate delivery fee.
  const pricing = priceOrder(items, user, applied, sameDayChosen, cartDistanceKm);
  if (allDigital) {
    pricing.deliveryCharge = 0;
    pricing.standardFee = 0;
    pricing.totalAmount = round2(Math.max(0, pricing.subtotal - pricing.discount - pricing.couponDiscount));
  }

  /**
   * NHCONE Coins — an optional, additive layer on top of the pricing above.
   * `pricing.totalAmount` itself is left completely untouched here (this is
   * only a preview) — order creation is the one place a Coin discount is
   * ever actually committed against a payable amount (order.controller.js).
   *
   * Eligibility is based on the TOTAL merchandise value after existing
   * discounts (coupon) — never a single product's price, and never
   * inclusive of delivery/donation, matching Section 4's ordering:
   * product/campaign price -> coupon -> ELIGIBLE VALUE -> Coins -> delivery.
   */
  const eligibleForCoinBase = round2(pricing.subtotal - pricing.discount - pricing.couponDiscount);
  const wallet = await getOrCreateWallet(user._id);
  const redemption = calculateRedemptionEligibility(eligibleForCoinBase, wallet.availableCoins);
  const coinsToUse = useCoins && redemption.eligible ? redemption.coinsToUse : 0;
  const coinDiscount = coinsToUse > 0 ? redemption.coinDiscount : 0;

  let sellerInfo = null;
  const firstSellerId = items.find((i) => i.sellerId)?.sellerId;

  if (firstSellerId) {
    const s = await Seller.findById(firstSellerId).populate('userId', 'phone name').lean();
    if (s) {
      const name = s.storeDetails?.name || s.businessName || 'Local Partner Store';
      const phone = s.storeDetails?.phone || s.userId?.phone || '';
      const addressParts = [
        s.storeDetails?.address,
        s.storeDetails?.city,
        s.storeDetails?.state,
        s.storeDetails?.pincode,
      ].filter(Boolean);
      const address = addressParts.length > 0 ? addressParts.join(', ') : (s.storeDetails?.city || '');
      sellerInfo = {
        _id: s._id,
        name,
        phone,
        address,
        city: s.storeDetails?.city || '',
      };
    }

  }

  return {
    channel,
    seller: sellerInfo,
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    pricing,
    coins: {
      eligibleForCoins: redemption.eligible,
      availableCoins: wallet.availableCoins,
      maxCoinsAllowed: redemption.maxCoinsAllowed,
      coinsToUse,
      coinDiscount,
      finalPayable: round2(pricing.totalAmount - coinDiscount),
    },
    appliedCoupon: applied?.ok ? applied.coupon : null,
    couponSavings: applied?.ok ? round2(Math.max(0,
      (allDigital
        ? round2(Math.max(0, pricing.subtotal - pricing.discount))
        : priceOrder(items, user, null, sameDayChosen, cartDistanceKm).totalAmount) - pricing.totalAmount)) : 0,
    couponError,
    deliveryType: resolveDeliveryType(items, sameDayChosen ? DELIVERY_MODE.SAME_DAY : null),
    /**
     * Both options, with the verdict behind each.
     *
     * `selected` is deliberately null until the customer picks: an order that
     * arrives today and one that arrives on Thursday cost different amounts and
     * are different promises, so choosing on their behalf is choosing wrong half
     * the time.
     */
    deliveryOptions: channel === CHANNEL.ECOM && !allDigital ? {
      sameDay: sameDayVerdict,
      scheduled: { available: items.length > 0 },
      selected: sameDayChosen ? DELIVERY_MODE.SAME_DAY
        : (delivery.mode === DELIVERY_MODE.SCHEDULED ? DELIVERY_MODE.SCHEDULED : null),
    } : null,
    warnings,
  };
};

// @desc    Get one storefront's cart
// @route   GET /api/cart?channel=grocery
// @access  Private
export const getCart = asyncHandler(async (req, res) => {
  const channel = readChannel(req);
  const { items, warnings } = await loadReconciledCart(req.user._id, channel, { persist: req.query.preserveUnavailable !== 'true' });
  // The address and the chosen mode ride on the query, so one call answers both
  // "what can I have" and "what does the one I picked cost".
  return ok(res, await shape(channel, items, warnings, req.user, req.query.coupon, {
    lat: req.query.lat,
    lng: req.query.lng,
    mode: req.query.deliveryMode,
  }, req.query.useCoins === 'true'));
});

// @desc    Item counts and totals for every channel — drives the toggle badges
// @route   GET /api/cart/summary
// @access  Private
/**
 * The whole basket, split into the fulfilments it would become.
 *
 * Additive: the per-channel carts and `GET /api/cart` are untouched, and a
 * shopper who never opens this view is unaffected. All the work lives in
 * services/fulfilmentGroups.service.js — this only reads the address off the
 * query and hands it over.
 *
 * @route GET /api/cart/unified?lat=&lng=
 */
export const getUnifiedCart = asyncHandler(async (req, res) => {
  const destination = req.query.lat !== undefined && req.query.lng !== undefined
    ? { lat: Number(req.query.lat), lng: Number(req.query.lng) }
    : undefined;

  if (destination && (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || Math.abs(destination.lat) > 90 || Math.abs(destination.lng) > 180)) throw httpError(400, 'Invalid delivery coordinates');
  if (req.query.purchaseMode === 'basket') {
    const basket = await buildCustomerBasket({ userId: req.user._id, user: req.user, destination, preview: true, couponCode: req.query.coupon });
    return ok(res, basket, 'Customer basket');
  }
  const couponCode = req.query.coupon;

  const composed = await buildFulfilmentGroups({
    userId: req.user._id,
    destination,
    user: req.user,
    couponCode,
  });

  return ok(res, composed, 'Unified cart');
});

export const getCartSummary = asyncHandler(async (req, res) => {
  const carts = await Cart.find({ userId: req.user._id }).lean();
  const summary = {};

  for (const ch of [...CHANNELS, 'wholesale']) {
    const c = carts.find((x) => x.channel === ch);
    const items = c?.items || [];
    summary[ch] = {
      count: items.reduce((n, i) => n + i.qty, 0),
      lines: items.length,
      // Indicative only — the authoritative total comes from GET /api/cart,
      // which revalidates every line against the live product first.
      subtotal: Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100,
    };
  }

  return ok(res, summary, '', { totalItems: Object.values(summary).reduce((n, s) => n + s.count, 0) });
});

// @desc    Add a product (its own channel decides which cart it lands in)
// @route   POST /api/cart
// @access  Private
export const addToCart = asyncHandler(async (req, res) => {
  if (req.body?.channel === 'wholesale' || req.body?.purchaseMode === 'wholesale') throw httpError(400, 'Use the separate Wholesale cart');
  // The cart routes are private; still assert the verified principal here so
  // a non-customer token can never create a cart with an absent/invalid owner.
  if (req.userType !== 'user' || !mongoose.isValidObjectId(req.user?._id)) {
    throw httpError(401, 'A valid customer account is required to use the cart');
  }

  const { productId, variantId, qty = 1 } = req.body;
  if (!productId) throw httpError(400, 'productId is required');

  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw httpError(400, 'Quantity must be a whole number of at least 1');
  }

  const product = await Product.findById(productId);
  if (!product || !retailAllowed(product) || !channelAllowed(product, product.type) || product.isDeleted || !product.isActive || product.status !== 'approved') {
    throw httpError(404, 'This product is not available');
  }
  if (product.type === 'shg' || product.shgStoreId) {
    throw httpError(404, 'This product is not available');
  }
  const inventory = resolveInventoryItem(product, variantId);
  const isDigital = product.fulfillmentType === 'digital';
  if (isDigital && quantity !== 1) throw httpError(400, 'An e-book can only appear once in your cart');
  if (!isUnlimitedDigital(product) && inventory.stock <= 0) throw httpError(400, `"${product.name}" is out of stock`);
  if (!isDigital && quantity > inventory.stock) throw httpError(400, `Only ${inventory.stock} left in stock`);
  if (quantity > MAX_QTY_PER_LINE) {
    throw httpError(400, `You can order at most ${MAX_QTY_PER_LINE} of one item`);
  }

  /**
   * Seller service radius — enforced here, not just left as a listing
   * filter, because this is the actual point a customer commits to buying
   * something. Only checked when both a seller radius is configured AND
   * a customer location is knowable (an explicit lat/lng, or their saved
   * default address); with neither the enforcement is silently skipped
   * rather than blocking every add-to-cart for someone who hasn't set an
   * address yet — that's an existing, unrelated flow this must not break.
   */
  if (product.sellerId && !isDigital) {
    const seller = await Seller.findById(product.sellerId).select('storeDetails serviceRadiusKm').lean();
    if (seller?.serviceRadiusKm !== undefined && seller?.serviceRadiusKm !== null) {
      const bodyLat = req.body.lat !== undefined ? Number(req.body.lat) : undefined;
      const bodyLng = req.body.lng !== undefined ? Number(req.body.lng) : undefined;
      const fallbackAddr = (req.user.addresses || []).find((a) => a.isDefault) || (req.user.addresses || [])[0];
      const customerLoc = (bodyLat !== undefined && bodyLng !== undefined)
        ? { lat: bodyLat, lng: bodyLng }
        : (fallbackAddr?.lat !== undefined ? { lat: fallbackAddr.lat, lng: fallbackAddr.lng } : undefined);

      if (customerLoc) {
        const within = isWithinRadius(seller.storeDetails, customerLoc, seller.serviceRadiusKm);
        if (!within) {
          throw httpError(409, `"${product.name}" is outside this seller's ${seller.serviceRadiusKm}km delivery area for your location`);
        }
      }
    }
  }

  // The product's own channel picks the cart — the client cannot put a grocery
  // item into the Shop All basket by passing the wrong channel.
  const channel = product.type;

  const cartOwner = { userId: req.user._id, channel };
  // Upsert the one-per-user/channel cart first. The unique compound index is
  // the final concurrency guard; the E11000 retry handles two first requests
  // racing to create that same cart.
  try {
    await Cart.updateOne(cartOwner, { $setOnInsert: { ...cartOwner, items: [] } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const racedCart = await Cart.findOne(cartOwner).select('_id').lean();
    if (!racedCart) throw err;
  }

  const newLine = {
    productId: product._id,
    ...(inventory.variantId ? { variantId: inventory.variantId } : {}),
    sku: inventory.sku,
    variantName: inventory.variantName,
    variantAttributes: inventory.attributes,
    name: product.name,
    image: product.images?.[0] || '',
    price: inventory.price,
    mrp: inventory.mrp,
    qty: quantity,
    unit: inventory.unit,
    sellerId: product.sellerId,
    shgStoreId: product.shgStoreId,
    type: product.type,
    fulfillmentType: product.fulfillmentType || 'physical',
  };

  // Apply each increment/push atomically. If another request changes the
  // same line, the quantity predicate fails and we reread/retry rather than
  // overwriting its quantity with a stale document snapshot.
  let committed = false;
  for (let attempt = 0; attempt < 5 && !committed; attempt += 1) {
    const cart = await Cart.findOne(cartOwner).select('items').lean();
    if (!cart) throw httpError(409, 'Your cart could not be opened. Please try again.');
    const identity = inventoryIdentityKey({ productId: product._id, variantId: inventory.variantId });
    const existing = cart.items.find((line) => inventoryIdentityKey(line) === identity);

    if (existing) {
      if (isDigital) {
        committed = true;
        continue;
      }
      const desired = existing.qty + quantity;
      if (desired > inventory.stock) throw httpError(400, `Only ${inventory.stock} left in stock`);
      if (desired > MAX_QTY_PER_LINE) {
        throw httpError(400, `You can order at most ${MAX_QTY_PER_LINE} of one item`);
      }
      const result = await Cart.updateOne(
        { ...cartOwner, items: { $elemMatch: { _id: existing._id, qty: existing.qty } } },
        { $inc: { 'items.$.qty': quantity } },
      );
      committed = result.modifiedCount === 1;
    } else {
      const noDuplicateLine = inventory.variantId
        ? { items: { $not: { $elemMatch: { productId: product._id, variantId: inventory.variantId } } } }
        : { items: { $not: { $elemMatch: { productId: product._id, variantId: null } } } };
      const result = await Cart.updateOne(
        { ...cartOwner, ...noDuplicateLine },
        { $push: { items: newLine } },
      );
      committed = result.modifiedCount === 1;
    }
  }
  if (!committed) throw httpError(409, 'Your cart changed at the same time. Please try again.');

  const { items, warnings } = await loadReconciledCart(req.user._id, channel);
  return ok(res, await shape(channel, items, warnings, req.user, req.body.coupon), `"${product.name}" added to your ${channel === CHANNEL.GROCERY ? 'Quick' : 'Shop All'} cart`);
});

/** Find whichever of the user's carts holds this line. */
const findCartWithItem = async (userId, itemId) => {
  const cart = await Cart.findOne({ userId, 'items._id': itemId });
  if (!cart) throw httpError(404, 'That item is not in your cart');
  if (cart.channel === 'wholesale') throw httpError(400, 'Use the separate Wholesale cart to change this line');
  return cart;
};

// @desc    Change the quantity of one cart line
// @route   PUT /api/cart/:itemId
// @access  Private
export const updateCartItem = asyncHandler(async (req, res) => {
  /**
   * How this line should travel, remembered on the line itself.
   *
   * The choice used to live in React state for the whole cart, which meant one
   * mode for every Shop All item and nothing left after a refresh. A basket
   * holding two sellers can legitimately want Same-Day from one and Scheduled
   * from the other, so the mode belongs to the line, not to the screen.
   *
   * Optional and independent of quantity: sending only a mode changes only the
   * mode, so an existing stepper call that omits it is unaffected.
   */
  const modeGiven = req.body.deliveryMode !== undefined;
  if (modeGiven && req.body.deliveryMode !== null && !DELIVERY_MODES.includes(req.body.deliveryMode)) {
    throw httpError(400, `Unknown delivery mode "${req.body.deliveryMode}" — expected ${DELIVERY_MODES.join(' or ')}`);
  }

  const quantity = req.body.qty === undefined && modeGiven ? undefined : Number(req.body.qty);
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
    throw httpError(400, 'Quantity must be a whole number of 0 or more');
  }
  if (quantity !== undefined && quantity > MAX_QTY_PER_LINE) {
    throw httpError(400, `You can order at most ${MAX_QTY_PER_LINE} of one item`);
  }

  const cart = await findCartWithItem(req.user._id, req.params.itemId);
  const line = cart.items.id(req.params.itemId);

  // Setting the quantity to zero is how a stepper removes a line.
  if (quantity === 0) {
    cart.items.pull(req.params.itemId);
  } else {
    if (quantity !== undefined) {
      const product = await Product.findById(line.productId);
      if (!product || !channelAllowed(product, cart.channel) || product.isDeleted || !product.isActive || product.status !== 'approved') {
        throw httpError(400, 'This product is no longer available');
      }
      const inventory = resolveInventoryItem(product, line.variantId);
      if (product.fulfillmentType === 'digital' && quantity !== 1) throw httpError(400, 'An e-book can only appear once in your cart');
      if (product.fulfillmentType !== 'digital' && quantity > inventory.stock) throw httpError(400, `Only ${inventory.stock} left in stock`);
      line.qty = quantity;
    }

    if (modeGiven) {
      // Quick has one way of arriving; offering it a mode would be meaningless.
      if (cart.channel !== CHANNEL.ECOM && req.body.deliveryMode !== null) {
        throw httpError(400, 'Delivery mode applies to Shop All items only');
      }
      line.deliveryMode = req.body.deliveryMode ?? undefined;
    }
  }

  await cart.save();

  const { items, warnings } = await loadReconciledCart(req.user._id, cart.channel);
  return ok(res, await shape(cart.channel, items, warnings, req.user, req.body.coupon), 'Cart updated');
});

// @desc    Remove one line
// @route   DELETE /api/cart/:itemId
// @access  Private
export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await findCartWithItem(req.user._id, req.params.itemId);
  const name = cart.items.id(req.params.itemId).name;

  cart.items.pull(req.params.itemId);
  await cart.save();

  const { items, warnings } = await loadReconciledCart(req.user._id, cart.channel);
  return ok(res, await shape(cart.channel, items, warnings, req.user, req.body?.coupon), `"${name}" removed`);
});

// @desc    Empty one storefront's cart
// @route   DELETE /api/cart?channel=grocery
// @access  Private
export const clearCart = asyncHandler(async (req, res) => {
  const channel = readChannel(req);
  await Cart.findOneAndUpdate(
    { userId: req.user._id, channel },
    { $set: { items: [] } },
    { upsert: true }
  );
  return ok(res, await shape(channel, [], [], req.user), 'Cart cleared');
});

// @desc    Update additional seller note/message for a specific cart item
// @route   PATCH /api/cart/items/:itemId/message or PATCH /api/cart/:itemId/message
// @access  Private
export const updateCartItemMessage = asyncHandler(async (req, res) => {
  const { additionalMessage } = req.body;

  if (additionalMessage !== undefined && additionalMessage !== null) {
    if (typeof additionalMessage !== 'string') {
      throw httpError(400, 'Additional message must be a string');
    }
    if (additionalMessage.length > 500) {
      throw httpError(400, 'Additional message cannot exceed 500 characters');
    }
  }

  const cart = await findCartWithItem(req.user._id, req.params.itemId);
  const line = cart.items.id(req.params.itemId);

  const cleanMessage = typeof additionalMessage === 'string' ? additionalMessage.trim() : '';
  line.additionalMessage = cleanMessage;

  await cart.save();

  const { items, warnings } = await loadReconciledCart(req.user._id, cart.channel);
  const shapedData = await shape(cart.channel, items, warnings, req.user, req.body?.coupon);

  return ok(res, shapedData, 'Additional message updated successfully');
});

