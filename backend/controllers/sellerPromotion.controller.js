import mongoose from 'mongoose';
import SellerPromotion from '../models/SellerPromotion.js';
import PromotionPackage from '../models/PromotionPackage.js';
import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import { retailVisibility } from '../utils/productChannels.js';
import Payment from '../models/Payment.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError, paginated, getPagination } from '../utils/response.js';
import { PAYMENT_STATUS } from '../constants/enums.js';
import {
  syncPromotionBanner, disablePromotionBanner, isPromotionEffectivelyActive,
  syncSearchBoost, unsetSearchBoost,
} from '../services/sellerPromotion.service.js';
import { SELLER_PROMOTION_MODULES } from '../models/SellerPromotion.js';

/** Admin/public advertisement management and historical payment settlement.
 * Seller authoring, uploads, package purchasing and billing initiation are retired.
 * Existing banner/search-boost lifecycle and payment records remain supported.
 */

const isEligibleProductDoc = (p) => !!p && !p.isDeleted;

const shapeProductRow = (p) => ({
  id: p._id,
  name: p.name,
  image: p.images?.[0] || '',
  price: p.price,
  isActive: p.isActive,
  status: p.status,
  available: isEligibleProductDoc(p) && p.isActive && p.status === 'approved',
});

// ============================================================
// PACKAGES — admin-managed price list (Section 12/13)
// ============================================================

/** @route GET /api/admin/promotion-packages?module=QUICK|ECOMMERCE (optional filter) */
export const listPromotionPackagesForAdmin = asyncHandler(async (req, res) => {
  const { module: moduleName } = req.query;
  const filter = moduleName && moduleName !== 'all' ? { module: moduleName } : {};
  const packages = await PromotionPackage.find(filter).sort({ module: 1, createdAt: -1 });
  return ok(res, packages, 'Promotion packages');
});

/** @route POST /api/admin/promotion-packages */
export const createPromotionPackage = asyncHandler(async (req, res) => {
  const { name, module: moduleName, durationDays, price, maxProducts, placement, isActive } = req.body;
  if (!name || !String(name).trim()) throw httpError(400, 'Package name is required');
  if (!SELLER_PROMOTION_MODULES.includes(moduleName)) throw httpError(400, `module must be one of ${SELLER_PROMOTION_MODULES.join(', ')}`);
  if (!Number.isFinite(Number(durationDays)) || Number(durationDays) < 1) throw httpError(400, 'Duration must be at least 1 day');
  if (!Number.isFinite(Number(price)) || Number(price) < 0) throw httpError(400, 'Price cannot be negative');
  if (!Number.isFinite(Number(maxProducts)) || Number(maxProducts) < 1) throw httpError(400, 'Max products must be at least 1');

  const pkg = await PromotionPackage.create({
    name,
    module: moduleName,
    durationDays: Number(durationDays),
    price: Number(price),
    maxProducts: Number(maxProducts),
    placement: placement || 'HOME_HERO',
    isActive: isActive === undefined ? true : Boolean(isActive),
  });

  return created(res, pkg, 'Promotion package created');
});

/**
 * @route PATCH /api/admin/promotion-packages/:id — future purchases only; see
 * SellerPromotion's snapshot fields. `module` is intentionally NOT editable
 * here — changing it after packages have been purchased under it would
 * corrupt the module split; disable the old package and create a new one
 * instead if a package needs to move modules.
 */
