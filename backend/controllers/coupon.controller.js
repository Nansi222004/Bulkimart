import mongoose from 'mongoose';
import Coupon, { DISCOUNT_TYPE } from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import { loadReconciledCart } from './cart.controller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { evaluateCoupon, applyCouponCode, buildEvaluationContext } from '../services/coupon.service.js';
import { priceOrder } from '../services/pricing.service.js';
import { CHANNEL, CHANNELS } from '../constants/enums.js';

/* ==========================================================================
   SHOPPER SIDE
   ========================================================================== */

/** Build the same priced cart the cart screen shows, so quotes always match. */
const loadCartContext = async (user, channel) => {
  const { items } = await loadReconciledCart(user._id, channel, { persist: false });

  const base = quotePricing(items, user);
  return { items, subtotal: base.subtotal, deliveryCharge: items.every(item => item.fulfillmentType === 'digital') ? 0 : base.deliveryCharge };
};

const quotePricing = (items, user, applied = null) => {
  const priced = priceOrder(items, user, applied);
  if (items.length && items.every(item => item.fulfillmentType === 'digital')) {
    return { ...priced, deliveryCharge: 0, standardFee: 0,
      totalAmount: Math.round(Math.max(0, priced.subtotal - priced.discount - priced.couponDiscount) * 100) / 100 };
  }
  return priced;
};

// @desc    Check a code against the current cart and quote the saving
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, channel = CHANNEL.ECOM } = req.body;
  if (!CHANNELS.includes(channel)) throw httpError(400, `Unknown storefront "${channel}"`);

  const ctx = await loadCartContext(req.user, channel);
  if (ctx.items.length === 0) throw httpError(400, 'Your cart is empty');

  const result = await applyCouponCode(code, { ...ctx, user: req.user });

  if (!result.ok) {
    // 200, not an error: "you need ₹200 more" is a normal answer the cart
    // screen has to show, not an exception.
    return ok(res, { valid: false, reason: result.reason }, result.reason);
  }

  const pricing = quotePricing(ctx.items, req.user, result);
  const base = quotePricing(ctx.items, req.user);

  return ok(res, {
    valid: true,
    coupon: result.coupon,
    discount: result.discount,
    freeShipping: result.freeShipping,
    eligibleItems: result.eligibleCount,
    pricing,
    savings: Math.round(Math.max(0, base.totalAmount - pricing.totalAmount) * 100) / 100,
  }, `"${result.coupon.code}" is available`);
});

// @desc    Offers this shopper can actually use right now
// @route   GET /api/coupons/available?channel=grocery
// @access  Private
export const getAvailableCoupons = asyncHandler(async (req, res) => {
  const channel = req.query.channel || CHANNEL.ECOM;
  if (!CHANNELS.includes(channel)) throw httpError(400, `Unknown storefront "${channel}"`);

  const now = new Date();
  const coupons = await Coupon.find({
    isActive: true,
    channel: { $in: [channel, 'all'] },
    $and: [
      { $or: [{ startsAt: { $lte: now } }, { startsAt: null }] },
      { $or: [{ expiresAt: { $gte: now } }, { expiresAt: null }] },
    ],
  }).sort({ minOrderValue: 1, createdAt: -1, _id: 1 });

  const ctx = await loadCartContext(req.user, channel);

  // Batch the per-coupon lookups once instead of twice per coupon.
  const batch = await buildEvaluationContext(req.user._id, coupons.map((c) => c._id));
  const base = quotePricing(ctx.items, req.user);

  // Each one is evaluated against the real cart, so the list can say exactly
  // why a code is not usable yet instead of hiding it.
  const results = [];
  for (const c of coupons) {
    const r = await evaluateCoupon(c, { ...ctx, ...batch, user: req.user });
    // The engine checks its global subtotal minimum before item scope. Probe
    // only that gate to see whether every other rule would permit this offer.
    const thresholdReady = Number(c.minOrderValue) > 0 && ctx.items.length > 0 && ctx.subtotal < c.minOrderValue
      ? await evaluateCoupon(c, { ...ctx, ...batch, user: req.user, subtotal: c.minOrderValue })
      : null;
    const threshold = !c.cdsMembersOnly && Number(c.minOrderValue) > 0 && (r.ok || thresholdReady?.ok) ? {
      minimumOrderValue: c.minOrderValue,
      eligibleOrderValue: ctx.subtotal,
      remainingAmount: Math.round(Math.max(0, c.minOrderValue - ctx.subtotal) * 100) / 100,
      progressPercentage: Math.min(100, Math.round(ctx.subtotal / c.minOrderValue * 100)),
    } : null;
    results.push({
      code: c.code,
      isPublic: c.isPublic !== false,
      cdsMembersOnly: c.cdsMembersOnly === true,
      title: c.title,
      description: c.description,
      discountType: c.discountType,
      value: c.value,
      maxDiscount: c.maxDiscount,
      minOrderValue: c.minOrderValue,
      expiresAt: c.expiresAt,
      applicable: r.ok,
      reason: r.ok ? null : r.reason,
      savingNow: r.ok ? Math.round(Math.max(0, base.totalAmount - quotePricing(ctx.items, req.user, r).totalAmount) * 100) / 100 : 0,
      freeShipping: r.ok ? r.freeShipping : false,
      threshold,
      shopMore: c.products?.length === 1 ? { type: 'product', id: String(c.products[0]) }
        : c.categories?.length === 1 ? { type: 'category', id: String(c.categories[0]) } : null,
    });
  }

  // Usable offers first, then the biggest saving.
  results.sort((a, b) => (b.applicable - a.applicable) || (b.savingNow - a.savingNow) ||
    ((a.minOrderValue || 0) - (b.minOrderValue || 0)) || a.code.localeCompare(b.code));

  return ok(res, results, '', { cartSubtotal: ctx.subtotal });
});

