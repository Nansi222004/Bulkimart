import { saveSellerWholesaleOffers } from '../services/sellerWholesaleOffers.service.js';
import { channelVisibility, retailVisibility, retailAllowed, wholesaleOnly } from '../utils/productChannels.js';
import User from '../models/User.js';
import { removeFailedProductUploads } from '../services/productUploadCleanup.service.js';
import mongoose from 'mongoose';
import { publicProduct } from '../utils/publicProduct.js';
import { assertWholesaleBuyer, quoteWholesaleVariant, wholesaleAvailability } from '../services/wholesaleEligibility.service.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { CHANNEL, CHANNELS, APPROVAL, LOW_STOCK_THRESHOLD, WHOLESALE_CHANNEL } from '../constants/enums.js';
import { httpError, ok, created } from '../utils/response.js';
import Seller from '../models/Seller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { parseProductSameDay, checkSameDayEligibility } from '../services/sameDay.service.js';
import { applyApprovedRatings, approvedReviewsOf, ratingBreakdownOf } from '../services/productRatings.service.js';
import { resolveCampaignPriceForProduct } from '../services/campaign.service.js';
import { isWithinRadius } from '../services/radius.service.js';
import { resolveReturnPolicyForCategory } from '../services/returnPolicy.service.js';
import { applyProductReturnSettings, parseProductReturnSettings } from '../services/productReturns.service.js';
import { normalizeWholesalePricing } from '../services/wholesalePricing.service.js';
import { persistLegacyVariantIds, resolveInventoryItem } from '../services/inventory.service.js';
import { getWholesaleCatalogPage, hasWholesaleOffers } from '../services/wholesaleCatalog.service.js';
import { removeStoredEbook, storeEbookPdf } from '../services/ebookStorage.service.js';
import { assertEbookUploadOwnership } from '../services/digitalProduct.service.js';

const parseDigitalDetails = (input) => {
  let details = input;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); }
    catch { throw httpError(400, 'E-book metadata must be valid JSON'); }
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw httpError(400, 'E-book metadata must be an object');
  }
  return details;
};

const truthy = (value) => value === true || value === 'true';

/**
 * An e-book has exactly one priced variant. With a copy limit its stock is the
 * copies left (a whole number); without one it is unlimited and stock stays 0.
 */
const validateEbookVariants = (variants, stockTracked) => {
  if (variants.length !== 1 || !Number.isFinite(Number(variants[0].price)) || Number(variants[0].price) <= 0) {
    throw httpError(400, 'An e-book requires exactly one variant with a selling price');
  }
  const stock = Number(variants[0].stock);
  if (stockTracked && (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000)) throw httpError(400, 'Copies available must be a whole number from 0 to 1,000,000');
  if (!stockTracked && stock !== 0) throw httpError(400, 'Set a copy limit to give an e-book stock');
};

/**
 * A product's `type`/`category` name its PRIMARY channel. `channels[]` names
 * every EXTRA one it was toggled into (see Product.js). A storefront asking
 * for `grocery` must therefore match either — its own products, plus anyone
 * else's (an SHG item, an ecommerce seller's) that opted into Quick too.
 *
 * category/subCategory, when given, are matched the same way inside each
 * branch: a product's primary listing must be filed under that category, OR
 * its cross-listing for this channel must be — never the other channel's
 * category, which would mean nothing to this section's tree.
 */
export const buildChannelMatch = (type, category, subCategory) => {
  const primary = { type };
  const cross = { type, isActive: { $ne: false } };

  if (category) {
    const ids = String(category).split(',').map((c) => c.trim()).filter(Boolean);
    const catMatch = ids.length > 1 ? { $in: ids } : ids[0];
    primary.category = catMatch;
    cross.category = catMatch;
  }
  if (subCategory) {
    primary.subCategory = subCategory;
    cross.subCategory = subCategory;
  }

  return { $and: [channelVisibility(type), { $or: [primary, { channels: { $elemMatch: cross } }] }] };
};

/** Non-destructive public availability for legacy SHG listings only. */
const withCustomerLegacyExclusions = async (extraAnd = []) => {
  return {
    $and: [
      ...extraAnd,
      { type: { $ne: 'shg' } },
      { shgStoreId: { $exists: false } },
    ],
  };
};

// @desc    Get public active products
// @route   GET /api/products
// @access  Public
export const getProducts = asyncHandler(async (req, res) => {
  const { type, category, subCategory, minPrice, maxPrice, inStock, isFeatured, page = 1, limit = 20 } = req.query;

  // Public search query — must be approved and active
  const filter = { status: 'approved', isActive: true, isDeleted: false };

  /**
   * A storefront never wants "everything".
   *
   * Leaving this optional meant a caller who forgot `?type=` got Quick and Shop
   * All mixed into one grid — groceries priced by the kilo sitting next to
   * electronics, from two channels that are fulfilled completely differently.
   * An unrecognised value is treated as absent rather than as an error, so an
   * older client degrades to the default storefront instead of breaking.
   */
  const resolvedType = [CHANNEL.GROCERY, CHANNEL.ECOM].includes(type) ? type : CHANNEL.GROCERY;
  if (resolvedType === CHANNEL.GROCERY) filter.fulfillmentType = { $ne: 'digital' };
  Object.assign(filter, await withCustomerLegacyExclusions([buildChannelMatch(resolvedType, category, subCategory)]));

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  if (inStock === 'true') {
    if (resolvedType === CHANNEL.ECOM) {
      filter.$and.push({ $or: [{ fulfillmentType: 'digital', 'digital.stockTracked': { $ne: true } }, { stock: { $gt: 0 } }] });
    } else {
      filter.stock = { $gt: 0 };
    }
  }

  if (isFeatured === 'true') {
    filter.isFeatured = true;
  }

  const skip = (Number(page) - 1) * Number(limit);
  let products = await Product.find(filter).select('-digital.file')
    .populate('category', 'name')
    .populate('sellerId', 'storeDetails businessName serviceRadiusKm')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Product.countDocuments(filter);

  /**
   * Best-effort seller-radius filtering for this listing, applied AFTER
   * the query/pagination above rather than as part of it — filtering a
   * per-seller radius (a different number for every seller) inside a
   * single Mongo query isn't expressible without a geo-aggregation
   * pipeline, and that's disproportionate for a listing endpoint whose
   * page is already a small, fixed-size batch. The real enforcement
   * boundary — add-to-cart and checkout — is exact, not best-effort; this
   * is a courtesy so an out-of-range seller's item isn't shown as if it
   * were orderable in the first place. Sellers with no radius configured
   * are unaffected either way.
   */
  const custLat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const custLng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
  if (custLat !== undefined && custLng !== undefined) {
    const customerLoc = { lat: custLat, lng: custLng };
    products = products.filter((p) => {
      const seller = p.sellerId;
      if (!seller || seller.serviceRadiusKm === undefined || seller.serviceRadiusKm === null) return true;
      return isWithinRadius(seller.storeDetails, customerLoc, seller.serviceRadiusKm);
    });
    // `total` stays the raw DB count, not adjusted for this in-memory
    // step — it's an upper bound once radius filtering is active, not an
    // exact count, since that would need a geo-aggregation to get right
    // across pages (see comment above).
  }

  // Old products may have variants saved before subdocument IDs were added to
  // the schema. Persist the IDs Mongoose assigned during this read before
  // returning them, otherwise the next request would hydrate different IDs and
  // add-to-cart would (correctly) reject the catalogue's now-stale selection.
  products = await Promise.all(products.map((product) => persistLegacyVariantIds(product)));

  res.status(200).json({
    success: true,
    total,
    page: Number(page),
    limit: Number(limit),
    products: products.map(publicProduct)
  });
});