export const updatePromotionPackage = asyncHandler(async (req, res) => {
  const pkg = await PromotionPackage.findById(req.params.id);
  if (!pkg) throw httpError(404, 'Promotion package not found');

  const { name, durationDays, price, maxProducts, placement, isActive } = req.body;
  if (name !== undefined) pkg.name = name;
  if (durationDays !== undefined) {
    if (!Number.isFinite(Number(durationDays)) || Number(durationDays) < 1) throw httpError(400, 'Duration must be at least 1 day');
    pkg.durationDays = Number(durationDays);
  }
  if (price !== undefined) {
    if (!Number.isFinite(Number(price)) || Number(price) < 0) throw httpError(400, 'Price cannot be negative');
    pkg.price = Number(price);
  }
  if (maxProducts !== undefined) {
    if (!Number.isFinite(Number(maxProducts)) || Number(maxProducts) < 1) throw httpError(400, 'Max products must be at least 1');
    pkg.maxProducts = Number(maxProducts);
  }
  if (placement !== undefined) pkg.placement = placement;
  if (isActive !== undefined) pkg.isActive = Boolean(isActive);

  await pkg.save();
  return ok(res, pkg, 'Promotion package updated');
});

// ============================================================
// PAYMENT — historical settlement used by the shared payment webhook.
// ============================================================

/**
 * Move a SellerPromotion's payment to paid/failed exactly once. Exported so
 * payment.controller.js's shared webhook can branch into it, same as
 * the other shared-payment settlement handlers.
 */
export const settleSellerPromotionPayment = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  if (payment.status === PAYMENT_STATUS.PAID) return { changed: false, status: 'paid' };

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };

  try {
    await session.withTransaction(async () => {
      const freshPayment = await Payment.findById(payment._id).session(session);
      if (!freshPayment || freshPayment.status === PAYMENT_STATUS.PAID) return;

      const promotion = await SellerPromotion.findById(freshPayment.sellerPromotionId).session(session);
      if (!promotion) return;

      if (state === 'COMPLETED') {
        freshPayment.status = PAYMENT_STATUS.PAID;
        freshPayment.paidAt = new Date();
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await freshPayment.save({ session });

        /**
         * CRITICAL (Section 24-27 — the hard business rule): the package
         * clock started at admin APPROVAL, not now. `activatedAt`/
         * `expiresAt` were already fixed by approveSellerPromotion — this
         * settle function must never recompute or extend them, or a seller
         * who delays paying would get extra days for free.
         *
         * If the seller paid so late that the approval-based window has
         * already closed, activation is refused outright rather than
         * silently going live for zero remaining time or, worse, granting
         * a fresh window — the promotion is simply EXPIRED and the money
         * is still recorded as paid (a refund/support decision, out of
         * scope here).
         */
        const stillWithinWindow = promotion.expiresAt && new Date(promotion.expiresAt) > new Date();
        promotion.status = stillWithinWindow ? 'ACTIVE' : 'EXPIRED';
        await promotion.save({ session });

        result = { changed: true, status: 'paid' };
      } else if (state === 'FAILED') {
        freshPayment.status = PAYMENT_STATUS.FAILED;
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, errorCode };
        await freshPayment.save({ session });
        // promotion.status stays APPROVED (never PAYMENT_PENDING-forever) —
        // never activated by a failed payment, and the seller can retry.
        promotion.status = 'APPROVED';
        await promotion.save({ session });
        result = { changed: true, status: 'failed' };
      }
    });
  } finally {
    await session.endSession();
  }

  if (result.changed && result.status === 'failed') {
    // Defensive: a promotion should never have a live banner while
    // unpaid, but guard against it anyway (e.g. stray/manual data) rather
    // than trust that invariant blindly.
    const promotion = await SellerPromotion.findById(payment.sellerPromotionId);
    if (promotion) {
      await disablePromotionBanner(promotion);
      await unsetSearchBoost(promotion);
    }
  }

  if (result.changed && result.status === 'paid') {
    // Outside the transaction, same pattern settlePremiumPayment uses for
    // its own post-commit notification/side-effect work.
    const promotion = await SellerPromotion.findById(payment.sellerPromotionId);
    if (promotion.status === 'ACTIVE') {
      await syncPromotionBanner(promotion);
      await syncSearchBoost(promotion);
    }
  }

  return result;
};

// ============================================================
// ADMIN
// ============================================================