/* ==========================================================================
   ADMIN SIDE
   ========================================================================== */

const parseCouponBody = (body) => {
  const {
    code, title, description, discountType, value, maxDiscount, minOrderValue,
    channel, categories, products, sellers,
    totalUsageLimit, perUserLimit,
    firstOrderOnly, isPublic,
    startsAt, expiresAt, isActive,
  } = body;

  const doc = {};
  if (code !== undefined) doc.code = String(code).trim().toUpperCase();
  if (title !== undefined) doc.title = title;
  if (description !== undefined) doc.description = description;
  if (discountType !== undefined) doc.discountType = discountType;
  if (value !== undefined) doc.value = Number(value);
  if (maxDiscount !== undefined) doc.maxDiscount = Number(maxDiscount) || 0;
  if (minOrderValue !== undefined) doc.minOrderValue = Number(minOrderValue) || 0;
  if (channel !== undefined) doc.channel = channel;
  if (categories !== undefined) doc.categories = categories || [];
  if (products !== undefined) doc.products = products || [];
  if (sellers !== undefined) doc.sellers = sellers || [];
  if (totalUsageLimit !== undefined) doc.totalUsageLimit = Number(totalUsageLimit) || 0;
  if (perUserLimit !== undefined) doc.perUserLimit = Number(perUserLimit) || 0;
  if (firstOrderOnly !== undefined) doc.firstOrderOnly = !!firstOrderOnly;
  if (isPublic !== undefined) doc.isPublic = !!isPublic;
  if (startsAt !== undefined) doc.startsAt = startsAt ? new Date(startsAt) : undefined;
  if (expiresAt !== undefined) doc.expiresAt = expiresAt ? new Date(expiresAt) : undefined;
  if (isActive !== undefined) doc.isActive = !!isActive;
  return doc;
};

// Older documents may retain the retired field. Omit it from admin DTOs
// without rewriting stored coupons or requiring a database migration.
const couponDto = (coupon) => {
  const dto = coupon.toObject ? coupon.toObject() : { ...coupon };
  delete dto.autoApply;
  return dto;
};

const validateCouponDoc = (doc) => {
  if (!doc.code) throw httpError(400, 'A coupon code is required');
  if (!/^[A-Z0-9_-]{3,24}$/.test(doc.code)) {
    throw httpError(400, 'Code must be 3–24 characters: letters, numbers, hyphen or underscore');
  }
  if (!doc.title) throw httpError(400, 'A title is required');
  if (!Object.values(DISCOUNT_TYPE).includes(doc.discountType)) {
    throw httpError(400, `Discount type must be one of: ${Object.values(DISCOUNT_TYPE).join(', ')}`);
  }
  if (doc.discountType === DISCOUNT_TYPE.PERCENTAGE) {
    if (!(doc.value > 0 && doc.value <= 100)) {
      throw httpError(400, 'A percentage coupon needs a value between 1 and 100');
    }
  }
  if (doc.discountType === DISCOUNT_TYPE.FIXED && !(doc.value > 0)) {
    throw httpError(400, 'A fixed coupon needs an amount greater than zero');
  }
  if (doc.startsAt && doc.expiresAt && doc.startsAt > doc.expiresAt) {
    throw httpError(400, 'The end date cannot be before the start date');
  }
};