// @desc    Get admin-curated featured products
// @route   GET /api/products/featured
// @access  Public
export const getFeaturedProducts = asyncHandler(async (req, res) => {
  // Same reason as the listing and the search: a featured strip belongs to one
  // storefront, not to both at once.
  const { type } = req.query;
  const resolvedType = [CHANNEL.GROCERY, CHANNEL.ECOM].includes(type) ? type : CHANNEL.GROCERY;

  const products = await Product.find({
    status: 'approved',
    isActive: true,
    isDeleted: false,
    fulfillmentType: { $ne: 'digital' },
    ...(await withCustomerLegacyExclusions([
      buildChannelMatch(resolvedType),
      { isFeatured: true },
    ])),
  }).select('-digital.file')
    .populate('category', 'name')
    .sort({ createdAt: -1 })
    .limit(10);

  res.status(200).json(products.map(publicProduct));
});

// @desc    Get grocery (QCommerce) products
// @route   GET /api/products/grocery
// @access  Public
export const getGroceryProducts = asyncHandler(async (req, res) => {
  const filter = {
    status: 'approved',
    isActive: true,
    isDeleted: false,
    fulfillmentType: { $ne: 'digital' },
    ...(await withCustomerLegacyExclusions([buildChannelMatch(CHANNEL.GROCERY)])),
  };

  const products = await Product.find(filter)
    .populate('category', 'name')
    .populate('sellerId', 'storeDetails businessName')
    .sort({ createdAt: -1 });

  res.status(200).json(products.map(publicProduct));
});

/** Turn user input into a literal, non-regex-special string before building a RegExp from it. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Text search products (typeahead — prefix/substring, not $text)
// @route   GET /api/products/search
// @access  Public
export const searchProducts = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) {
    res.status(400);
    throw new Error('Please provide search term');
  }

  // Search is scoped to the storefront it was typed into. Without this, looking
  // for "oil" in Shop All returned cooking oil from the Quick catalogue — an
  // item that basket cannot even hold, since add-to-cart routes by product type.
  const { type } = req.query;
  const resolvedType = [CHANNEL.GROCERY, CHANNEL.ECOM].includes(type) ? type : CHANNEL.GROCERY;

  /**
   * `$text` does whole-word (stemmed) token matching, never prefix/substring
   * — typing "on" would never match "Onion" no matter how long you wait,
   * because "on" and "onion" are different tokens to it. That's not a
   * typeahead feature at all, so this uses a plain case-insensitive regex
   * instead: `^` anchors it to the START of the value (a prefix match, the
   * shape actual "search as you type" needs), tried against `name` first
   * and `sellerName`/`tags` as a fallback so "Fresh Fruits Store" is still
   * findable by shop name even when no product name starts with it.
   */
  const term = escapeRegex(q.trim());
  const prefix = new RegExp('^' + term, 'i');
  // Allow multi-word flexible matching for voice queries (e.g., "fresh milk" -> matches "Amul Fresh Milk")
  const containsRegex = new RegExp(term.replace(/\s+/g, '.*'), 'i');

  const match = {
    status: 'approved',
    isActive: true,
    isDeleted: false,
    ...(resolvedType === CHANNEL.GROCERY ? { fulfillmentType: { $ne: 'digital' } } : {}),
    ...(await withCustomerLegacyExclusions([buildChannelMatch(resolvedType)])),
    $or: [{ name: containsRegex }, { sellerName: containsRegex }, { tags: containsRegex }],
  };

  // Organic name relevance only; historical paid boosts no longer affect search.
  const products = await Product.aggregate([
    { $match: match },
    {
      $addFields: {
        nameMatches: {
          $cond: [
            { $regexMatch: { input: '$name', regex: prefix } },
            0,
            { $cond: [{ $regexMatch: { input: '$name', regex: containsRegex } }, 1, 2] },
          ],
        },
      },
    },
    { $sort: { nameMatches: 1, name: 1 } },
    { $limit: 60 },
    { $project: { 'digital.file': 0 } },
  ]);

  await Product.populate(products, [
    { path: 'category', select: 'name' },
    { path: 'sellerId', select: 'businessName storeDetails.name' },
  ]);

  res.status(200).json(products.map(publicProduct));
});

/**
 * QUICK COMMERCE ONLY — read-only lookup the Seller create/edit form uses to
 * show "Category Return Window: N Days" while picking a category, before any
 * product exists yet for getProductById to ask about. Resolved live from
 * Admin's CategoryReturnPolicy via the same function that path uses — never
 * lets a Seller set or widen the window itself, only see what it currently
 * is.
 * @desc    Resolved return-window policy for one category
 * @route   GET /api/products/category-return-policy?categoryId=...
 * @access  Private (seller, shg)
 */
export const getCategoryReturnPolicyForSeller = asyncHandler(async (req, res) => {
  const { categoryId } = req.query;
  if (!categoryId) throw httpError(400, 'categoryId is required');
  const policy = await resolveReturnPolicyForCategory(categoryId);
  return ok(res, { eligible: policy.eligible, returnWindowDays: policy.returnWindowDays, source: policy.source || 'none' }, 'Category return policy');
});

// @desc    Get single product details
// @route   GET /api/products/:id
// @access  Public
export const getProductById = asyncHandler(async (req, res) => {
  let product = await Product.findById(req.params.id).select('-digital.file')
    .populate('category', 'name')
    .populate('channels.category', 'name')
    .populate('sellerId', 'storeDetails businessName');

  if (
    !product ||
    !retailAllowed(product) ||
    product.isDeleted ||
    product.type === 'shg' ||
    product.shgStoreId
  ) {
    res.status(404);
    throw new Error('Product not found');
  }

  product = await persistLegacyVariantIds(product);

  const data = product.toObject();

  const deal = await resolveCampaignPriceForProduct(product._id);
  if (deal) {
    data.campaignPrice = deal.campaignPrice;
    data.campaignDiscountValue = deal.discountValue;
    data.campaignTitle = deal.campaignTitle;
    data.campaignId = deal.campaignId;
  }

  /**
   * Resolve the live policy shown to physical retail customers. Seller settings
   * can narrow the category window; order-time terms are frozen separately.
   */
  if ([CHANNEL.GROCERY, CHANNEL.ECOM].includes(product.type) && product.fulfillmentType !== 'digital') {
    // `product.category` is populated above (for the `{name}` display field),
    // so the raw id has to be pulled back out — resolveReturnPolicyForCategory
    // walks the category TREE and needs the id, not the populated doc.
    const policy = await resolveReturnPolicyForCategory(product.category?._id || product.category);
    const resolved = applyProductReturnSettings(product, policy);
    const eligible = resolved.returnEligible;
    data.returnable = resolved.sellerReturnable;
    data.returnPolicy = {
      eligible,
      returnWindowDays: eligible ? resolved.returnWindowDays : 0,
      ...(policy.source === 'global' ? { source: 'global' } : {}),
    };
  }

  res.status(200).json(publicProduct(data));
});

/**
 * What delivery a customer can actually get, for a set of products.
 *
 * Batched on purpose. A Shop All grid asks this for every card on screen, and a
 * request per card would mean a geo query per card — twenty products, twenty
 * rider lookups, on every scroll. One call, one verdict each.
 *
 * The sellers are loaded once and shared across their listings, because a shop
 * with eight items on the page is one shop, not eight.
 *
 * Scheduled is reported as available whenever the item is orderable at all. Its
 * real serviceability is a courier question this system cannot answer while
 * Shiprocket is in mock mode, and claiming otherwise would be inventing a
 * limitation rather than reporting one.
 *
 * @route POST /api/products/delivery-options
 */