/** @route GET /api/admin/promotions */
export const listSellerPromotionsForAdmin = asyncHandler(async (req, res) => {
  const { status, search, module: moduleName } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (moduleName && moduleName !== 'all') filter.module = moduleName;

  let sellerIdFilter;
  if (search) {
    const rx = new RegExp(search, 'i');
    const sellers = await Seller.find({ $or: [{ businessName: rx }, { 'storeDetails.name': rx }] }).select('_id').lean();
    sellerIdFilter = sellers.map((s) => s._id);
    filter.$or = [{ title: rx }, ...(sellerIdFilter.length ? [{ sellerId: { $in: sellerIdFilter } }] : [])];
  }

  const [rows, total] = await Promise.all([
    SellerPromotion.find(filter)
      .populate('sellerId', 'businessName storeDetails.name')
      .sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    SellerPromotion.countDocuments(filter),
  ]);

  const shaped = rows.map((p) => ({
    _id: p._id,
    title: p.title,
    module: p.module,
    bannerImage: p.bannerImage,
    seller: {
      id: p.sellerId?._id,
      name: p.sellerId?.businessName || 'Seller',
      shopName: p.sellerId?.storeDetails?.name || '—',
    },
    productsCount: (p.selectedProducts || []).length,
    amount: p.amountSnapshot,
    status: p.status,
    submittedAt: p.submittedAt,
  }));

  return paginated(res, shaped, { page, limit, total });
});

/** @route GET /api/admin/promotions/:id — everything the admin needs to verify (Section 15). */
export const getSellerPromotionForAdmin = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id)
    .populate('sellerId')
    .populate('selectedProducts', 'name images price isActive status isDeleted')
    .populate('packageId')
    .lean();
  if (!promotion) throw httpError(404, 'Promotion not found');

  const seller = promotion.sellerId;
  return ok(res, {
    ...promotion,
    seller: seller ? {
      id: seller._id,
      name: seller.businessName,
      shopName: seller.storeDetails?.name,
      address: [seller.storeDetails?.address, seller.storeDetails?.city, seller.storeDetails?.state].filter(Boolean).join(', '),
      logo: seller.storeDetails?.logo,
      phone: seller.storeDetails?.phone,
    } : null,
    selectedProducts: (promotion.selectedProducts || []).map(shapeProductRow),
  }, 'Promotion detail');
});

/**
 * @route POST /api/admin/promotions/:id/approve — PENDING_REVIEW -> APPROVED
 *
 * CRITICAL (Section 24-27, the hard business rule): the package's
 * `durationDaysSnapshot` starts counting from THIS timestamp —
 * `approvedAt`/`activatedAt` are set here and never touched again. No time
 * is consumed between submission and approval; no extra time is granted if
 * payment happens later. See settleSellerPromotionPayment for the payment
 * side of this same rule.
 */
export const approveSellerPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'PENDING_REVIEW') throw httpError(400, `Only a promotion pending review can be approved (this is ${promotion.status})`);
  if (!promotion.durationDaysSnapshot) throw httpError(400, 'This promotion has no package selected — it should not have reached review');

  const approvedAt = new Date();
  promotion.status = 'APPROVED';
  promotion.approvedAt = approvedAt;
  promotion.activatedAt = approvedAt; // commercial package start (Section 25)
  const expiry = new Date(approvedAt);
  expiry.setDate(expiry.getDate() + promotion.durationDaysSnapshot);
  promotion.expiresAt = expiry;
  await promotion.save();

  // Do NOT sync/activate the banner here. Approval fixes the clock, but
  // customer visibility additionally requires verified payment (Section
  // 28) — the banner is only ever created/turned on inside
  // settleSellerPromotionPayment, once state === 'COMPLETED'.

  return ok(res, promotion, 'Promotion approved');
});

/** @route POST /api/admin/promotions/:id/request-changes  { feedback } */
export const requestPromotionChanges = asyncHandler(async (req, res) => {
  const { feedback } = req.body;
  if (!feedback || !String(feedback).trim()) throw httpError(400, 'Enter what needs to change');

  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'PENDING_REVIEW') throw httpError(400, `Only a promotion pending review can get a change request (this is ${promotion.status})`);

  promotion.status = 'CHANGES_REQUESTED';
  promotion.adminFeedback = feedback;
  promotion.changesRequestedAt = new Date();
  await promotion.save();

  return ok(res, promotion, 'Promotion feedback recorded');
});