// @desc    List coupons
// @route   GET /api/admin/coupons
// @access  Private/Admin
export const listCoupons = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, search, channel } = req.query;
  const now = new Date();

  const filter = {};
  if (channel && channel !== 'all') filter.channel = { $in: [channel, 'all'] };
  if (search) filter.$or = [
    { code: new RegExp(search, 'i') },
    { title: new RegExp(search, 'i') },
  ];
  if (status === 'active') Object.assign(filter, { isActive: true, $or: [{ expiresAt: { $gte: now } }, { expiresAt: null }] });
  if (status === 'expired') Object.assign(filter, { expiresAt: { $lt: now } });
  if (status === 'inactive') filter.isActive = false;

  const [rows, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(filter),
  ]);

  const data = rows.map((c) => ({
    ...couponDto(c),
    remainingUses: c.totalUsageLimit > 0 ? Math.max(c.totalUsageLimit - c.usedCount, 0) : null,
    expired: Boolean(c.expiresAt && c.expiresAt < now),
  }));

  return paginated(res, data, { page, limit, total });
});

// @desc    Create a coupon
// @route   POST /api/admin/coupons
// @access  Private/Admin
export const createCoupon = asyncHandler(async (req, res) => {
  const doc = parseCouponBody(req.body);
  validateCouponDoc(doc);

  if (await Coupon.exists({ code: doc.code })) {
    throw httpError(409, `Coupon code "${doc.code}" already exists`);
  }

  doc.createdBy = req.user._id;
  const coupon = await Coupon.create(doc);
  return created(res, couponDto(coupon), `Coupon "${coupon.code}" created`);
});

// @desc    Update a coupon
// @route   PUT /api/admin/coupons/:id
// @access  Private/Admin
export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw httpError(404, 'Coupon not found');

  const patch = parseCouponBody(req.body);
  if (patch.code && patch.code !== coupon.code) {
    if (await Coupon.exists({ code: patch.code })) {
      throw httpError(409, `Coupon code "${patch.code}" already exists`);
    }
  }

  Object.assign(coupon, patch);
  validateCouponDoc(coupon);
  await coupon.save();

  return ok(res, couponDto(coupon), 'Coupon updated');
});

// @desc    Activate / deactivate
// @route   PATCH /api/admin/coupons/:id/toggle
// @access  Private/Admin
export const toggleCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw httpError(404, 'Coupon not found');

  coupon.isActive = req.body.isActive !== undefined ? !!req.body.isActive : !coupon.isActive;
  await coupon.save();

  return ok(res, { _id: coupon._id, code: coupon.code, isActive: coupon.isActive },
    `Coupon ${coupon.isActive ? 'activated' : 'deactivated'}`);
});

// @desc    Delete a coupon (only if never used)
// @route   DELETE /api/admin/coupons/:id
// @access  Private/Admin
export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw httpError(404, 'Coupon not found');

  // A used coupon is part of order history — deactivate instead of erasing it.
  const uses = await CouponRedemption.countDocuments({ couponId: coupon._id });
  if (uses > 0) {
    coupon.isActive = false;
    await coupon.save();
    return ok(res, { _id: coupon._id, isActive: false },
      `"${coupon.code}" has been used ${uses} time(s), so it was deactivated instead of deleted`);
  }

  await coupon.deleteOne();
  return ok(res, { _id: req.params.id }, `Coupon "${coupon.code}" deleted`);
});

// @desc    Who used this coupon, and what it cost
// @route   GET /api/admin/coupons/:id/redemptions
// @access  Private/Admin
export const getCouponRedemptions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [rows, total, agg] = await Promise.all([
    CouponRedemption.find({ couponId: req.params.id })
      .populate('userId', 'phone name')
      .populate('orderId', 'orderNo status')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CouponRedemption.countDocuments({ couponId: req.params.id }),
    CouponRedemption.aggregate([
      { $match: { couponId: new mongoose.Types.ObjectId(String(req.params.id)) } },
      { $group: { _id: null, totalDiscount: { $sum: '$discountAmount' }, revenue: { $sum: '$orderTotal' } } },
    ]),
  ]);

  const totals = agg[0] || { totalDiscount: 0, revenue: 0 };
  return paginated(res, rows, { page, limit, total, ...totals });
});