export const getDeliveryOptions = asyncHandler(async (req, res) => {
  const { productIds, destination } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw httpError(400, 'Send the products you want delivery options for');
  }
  if (productIds.length > 60) {
    throw httpError(400, 'Too many products in one request');
  }

  const products = await Product.find({
    _id: { $in: productIds },
    $and: [retailVisibility()],
    status: APPROVAL.APPROVED, isActive: true, isDeleted: false,
    fulfillmentType: { $ne: 'digital' },
  }).select('type stock sellerId sameDay fulfillmentType').lean();

  // One lookup per shop, however many of its items are on the page.
  const sellerIds = [...new Set(products.map((p) => String(p.sellerId)).filter(Boolean))];
  const sellers = new Map(
    (await Seller.find({ _id: { $in: sellerIds } })
      .select('status storeDetails sameDay').lean())
      .map((s) => [String(s._id), s])
  );

  const options = {};
  for (const p of products) {
    const sameDay = await checkSameDayEligibility({
      product: p,
      seller: sellers.get(String(p.sellerId)),
      destination,
      qty: 1,
    });

    options[String(p._id)] = {
      sameDay,
      scheduled: { available: p.type === CHANNEL.ECOM && p.stock > 0 },
    };
  }

  return ok(res, options, 'Delivery options');
});

/**
 * The same question for one product, with the quantity that is actually wanted.
 *
 * A separate route rather than a one-item batch because the product page has a
 * quantity selector, and "three of these by tonight" is a different question
 * from "one of these by tonight" when only two are in stock.
 *
 * @route GET /api/products/:id/delivery-options
 */
export const getProductDeliveryOptions = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .select('type stock variants sellerId sameDay fulfillmentType sellingChannels').lean();

  if (!product || !retailAllowed(product) || product.isDeleted || product.fulfillmentType === 'digital') throw httpError(404, 'Product not found');

  const seller = product.sellerId
    ? await Seller.findById(product.sellerId).select('status storeDetails sameDay').lean()
    : null;

  const qty = Math.max(1, Number(req.query.qty) || 1);
  const inventory = resolveInventoryItem(product, req.query.variantId, { allowLegacyPrimary: !req.query.variantId });
  const deliveryProduct = { ...product, stock: inventory.stock };
  const destination = {
    lat: req.query.lat !== undefined ? Number(req.query.lat) : undefined,
    lng: req.query.lng !== undefined ? Number(req.query.lng) : undefined,
  };

  const sameDay = await checkSameDayEligibility({ product: deliveryProduct, seller, destination, qty });

  return ok(res, {
    sameDay,
    scheduled: { available: product.type === CHANNEL.ECOM && inventory.stock >= qty },
  }, 'Delivery options');
});

/**
 * Validate the category a vendor is listing into.
 *
 * Three rules, all enforced on the SERVER — the client only filters for
 * convenience and must never be trusted:
 *   1. the category exists and is active
 *   2. it belongs to the vendor's own channel (an ecommerce seller cannot list
 *      into a grocery or SHG category by tampering with the request)
 *   3. it is a LEAF (no active children) — listing against a header category
 *      makes browse and filtering useless
 *
 * Returns { categoryId, subCategoryId } where subCategory is the parent, so
 * filters and breadcrumbs do not need an extra lookup.
 */
const resolveListingCategory = async (categoryId, channel) => {
  const cat = await Category.findById(categoryId);
  if (!cat || !cat.isActive) {
    throw httpError(400, 'Selected category is not available');
  }
  // An SHG vendor's products always live under the SHG category tree, no
  // matter which storefront (grocery/ecommerce) they're being listed into —
  // only their `type` field changes per channel, not their category.
  if (cat.type !== channel) {
    throw httpError(400, `That category belongs to the ${cat.type} section — please pick a ${channel} category`);
  }

  const hasChildren = await Category.exists({ parent: cat._id, isActive: true });
  if (hasChildren) {
    throw httpError(400, 'Please choose a specific sub-category rather than a top-level one');
  }

  return { categoryId: cat._id, subCategoryId: cat.parent || undefined };
};

/**
 * Parse and validate the extra channels a listing wants to cross-list into.
 *
 * `raw` is whatever the client sent — a JSON string (multipart form field) or
 * already an array. Each entry needs its own category because categories are
 * channel-scoped; a grocery leaf id sent for the ecommerce channel is exactly
 * as wrong as a seller tampering with their primary category, so it goes
 * through the same server-side check. The primary channel is excluded here —
 * it already lives on the top-level `type`/`category` fields — and duplicate
 * channel types in the input are silently collapsed to the first occurrence.
 */
// `shg` is not a listing choice — it is who the seller IS (an approved SHG
// store), which every product created under that role already carries via
// `shgStoreId`. Letting it be added as a cross-listed channel would let a
// regular seller self-badge as SHG-made, so it is excluded from both entry
// points that build a `channels` array.
const CROSS_LISTABLE_CHANNELS = [CHANNEL.GROCERY, CHANNEL.ECOM];

const resolveChannelList = async (raw, primaryType) => {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) return [];

  const seen = new Set([primaryType]);
  const resolved = [];
  for (const entry of list) {
    if (!entry || !entry.type || !entry.category) continue;
    if (!CROSS_LISTABLE_CHANNELS.includes(entry.type)) {
      throw httpError(400, `Invalid channel "${entry.type}"`);
    }
    if (seen.has(entry.type)) continue;
    seen.add(entry.type);

    const { categoryId, subCategoryId } = await resolveListingCategory(entry.category, entry.type);
    resolved.push({
      type: entry.type,
      category: categoryId,
      subCategory: subCategoryId,
      isActive: entry.isActive !== false,
    });
  }
  return resolved;
};

/** Seller-owned catalog mutation; historical SHG products remain inaccessible. */
const assertOwnsProduct = async (product, req) => {
  let authorized = false;
  if (product.sellerId && req.userType !== 'admin') {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (seller && product.sellerId.toString() === seller._id.toString()) authorized = true;
  }
  if (!authorized && req.userType !== 'admin') {
    throw httpError(403, 'Not authorized to edit this product');
  }
};

const applyWholesalePricing = (variants, seller, existingVariants = []) => variants.map((variant, index) => {
  const explicit = Object.prototype.hasOwnProperty.call(variant, 'wholesalePricing');
  // Stable variant IDs are the identity. Names and array positions are
  // editable and must never move a wholesale price book to a different SKU.
  const existing = variant._id
    ? existingVariants.find((item) => String(item._id) === String(variant._id))
    : undefined;
  const requested = explicit
    ? variant.wholesalePricing
    : existing?.wholesalePricing;
  if (requested === undefined) return variant;

  const normalized = normalizeWholesalePricing(requested);
  if (explicit && normalized?.enabled && (
    seller?.status !== 'approved'
    || seller.wholesaleChannel?.status !== 'approved'
    || !seller.salesChannels?.includes(WHOLESALE_CHANNEL)
  )) {
    throw httpError(403, 'Wholesale pricing requires an approved Wholesale seller channel');
  }
  if (explicit && normalized?.enabled && (!Number.isSafeInteger(Number(variant.stock)) || Number(variant.stock) < normalized.minimumQuantity)) throw httpError(409, 'Available variant stock must meet the Wholesale MOQ');
  if (normalized === undefined) {
    const { wholesalePricing: _removed, ...withoutWholesale } = variant;
    return withoutWholesale;
  }
  return { ...variant, wholesalePricing: normalized };
});

/**
 * Save only wholesale terms for an existing seller-owned product. This narrow
 * write intentionally cannot accept price, stock, seller ID, or inventory
 * fields, and uses array filters so retail edits and inventory mutations do
 * not get overwritten by a stale product document.
 */