/** @route POST /api/admin/promotions/:id/reject  { reason } */
export const rejectSellerPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'PENDING_REVIEW') throw httpError(400, `Only a promotion pending review can be rejected (this is ${promotion.status})`);

  promotion.status = 'REJECTED';
  promotion.adminFeedback = req.body.reason || promotion.adminFeedback;
  promotion.rejectedAt = new Date();
  await promotion.save();

  return ok(res, promotion, 'Promotion rejected');
});

/** @route POST /api/admin/promotions/:id/disable — ACTIVE -> DISABLED, banner off immediately. */
export const disableSellerPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'ACTIVE') throw httpError(400, `Only an active promotion can be disabled (this is ${promotion.status})`);

  promotion.status = 'DISABLED';
  await promotion.save();
  await disablePromotionBanner(promotion);
  await unsetSearchBoost(promotion);

  return ok(res, promotion, 'Promotion disabled');
});

// ============================================================
// CUSTOMER — public, read-only. Section 6/23's exclusion list enforced by
// isPromotionEffectivelyActive + isEligibleProductDoc filtering below.
// ============================================================

/** @route GET /api/promotions — active promotions (rarely used directly; discovery is via Banner). */
export const getActivePromotionsPublic = asyncHandler(async (req, res) => {
  const now = new Date();
  const filter = { status: 'ACTIVE', expiresAt: { $gt: now } };
  // Optional — the customer Search page asks for only the current
  // storefront's promotions ("one advertisement = one module" still
  // applies to discovery, not just the banner carousel).
  if (req.query.module && SELLER_PROMOTION_MODULES.includes(req.query.module)) {
    filter.module = req.query.module;
  }
  const promotions = await SellerPromotion.find(filter)
    .populate('sellerId', 'businessName storeDetails.name storeDetails.logo')
    .sort({ activatedAt: -1 }).lean();

  return ok(res, promotions.map((p) => ({
    id: p._id, title: p.title, module: p.module, bannerImage: p.bannerImage,
    shopName: p.sellerId?.storeDetails?.name, sellerName: p.sellerId?.businessName,
  })), 'Active promotions');
});

/** @route GET /api/promotions/:id — the Seller Promotion Landing Page's data source (Section 25). */
export const getPromotionPublic = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id).populate('sellerId').lean();
  if (!promotion || !isPromotionEffectivelyActive(promotion)) throw httpError(404, 'This promotion is not available');

  const seller = promotion.sellerId;
  // Deleted seller (Section 23's exclusion list) — the promotion simply has
  // nothing valid to show rather than crashing.
  if (!seller) throw httpError(404, 'This promotion is not available');

  // Product data is fetched live, never from a stored snapshot (Section 26)
  // — a deleted/deactivated product just drops off this list.
  const products = await Product.find({
    $and: [retailVisibility()],
    _id: { $in: promotion.selectedProducts || [] }, isDeleted: { $ne: true }, isActive: true, status: 'approved', fulfillmentType: { $ne: 'digital' },
  }).select('name images price mrp stock type').lean();

  return ok(res, {
    id: promotion._id,
    title: promotion.title,
    module: promotion.module,
    description: promotion.description,
    bannerImage: promotion.bannerImage,
    shop: {
      name: seller.storeDetails?.name,
      sellerName: seller.businessName,
      address: [seller.storeDetails?.address, seller.storeDetails?.city, seller.storeDetails?.state].filter(Boolean).join(', '),
      description: seller.storeDetails?.description,
      logo: seller.storeDetails?.logo,
    },
    products: products.map((p) => ({
      id: p._id, name: p.name, image: p.images?.[0] || '', price: p.price, mrp: p.mrp, stock: p.stock, type: p.type,
    })),
  }, 'Promotion');
});