export const updateProductWholesalePricing = asyncHandler(async (req, res) => {
  if (req.userType !== 'user' || !req.user.roles?.includes('seller')) throw httpError(403, 'Seller access required');
  const result = await saveSellerWholesaleOffers(req.user._id, req.params.id, req.body);
  res.status(200).json({ success: true, message: 'Wholesale terms saved.', ...result });
});

/**
 * Public Wholesale catalog. Purchase quotes and writes retain buyer checks;
 * price books remain separate from retail responses.
 */
export const getWholesaleCatalog = asyncHandler(async (req, res) => {
  if (Object.keys(req.query).some(key => !['page', 'limit', 'q', 'category', 'productId', 'sort'].includes(key))) throw httpError(400, 'Invalid Wholesale query parameter');
  if (req.query.sort !== undefined && !['default', 'name', 'price-asc', 'price-desc'].includes(req.query.sort)) throw httpError(400, 'Invalid Wholesale sort');
  res.set('Cache-Control', 'private, no-store');
  const page = Number(req.query.page ?? 1), limit = Number(req.query.limit ?? 24);
  if (req.query.productId !== undefined && (typeof req.query.productId !== 'string' || !mongoose.isValidObjectId(req.query.productId))) throw httpError(400, 'Invalid Wholesale product ID');
  if ((req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 120)) || (req.query.category !== undefined && (typeof req.query.category !== 'string' || req.query.category.length > 160))) throw httpError(400, 'Invalid Wholesale filter');
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Invalid catalog pagination');
  const result = await getWholesaleCatalogPage({ page, limit, productId: req.query.productId, q: req.query.q?.trim(), category: req.query.category, sort: req.query.sort });
  res.status(200).json({ success: true, ...result });
});

/** Public navigation hint only: no seller, product, price, or stock data. */
export const getWholesaleAvailability = asyncHandler(async (req, res) => {
  if (Object.keys(req.query).some(key => !['productId', 'variantId'].includes(key))) throw httpError(400, 'Invalid Wholesale query parameter');
  for (const key of ['productId', 'variantId']) if (req.query[key] !== undefined && (typeof req.query[key] !== 'string' || !mongoose.isValidObjectId(req.query[key]))) throw httpError(400, 'Invalid Wholesale product or variant ID');
  if (req.query.variantId && !req.query.productId) throw httpError(400, 'Product ID is required with variant ID');
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, enabled: await hasWholesaleOffers({ productId: req.query.productId, variantId: req.query.variantId }) });
});

// Read-only preview. The same pricing/eligibility service also validates cart
// writes and checkout; a preview never reserves stock or creates a cart/order.
export const previewWholesaleProduct = asyncHandler(async (req, res) => {
  assertWholesaleBuyer(req);
  const { productId, variantId, quantity } = req.body;
  if (![productId, variantId].every(id => typeof id === 'string' && mongoose.isValidObjectId(id))) throw httpError(400, 'Invalid Wholesale product or variant ID');
  const product = await Product.findById(productId).select('+variants.wholesalePricing').populate('category', 'isActive');
  if (!product?.category || product.category.isActive === false) throw httpError(409, 'This Wholesale product is unavailable');
  const seller = await Seller.findById(product.sellerId).populate('userId', 'isActive');
  const quote = quoteWholesaleVariant(product, seller, variantId, quantity);
  const variant = product.variants.find(item => String(item._id) === variantId);
  const availability = wholesaleAvailability(variant);
  const campaign = await resolveCampaignPriceForProduct(productId);
  const retailPrice = campaign ? Math.round(variant.price * (1 - campaign.discountValue / 100) * 100) / 100 : variant.price;
  const retailPaise = Math.round(retailPrice * 100);
  const comparisonTotal = retailPaise * quote.quantity;
  const savingsPaise = comparisonTotal - Math.round(quote.lineTotal * 100);
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, data: {
    productId, variantId, quantity: quote.quantity, unitPrice: quote.unitPrice,
    subtotal: quote.lineTotal, ...quote.wholesaleSnapshot,
    availableStock: quote.inventory.stock, maxQuantity: availability.maxQuantity,
    priceTiers: availability.priceTiers,
    retailUnitPrice: Number.isSafeInteger(comparisonTotal) && retailPaise > 0 ? retailPaise / 100 : null,
    savings: Number.isSafeInteger(comparisonTotal) && retailPaise > 0 && savingsPaise > 0 ? savingsPaise / 100 : null,
  } });
});

// @desc    Create a product (Seller/SHG)
// @route   POST /api/products
// @access  Private
export const createProduct = asyncHandler(async (req, res) => {
  const {
    type, name, description, category, subCategory, dimensions, tags, sameDay,
    brandName, gstRate, variants, isHandmade, returnable, fulfillmentType = 'physical', digital,
  } = req.body;

  let sellingChannels = req.body.sellingChannels;
  if (typeof sellingChannels === 'string') {
    try { sellingChannels = JSON.parse(sellingChannels); } catch { throw httpError(400, 'Invalid selling channels'); }
  }
  if (sellingChannels !== undefined && (!Array.isArray(sellingChannels) || !sellingChannels.length || new Set(sellingChannels).size !== sellingChannels.length || sellingChannels.some(c => !['ecommerce','grocery','wholesale'].includes(c)))) throw httpError(400, 'Invalid selling channels');
  const b2bOnly = wholesaleOnly({ sellingChannels });
  if (sellingChannels && !b2bOnly && !sellingChannels.includes(type)) throw httpError(400, 'Retail selling channels must include the primary listing type');
  if (b2bOnly && (fulfillmentType !== 'physical' || req.body.channels !== undefined || sameDay !== undefined)) throw httpError(400, 'Wholesale-only products must be physical and cannot enable retail channels or Same-Day');

  if (!['physical', 'digital'].includes(fulfillmentType)) throw httpError(400, 'Invalid product fulfillment type');

  if (!type || !name || !category) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  if (String(name).trim().length < 3) throw httpError(400, 'Product name must be at least 3 characters');

  // Pricing, stock, unit and weight are entered per variant now, not on the
  // product itself — at least one is required, and each is checked the same
  // way the old root-field checks used to be.
  let parsedVariants = variants
    ? (() => { try { return typeof variants === 'string' ? JSON.parse(variants) : variants; } catch { throw httpError(400, 'Variants must be valid JSON'); } })()
    : [];
  if (!Array.isArray(parsedVariants) || parsedVariants.length === 0) {
    throw httpError(400, 'Please add at least one variant with pricing and stock');
  }
  if (parsedVariants.length > 100 || parsedVariants.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw httpError(400, 'Provide at most 100 valid variants');
  // Variant identity is server-assigned; never let a seller choose IDs.
  parsedVariants = parsedVariants.map(({ _id: _ignoredId, ...variant }) => variant);
  if (b2bOnly) parsedVariants = parsedVariants.map(v => ({ ...v, price: 0, mrp: 0 }));
  const digitalDetails = digital !== undefined ? parseDigitalDetails(digital) : {};
  if (fulfillmentType === 'digital') {
    if (type !== CHANNEL.ECOM) throw httpError(400, 'E-books can only be listed in E-Commerce');
    validateEbookVariants(parsedVariants, truthy(digitalDetails.stockTracked));
    if (!String(digitalDetails.author || '').trim() || !String(digitalDetails.language || '').trim()) {
      throw httpError(400, 'Author and language are required for an e-book');
    }
    if ((digitalDetails.format || 'pdf') !== 'pdf') throw httpError(400, 'Only PDF e-books are currently supported');
    parsedVariants[0].unit = 'piece';
    parsedVariants[0].mrp = parsedVariants[0].mrp || parsedVariants[0].price;
  } else if (digital !== undefined) {
    throw httpError(400, 'Digital metadata is only valid for an e-book');
  }
  parsedVariants.forEach((v, i) => {
    const label = v.name || `Variant ${i + 1}`;
    if (!v.name) throw httpError(400, `Variant ${i + 1} needs a name`);
    if (!b2bOnly && (v.price === undefined || v.price === '' || Number(v.price) <= 0)) throw httpError(400, `"${label}" needs a valid selling price`);
    if (b2bOnly && (!Number.isSafeInteger(Number(v.stock)) || Number(v.stock) < 0)) throw httpError(400, 'Wholesale stock must be a non-negative whole number');
    if (b2bOnly && (v.attributes !== undefined && (!Array.isArray(v.attributes) || v.attributes.some(a => !a || typeof a.name !== 'string' || !a.name.trim() || typeof a.value !== 'string' || !a.value.trim())))) throw httpError(400, 'Variant attributes need a name and value');
    if (v.stock === undefined || v.stock === '' || Number(v.stock) < 0) throw httpError(400, `"${label}" stock cannot be negative`);
    if (v.mrp !== undefined && v.mrp !== '' && Number(v.price) > Number(v.mrp)) throw httpError(400, `"${label}" price cannot be higher than its MRP`);
  });

  // At least one image — a listing with no photo is not sellable.
  if (!req.files || req.files.length === 0) {
    throw httpError(400, 'Please upload at least one product image');
  }

  const returnSettings = !b2bOnly ? await parseProductReturnSettings(req.body, { type, category, fulfillmentType }) : undefined;
  const productData = {
    ...(returnSettings ? { returnSettings } : {}),
    type,
    ...(sellingChannels !== undefined ? { sellingChannels } : {}),
    fulfillmentType,
    ...(fulfillmentType === 'digital' ? { digital: {
      author: String(digitalDetails.author).trim(),
      language: String(digitalDetails.language).trim(),
      format: 'pdf',
      licenseTerms: digitalDetails.licenseTerms ? String(digitalDetails.licenseTerms).trim() : undefined,
      stockTracked: truthy(digitalDetails.stockTracked),
    } } : {}),
    name,
    description,
    category,
    subCategory,
    dimensions: dimensions ? (typeof dimensions === 'string' ? JSON.parse(dimensions) : dimensions) : undefined,
    tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
    /**
     * Same-Day, if the seller asked for it.
     *
     * `undefined` when they did not, so a listing that never opts in carries no
     * `sameDay` field at all — the same shape as every product created before
     * this existed. Note what is absent: no price of any kind. Same-Day is a way
     * of delivering this item, and variant `price` stays the only one.
     */
    sameDay: fulfillmentType === 'physical' ? parseProductSameDay(sameDay) : undefined,
    brandName,
    gstRate: gstRate ? Number(gstRate) : 0,
    isHandmade: isHandmade === true || isHandmade === 'true',
    /**
     * QUICK COMMERCE ONLY — see Product.js's `returnable` field comment.
     * Silently ignored for any other `type`: an E-commerce/SHG listing
     * gets no `returnable` write at all here, so it keeps the schema
     * default (`false`, meaningless for those channels) rather than a
     * seller being able to set a flag that channel doesn't use.
     */
    ...(type === CHANNEL.GROCERY ? { returnable: returnable === true || returnable === 'true' } : {}),
    // Root price/mrp/stock/unit/weight are synced from variants[0] by the
    // model's pre-validate hook — not set here.
    variants: parsedVariants,
    // Listings go live immediately — there is no pre-moderation queue. The admin
    // keeps takedown powers (PATCH /api/admin/products/:id/reject) for anything
    // that breaks policy after the fact.
    status: fulfillmentType === 'digital' ? APPROVAL.PENDING : APPROVAL.APPROVED,
    isActive: fulfillmentType !== 'digital'
  };

  if (![CHANNEL.GROCERY, CHANNEL.ECOM].includes(type)) {
    throw httpError(400, 'Products must be listed in Quick Commerce or Shop All');
  }
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller || seller.status !== 'approved') {
    res.status(400);
    throw new Error('Approved Seller account required to list products');
  }
  parsedVariants = applyWholesalePricing(parsedVariants, seller);
  if (sellingChannels && !sellingChannels.includes('wholesale') && parsedVariants.some(v => v.wholesalePricing?.enabled)) throw httpError(400, 'Enabled Wholesale offers require the Wholesale selling channel');
  if (sellingChannels?.includes('wholesale') && (seller.wholesaleChannel?.status !== 'approved' || !seller.salesChannels?.includes('wholesale'))) throw httpError(403, 'Approved Wholesale access required');
  if (b2bOnly && !parsedVariants.some(v => v.wholesalePricing?.enabled)) throw httpError(400, 'Configure at least one enabled Wholesale variant');
  if (fulfillmentType === 'digital' && parsedVariants.some((variant) => variant.wholesalePricing?.enabled)) throw httpError(400, 'Wholesale is not available for digital products');
  productData.variants = parsedVariants;
  productData.sellerId = seller._id;
  productData.sellerName = seller.storeDetails?.name || seller.businessName;

  // Category is validated only now, because the channel is decided above.
  const { categoryId, subCategoryId } = await resolveListingCategory(category, productData.type);
  productData.category = categoryId;
  productData.subCategory = subCategoryId;

  const resolvedChannels = await resolveChannelList(req.body.channels, productData.type);
  if (fulfillmentType === 'digital' && resolvedChannels.length) {
    throw httpError(400, 'E-books cannot be cross-listed into physical storefront channels');
  }
  if (resolvedChannels.length) productData.channels = resolvedChannels;
  if (sellingChannels?.some(c => c !== 'wholesale' && c !== type && !resolvedChannels.some(entry => entry.type === c && entry.isActive))) throw httpError(400, 'Selling channels must have matching category listings');

  // Validate the complete document before uploading; one insert stores both
  // identity/inventory and all variant price books, never a follow-up PATCH.
  if (b2bOnly) await new Product(productData).validate();

  // Upload images to Cloudinary (multer caps the count at 5)
  const folder = `products/${productData.sellerId}`;
  const imageUrls = [];
  let product;
  try {
  for (const file of req.files) {
    imageUrls.push(await uploadToCloudinary(file.buffer, folder));
  }
  productData.images = imageUrls;

  product = b2bOnly ? await mongoose.connection.transaction(async session => {
    if (!(await Seller.updateOne({ _id: seller._id, status: 'approved', 'wholesaleChannel.status': 'approved', salesChannels: 'wholesale' }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Approved Wholesale access required');
    if (!(await User.updateOne({ _id: req.user._id, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Seller account is unavailable');
    if (!(await Category.updateOne({ _id: categoryId, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(409, 'Category is unavailable');
    const [created] = await Product.create([productData], { session });
    return created;
  }) : await Product.create(productData);
  } catch (error) {
    if (b2bOnly) await removeFailedProductUploads(imageUrls, folder);
    throw error;
  }

  // Populate so the seller's list can render immediately without a refetch
  await product.populate('category', 'name slug type');

  res.status(201).json({
    success: true,
    message: fulfillmentType === 'digital'
      ? 'E-book draft created. Upload its PDF file before submitting it for moderation.'
      : 'Product published successfully and is now live.',
    product
  });
});

/** Seller-owned private PDF upload. This endpoint stores bytes only on the
 * backend's private filesystem; there is intentionally no download route. */
export const uploadDigitalProductFile = asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a PDF e-book file to upload');
  const sellerId = req.seller?._id;
  if (!sellerId) throw httpError(403, 'An approved seller account is required');

  const productQuery = Product.findById(req.params.id);
  const product = typeof productQuery.select === 'function'
    ? await productQuery.select('+digital.file.fileId')
    : await productQuery;
  assertEbookUploadOwnership(product, sellerId);

  const stored = await storeEbookPdf(req.file);
  const previousId = product.digital?.file?.fileId;
  try {
    product.digital.file = {
      fileId: stored.fileId,
      productId: product._id,
      ownerSellerId: sellerId,
      sizeBytes: stored.sizeBytes,
      format: stored.format,
      sha256: stored.sha256,
      status: 'uploaded',
      uploadedAt: stored.uploadedAt,
    };
    // A replacement returns to moderation; it cannot silently replace content
    // beneath an already approved listing.
    product.status = APPROVAL.PENDING;
    product.isActive = false;
    await product.save();
  } catch (error) {
    await removeStoredEbook(stored.fileId).catch(() => {});
    throw error;
  }
  // Keep the prior immutable file version: paid order snapshots and existing
  // entitlements may still reference it. A separately approved, manifest-based
  // retention cleanup can remove only proven-unreferenced versions later.

  return created(res, {
    productId: product._id,
    file: { status: 'uploaded', format: stored.format, sizeBytes: stored.sizeBytes, uploadedAt: stored.uploadedAt },
    moderationStatus: product.status,
  }, 'Private e-book file uploaded; listing is pending admin review');
});

// @desc    Update own product
// @route   PUT /api/products/:id
// @access  Private
export const updateProduct = asyncHandler(async (req, res) => {
  const productQuery = Product.findById(req.params.id);
  let product = typeof productQuery.select === 'function'
    ? await productQuery.select('+variants.wholesalePricing')
    : await productQuery;
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  await assertOwnsProduct(product, req);
  if (req.body.sellingChannels !== undefined) throw httpError(400, 'Selling-channel visibility cannot be changed through ordinary product editing');
  const b2bOnly = wholesaleOnly(product);
  if (b2bOnly && req.body.version !== undefined && Number(req.body.version) !== product.__v) throw httpError(409, 'Product changed. Refresh before saving');

  const {
    name, description, category, subCategory, dimensions, tags, sameDay,
    sku, brandName, gstRate, variants, isHandmade, returnable, digital,
  } = req.body;

  if (digital !== undefined && product.fulfillmentType !== 'digital') {
    throw httpError(400, 'Digital metadata cannot be added to a physical product');
  }
  if (digital !== undefined && product.fulfillmentType === 'digital') {
    const details = parseDigitalDetails(digital);
    if (!String(details.author || '').trim() || !String(details.language || '').trim()) {
      throw httpError(400, 'Author and language are required for an e-book');
    }
    if ((details.format || 'pdf') !== 'pdf') throw httpError(400, 'Only PDF e-books are currently supported');
    product.digital.author = String(details.author).trim();
    product.digital.language = String(details.language).trim();
    product.digital.format = 'pdf';
    product.digital.licenseTerms = details.licenseTerms ? String(details.licenseTerms).trim() : undefined;
    if (details.stockTracked !== undefined) product.digital.stockTracked = truthy(details.stockTracked);
    product.status = APPROVAL.PENDING;
    product.isActive = false;
  }

  let detailsChanged = false;

  // Pricing, stock, unit and weight are per-variant now — validated as a
  // whole array (same checks as creation), only when the edit actually sent
  // one. Root price/mrp/stock/unit/weight are re-synced from variants[0] by
  // the model's pre-validate hook once `product.variants` is reassigned below.
  let parsedVariants = variants !== undefined
    ? (() => { try { return typeof variants === 'string' ? JSON.parse(variants) : variants; } catch { throw httpError(400, 'Variants must be valid JSON'); } })()
    : undefined;
  if (parsedVariants !== undefined && (!Array.isArray(parsedVariants) || parsedVariants.some(v => !v || typeof v !== 'object' || Array.isArray(v)) || parsedVariants.length > 100)) throw httpError(400, 'Provide at most 100 valid variants');
  const explicitlyEnablingWholesale = Array.isArray(parsedVariants) && parsedVariants.some(variant => Object.hasOwn(variant, 'wholesalePricing') && (variant.wholesalePricing?.enabled === true || variant.wholesalePricing?.enabled === 'true'));
  if (explicitlyEnablingWholesale && product.sellingChannels && !product.sellingChannels.includes('wholesale')) throw httpError(400, 'Use Add Wholesale Offer to enable this selling channel');
  if (explicitlyEnablingWholesale && (!product.isActive || product.status !== 'approved' || !(await Category.exists({ _id: category || product.category, isActive: true })))) throw httpError(409, 'An active approved product and category are required to enable Wholesale');
  if (parsedVariants !== undefined) {
    if (!Array.isArray(parsedVariants) || parsedVariants.length === 0) {
      throw httpError(400, 'Please keep at least one variant with pricing and stock');
    }
    const existingVariantIds = new Set((product.variants || []).map((variant) => String(variant._id)));
    parsedVariants = parsedVariants.map((variant, index) => {
      if (variant._id && !existingVariantIds.has(String(variant._id))) {
        throw httpError(400, 'A variant identifier does not belong to this product');
      }
      if (!variant._id) {
        const existing = product.variants || [];
        const candidates = variant.sku
          ? existing.filter((entry) => entry.sku && String(entry.sku) === String(variant.sku))
          : existing.filter((entry) => entry.name === variant.name);
        if (candidates.length > 1) throw httpError(400, `Cannot safely identify the existing "${variant.name}" variant; refresh and include its variant ID`);
        if (candidates.length === 1) variant._id = candidates[0]._id;
        else if (index < existing.length) throw httpError(400, `Variant ${index + 1} is missing its stable ID; refresh the product and try again`);
      }
      return variant;
    });
    parsedVariants.forEach((v, i) => {
      const label = v.name || `Variant ${i + 1}`;
      if (!v.name) throw httpError(400, `Variant ${i + 1} needs a name`);
      if (b2bOnly) { v.price = 0; v.mrp = 0; }
      if (b2bOnly && (!Number.isSafeInteger(Number(v.stock)) || Number(v.stock) < 0 || (v.attributes || []).some(a => !a.name?.trim() || !a.value?.trim()))) throw httpError(400, 'Wholesale variants require whole stock and complete attributes');
      if (!b2bOnly && (v.price === undefined || v.price === '' || Number(v.price) <= 0)) throw httpError(400, `"${label}" needs a valid selling price`);
      if (v.stock === undefined || v.stock === '' || Number(v.stock) < 0) throw httpError(400, `"${label}" stock cannot be negative`);
      if (v.mrp !== undefined && v.mrp !== '' && Number(v.price) > Number(v.mrp)) throw httpError(400, `"${label}" price cannot be higher than its MRP`);
    });
    if (product.fulfillmentType === 'digital') validateEbookVariants(parsedVariants, Boolean(product.digital?.stockTracked));
    if (req.userType === 'admin') {
      const owner = await Seller.findById(product.sellerId);
      parsedVariants = applyWholesalePricing(parsedVariants, owner, product.variants || []);
    } else {
      const seller = await Seller.findOne({ userId: req.user._id });
      parsedVariants = applyWholesalePricing(parsedVariants, seller, product.variants || []);
    }
    if (product.fulfillmentType === 'digital' && parsedVariants.some((variant) => variant.wholesalePricing?.enabled)) throw httpError(400, 'Wholesale is not available for digital products');
  }

  if (name) { product.name = name; detailsChanged = true; }
  if (description) product.description = description;
  if (category) {
    // Same rules as creation: active, same channel (or the SHG tree, for an
    // SHG-owned product), and a leaf.
    const resolved = await resolveListingCategory(category, product.type);
    product.category = resolved.categoryId;
    product.subCategory = resolved.subCategoryId;
    detailsChanged = true;
  }
  if (subCategory) product.subCategory = subCategory;
  if (dimensions) product.dimensions = typeof dimensions === 'string' ? JSON.parse(dimensions) : dimensions;
  if (tags) product.tags = typeof tags === 'string' ? JSON.parse(tags) : tags;

  // The product SKU is auto-assigned once and no longer shown anywhere on
  // the frontend — this is only reached if a caller actually sends a new one.
  if (sku) product.sku = sku;
  if (brandName !== undefined) product.brandName = brandName;
  if (gstRate !== undefined) product.gstRate = Number(gstRate);
  if (isHandmade !== undefined) product.isHandmade = isHandmade === true || isHandmade === 'true';

  /**
   * QUICK COMMERCE ONLY — see Product.js's `returnable` field comment.
   * `product.type` is fixed at creation and never sent by this edit
   * (createProduct's own comment on why), so this reads the PERSISTED
   * channel, not anything from the request — an E-commerce/SHG product
   * can never pick this up even if a malformed/forged request sends it.
   */
  if (product.type === CHANNEL.GROCERY && returnable !== undefined) {
    product.returnable = returnable === true || returnable === 'true';
  }
  if (!b2bOnly) {
    const returns = await parseProductReturnSettings(req.body, product);
    if (returns) product.returnSettings = returns;
  }
  if (parsedVariants !== undefined) {
    product.variants = parsedVariants;
    detailsChanged = true;
  }

  /**
   * Same-Day settings, only when the request carries them.
   *
   * Guarded on `!== undefined` rather than truthiness, because switching
   * Same-Day off is a legitimate edit that must be saved — and a plain `if` on
   * the parsed value would treat the off state as "nothing to do" and silently
   * leave it on. An edit that says nothing about Same-Day leaves it exactly as
   * it was.
   */
  if (sameDay !== undefined) {
    if (product.fulfillmentType === 'digital') throw httpError(400, 'E-books do not support physical delivery options');
    product.sameDay = parseProductSameDay(sameDay, product.sameDay);
  }

  // Full replace of the cross-listed channels, when the edit form sends one.
  // Omitted entirely (`undefined`) leaves the existing cross-listings alone —
  // same rule as Same-Day above.
  if (req.body.channels !== undefined) {
    if (b2bOnly) throw httpError(400, 'Wholesale-only products cannot enable retail cross-listings');
    const channels = await resolveChannelList(req.body.channels, product.type);
    if (product.fulfillmentType === 'digital' && channels.length) {
      throw httpError(400, 'E-books cannot be cross-listed into physical storefront channels');
    }
    product.channels = channels;
  }

  // Edits no longer knock a listing offline — products are not pre-moderated.
  // A product an admin has explicitly REJECTED stays rejected; only the admin
  // can bring that one back.
  void detailsChanged;

  // Upload new images if provided
  if (req.files && req.files.length > 0) {
    const folder = product.sellerId ? `products/${product.sellerId}` : `products/shg-${product.shgStoreId}`;
    const imageUrls = [];
    for (const file of req.files) {
      const url = await uploadToCloudinary(file.buffer, folder);
      imageUrls.push(url);
    }
    // append or replace based on logic (here we replace)
    product.images = imageUrls;
  }

  const updatedProduct = b2bOnly ? await mongoose.connection.transaction(async session => {
    const sellerFilter = { _id: product.sellerId, status: 'approved', ...(explicitlyEnablingWholesale ? { 'wholesaleChannel.status': 'approved', salesChannels: 'wholesale' } : {}) };
    if (!(await Seller.updateOne(sellerFilter, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Seller is not eligible');
    const owner = await Seller.findById(product.sellerId).select('userId').session(session);
    if (!(await User.updateOne({ _id: owner.userId, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(403, 'Seller account is unavailable');
    if (!(await Category.updateOne({ _id: product.category, isActive: true }, { $inc: { __v: 1 } }, { session })).matchedCount) throw httpError(409, 'Category is unavailable');
    return product.save({ session });
  }) : await product.save();
  res.status(200).json({
    success: true,
    message: 'Product updated successfully.',
    product: updatedProduct
  });
});

/**
 * Flip one cross-listed channel on/off, or add a brand-new one, without
 * touching the rest of the listing.
 *
 * Deliberately separate from the full `updateProduct` edit: the seller/SHG
 * product list needs a one-tap switch per row ("show this in Quick" /
 * "show this in Shop All"), and sending the whole product body for that would
 * mean re-uploading images and re-validating fields nothing changed.
 *
 * @route  PATCH /api/products/:id/channels
 * @access Private
 */
export const updateProductChannelStatus = asyncHandler(async (req, res) => {
  const { type, isActive, category } = req.body;
  if (!type || !CROSS_LISTABLE_CHANNELS.includes(type)) {
    throw httpError(400, 'A valid channel type is required');
  }

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.fulfillmentType === 'digital') throw httpError(400, 'E-books cannot be cross-listed as physical storefront inventory');
  if (wholesaleOnly(product)) throw httpError(400, 'Wholesale-only products cannot enable retail cross-listings');
  await assertOwnsProduct(product, req);
  if (type === product.type) {
    throw httpError(400, "That is this product's primary channel — use its Active toggle instead");
  }

  const channels = product.channels || [];
  const existing = channels.find((c) => c.type === type);

  if (existing) {
    if (isActive !== undefined) existing.isActive = isActive !== false;
    if (category) {
      const resolved = await resolveListingCategory(category, type);
      existing.category = resolved.categoryId;
      existing.subCategory = resolved.subCategoryId;
    }
  } else {
    if (!category) {
      throw httpError(400, `Please pick a ${type} category to list this product there`);
    }
    const resolved = await resolveListingCategory(category, type);
    channels.push({
      type,
      category: resolved.categoryId,
      subCategory: resolved.subCategoryId,
      isActive: isActive !== false,
    });
  }

  product.channels = channels;
  await product.save();

  res.status(200).json({
    success: true,
    message: `Listing updated for ${type}.`,
    product,
  });
});

/**
 * Adjust the primary variant's stock by a signed delta (+/-), atomically.
 *
 * Deliberately NOT built on top of `updateProduct` (PUT /:id) — that route
 * reads the whole document, replaces `variants` wholesale in memory, and
 * saves it back. Two rapid stock adjustments (a real scenario: a seller
 * tapping +/- repeatedly, or two browser tabs) would each read the same
 * starting value and the second write would silently clobber the first — a
 * classic lost-update race. This route never reads-then-computes the new
 * stock value itself; `$inc` does the arithmetic inside MongoDB, so two
 * concurrent requests both land correctly regardless of ordering.
 *
 * Ownership is still checked the normal way first (`assertOwnsProduct`,
 * same helper every other mutation here uses) so a bad request gets a
 * proper 403/404 rather than a confusing "conflict". Only the numeric
 * write itself — and the "don't go negative" guard — happens inside the
 * atomic update.
 *
 * @route  PATCH /api/products/:id/stock
 * @access Private
 */
export const adjustProductStock = asyncHandler(async (req, res) => {
  const { delta } = req.body;
  const parsedDelta = Number(delta);

  if (delta === undefined || delta === null || delta === '' ||
      !Number.isFinite(parsedDelta) || !Number.isInteger(parsedDelta) || parsedDelta === 0) {
    throw httpError(400, 'Please provide a non-zero whole-number stock adjustment');
  }

  const product = await Product.findById(req.params.id).select('sellerId shgStoreId isDeleted variants stock fulfillmentType');
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.isDeleted) {
    throw httpError(400, 'This product has been deleted and can no longer be adjusted');
  }
  if (product.fulfillmentType === 'digital') throw httpError(400, 'E-books do not use physical inventory');

  await assertOwnsProduct(product, req);

  // Only meaningful when decreasing — an increase can never push stock
  // negative, so no lower-bound check is needed on that path.
  const filter = { _id: product._id };
  let update;
  if (Array.isArray(product.variants) && product.variants.length) {
    if (parsedDelta < 0) filter['variants.0.stock'] = { $gte: -parsedDelta };
    update = { $inc: { 'variants.0.stock': parsedDelta, stock: parsedDelta, __v: 1 } };
  } else {
    if (parsedDelta < 0) filter.stock = { $gte: -parsedDelta };
    update = { $inc: { stock: parsedDelta, __v: 1 } };
  }

  const updated = await Product.findOneAndUpdate(filter, update, { returnDocument: 'after' });

  if (!updated) {
    // Ownership already passed above, so a null result here can only mean
    // the negative-stock guard tripped — stock dropped below what this
    // decrease needs between the read above and this write (another
    // request beat it to it). A real optimistic-concurrency conflict, not
    // a 400 — the request itself was valid, the data just moved.
    throw httpError(409, 'Stock changed before this update could be applied — please refresh and try again');
  }

  res.status(200).json({
    success: true,
    message: 'Stock updated successfully',
    stock: updated.stock,
    product: updated,
  });
});

// @desc    Soft delete product
// @route   DELETE /api/products/:id
// @access  Private
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  await assertOwnsProduct(product, req);

  // Soft delete — must NOT reuse isActive, which is the admin "go live" flag.
  // Otherwise approving a product would resurrect a deleted one.
  product.isDeleted = true;
  product.isActive = false;
  await product.save();

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully'
  });
});

// @desc    Get seller's own products
// @route   GET /api/products/seller/mine
// @access  Private
export const getMyProducts = asyncHandler(async (req, res) => {
  let filter = { isDeleted: false };

  // The seller panel has a Shop All / Quick toggle; ?type= scopes the list to
  // the active channel — including products whose PRIMARY channel is
  // something else but were cross-listed into this one.
  if (req.query.type && [CHANNEL.GROCERY, CHANNEL.ECOM].includes(req.query.type)) {
    Object.assign(filter, buildChannelMatch(req.query.type));
  }
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }
  filter.sellerId = seller._id;

  const products = await Product.find(filter).select('+variants.wholesalePricing').populate('category', 'name isActive').sort({ createdAt: -1 });
  res.status(200).json(products);
});

/**
 * @desc    Which of these products the signed-in shopper has already
 *          reviewed — any status, not only approved.
 * @route   GET /api/products/reviews/mine?productIds=a,b,c
 * @access  Private
 *
 * Addressed at "am I done here", not "what did I say" — this is what a
 * delivered-order screen needs to decide whether to show a Rate & Review
 * button or an already-submitted badge for each item, without re-deriving
 * `addProductReview`'s one-review-per-shopper rule on the client. Reused
 * across sessions and across a reorder of the same product, unlike a badge
 * kept only in local component state.
 */
export const getMyReviewedProductIds = asyncHandler(async (req, res) => {
  const ids = String(req.query.productIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) return ok(res, { reviewedProductIds: [] });

  // A product matches once it has ANY review by this user — the same
  // condition addProductReview itself checks before allowing a new one.
  const products = await Product.find({
    _id: { $in: ids },
    'ratings.reviews.userId': req.user._id,
  }).select('_id').lean();

  return ok(res, { reviewedProductIds: products.map((p) => String(p._id)) });
});

/**
 * @desc    Add and publish a product review
 * @route   POST /api/products/:id/reviews
 * @access  Private
 *
 * Published reviews contribute to the product's score. Admins can subsequently
 * moderate them through the existing review management screen.
 */
export const addProductReview = asyncHandler(async (req, res) => {
  const { rating, comment, images } = req.body;

  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw httpError(400, 'Please give a rating between 1 and 5 stars');
  }

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  // One review per shopper per product, whatever state it is in — a rejected
  // review is still an answer, and re-posting would be a way around it.
  // Guarded on the id existing: a review whose account was removed has none.
  const alreadyReviewed = product.ratings.reviews.find(
    (r) => r.userId && String(r.userId) === String(req.user._id)
  );

  if (alreadyReviewed) {
    res.status(400);
    throw new Error('Product already reviewed by you');
  }

  const reviewImages = images === undefined ? [] : images;
  if (!Array.isArray(reviewImages) || reviewImages.some(image => typeof image !== 'string')
    || reviewImages.length + (req.files?.length || 0) > 4) {
    throw httpError(400, 'You can upload up to 4 review photos.');
  }
  const uploadedImages = await Promise.all((req.files || []).map(file => uploadToCloudinary(file.buffer, 'reviews', { resource_type: 'image' })));

  product.ratings.reviews.push({
    userId: req.user._id,
    userName: req.user.name || '',
    rating: stars,
    comment,
    images: [...reviewImages, ...uploadedImages],
    status: 'approved',
  });

  // Recomputed from approved reviews (which now includes this newly published review).
  applyApprovedRatings(product);

  await product.save();
  res.status(201).json({
    success: true,
    message: 'Review published successfully!'
  });
});

/**
 * @desc    A product's public reviews and its star breakdown
 * @route   GET /api/products/:id/reviews
 * @access  Public
 *
 * Approved only. The summary is computed from the same list that is
 * returned, so the bars can never disagree with the reviews beneath them.
 */
export const getProductReviews = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).select('ratings sellingChannels').lean();
  if (!product || !retailAllowed(product)) {
    res.status(404);
    throw new Error('Product not found');
  }

  const approved = approvedReviewsOf(product);

  const reviews = approved
    .map((r) => ({
      _id: r._id,
      userName: r.userName || 'Shopper',
      rating: r.rating,
      comment: r.comment || '',
      images: r.images || [],
      createdAt: r.createdAt,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const count = approved.length;
  const average = count
    ? Number((approved.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count).toFixed(2))
    : 0;

  return ok(res, {
    reviews,
    summary: { average, count, breakdown: ratingBreakdownOf(product) },
  }, 'Product reviews');
});

/**
 * @desc    A shopper asks a question about a product
 * @route   POST /api/products/:id/faqs
 * @access  Private
 */
export const askProductQuestion = asyncHandler(async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) {
    throw httpError(400, 'Please type a question');
  }

  const product = await Product.findById(req.params.id).select('_id');
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  await Product.updateOne(
    { _id: product._id },
    {
      $push: {
        faqs: {
          userId: req.user._id,
          userName: req.user.name || 'Shopper',
          question,
          status: 'unanswered',
        },
      },
    }
  );

  return created(res, null, 'Question submitted! A seller will answer it soon.');
});

/**
 * @desc    A product's answered questions
 * @route   GET /api/products/:id/faqs
 * @access  Public
 *
 * Answered only — an unanswered question is between the shopper and the
 * seller until there is something to show for it.
 */
export const getProductFaqs = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).select('faqs sellingChannels').lean();
  if (!product || !retailAllowed(product)) {
    res.status(404);
    throw new Error('Product not found');
  }

  const faqs = (product.faqs || [])
    .filter((f) => f.status === 'answered')
    .map((f) => ({
      _id: f._id,
      question: f.question,
      answer: f.answer,
      answeredAt: f.answeredAt,
    }))
    .sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt));

  return ok(res, { faqs }, 'Product FAQs');
});
