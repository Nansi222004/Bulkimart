import mongoose from 'mongoose';
import SellerPromotion from '../models/SellerPromotion.js';
import PromotionPackage from '../models/PromotionPackage.js';
import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import { notifySeller as notifySellerCentral, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError, paginated, getPagination } from '../utils/response.js';
import {
  createPayment, getOrderStatus, rupeesToPaise, isConfigured,
} from '../services/phonepe.service.js';
import { PAYMENT_STATUS } from '../constants/enums.js';
import {
  syncPromotionBanner, disablePromotionBanner, isPromotionEffectivelyActive, productMatchesModule,
  syncSearchBoost, unsetSearchBoost,
} from '../services/sellerPromotion.service.js';
import { SELLER_PROMOTION_MODULES } from '../models/SellerPromotion.js';

/**
 * Seller Promotion / Advertisement — a PAID VISIBILITY request, never a
 * discount. Product.price/mrp/discountPercent are never read or written
 * anywhere in this file. Kept entirely separate from Campaign/
 * CampaignParticipation (see campaign.controller.js's own file comment) —
 * the two can both eventually point at a Banner, but their business logic
 * never mixes.
 *
 * Reused, not rebuilt: the existing upload pipeline (uploadToCloudinary),
 * the existing PhonePe integration (services/phonepe.service.js, the same
 * one Premium Membership uses), the existing Notification model, and the
 * existing Banner engine via services/sellerPromotion.service.js.
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

/**
 * @route GET /api/sellers/promotions/packages?module=QUICK|ECOMMERCE
 * A seller only ever sees the packages for the module their advertisement
 * already committed to (Section 5/16) — required, not optional, so a
 * missing module never silently returns the whole cross-module list.
 */
export const listActivePromotionPackages = asyncHandler(async (req, res) => {
  const { module: moduleName } = req.query;
  if (!moduleName || !SELLER_PROMOTION_MODULES.includes(moduleName)) {
    throw httpError(400, `module must be one of ${SELLER_PROMOTION_MODULES.join(', ')}`);
  }
  const packages = await PromotionPackage.find({ isActive: true, module: moduleName }).sort({ price: 1 });
  return ok(res, packages, 'Promotion packages');
});

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
// SELLER
// ============================================================

/** @route GET /api/sellers/promotions */
export const listMyPromotions = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { sellerId: req.seller._id };
  if (status && status !== 'all') filter.status = status;

  const promotions = await SellerPromotion.find(filter).sort({ updatedAt: -1 }).lean();
  const rows = promotions.map((p) => ({
    _id: p._id,
    title: p.title,
    module: p.module,
    bannerImage: p.bannerImage,
    productsCount: (p.selectedProducts || []).length,
    status: p.status,
    activatedAt: p.activatedAt,
    expiresAt: p.expiresAt,
    amount: p.amountSnapshot,
  }));

  return ok(res, rows, 'Your promotions');
});

/** @route GET /api/sellers/promotions/:id — full detail, this seller's own only. */
export const getMyPromotionDetail = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id)
    .populate('selectedProducts', 'name images price isActive status isDeleted')
    .lean();
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) {
    throw httpError(404, 'Promotion not found');
  }

  return ok(res, {
    ...promotion,
    selectedProducts: (promotion.selectedProducts || []).map(shapeProductRow),
  }, 'Promotion detail');
});

/**
 * @route POST /api/sellers/promotions — creates a DRAFT the seller keeps
 * editing until submit. `module` is required and fixed for this
 * promotion's entire lifetime (Section 11: "Select Advertisement Module"
 * is the seller's first step) — everything selected afterwards (products,
 * package) must match it.
 */
export const createPromotion = asyncHandler(async (req, res) => {
  const { title, description, module: moduleName } = req.body;
  if (!SELLER_PROMOTION_MODULES.includes(moduleName)) {
    throw httpError(400, `module must be one of ${SELLER_PROMOTION_MODULES.join(', ')}`);
  }

  let bannerImage;
  if (req.file) bannerImage = await uploadToCloudinary(req.file.buffer, `seller-promotions/${req.seller._id}`);

  const promotion = await SellerPromotion.create({
    sellerId: req.seller._id,
    module: moduleName,
    title: title || 'Untitled promotion',
    description,
    bannerImage,
    status: 'DRAFT',
  });

  return created(res, promotion, 'Promotion draft created');
});

/** @route PUT /api/sellers/promotions/:id — editable only while DRAFT or CHANGES_REQUESTED. */
export const updatePromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) throw httpError(404, 'Promotion not found');
  if (!['DRAFT', 'CHANGES_REQUESTED'].includes(promotion.status)) {
    throw httpError(400, `A promotion cannot be edited while it is ${promotion.status}`);
  }

  const { title, description, packageId } = req.body;
  let { selectedProducts } = req.body;
  if (typeof selectedProducts === 'string') {
    try { selectedProducts = JSON.parse(selectedProducts); } catch { selectedProducts = [selectedProducts]; }
  }

  if (req.file) promotion.bannerImage = await uploadToCloudinary(req.file.buffer, `seller-promotions/${req.seller._id}`);
  if (title !== undefined) promotion.title = title;
  if (description !== undefined) promotion.description = description;

  if (selectedProducts !== undefined) {
    // Never trust product ids from the frontend — every id must resolve to
    // a product this seller actually owns AND that belongs to (or is
    // cross-listed into) this promotion's own module (Section 12: "Backend
    // must verify product belongs to selected module").
    const owned = await Product.find({
      _id: { $in: selectedProducts }, sellerId: req.seller._id,
    }).select('type channels isActive status').lean();
    if (owned.length !== new Set(selectedProducts.map(String)).size) {
      throw httpError(400, 'One or more selected products do not belong to your shop');
    }
    const wrongModule = owned.find((p) => !productMatchesModule(p, promotion.module));
    if (wrongModule) throw httpError(400, `One or more selected products are not listed under ${promotion.module}`);
    // Cap against whichever package is already attached (if any) — the
    // seller may set products before or after choosing a package, so this
    // is checked from both directions (see the packageId branch below too).
    const capNow = promotion.maxProductsSnapshot;
    if (capNow && selectedProducts.length > capNow) {
      throw httpError(400, `This package allows up to ${capNow} product(s) — you selected ${selectedProducts.length}`);
    }
    promotion.selectedProducts = selectedProducts;
  }

  if (packageId !== undefined) {
    const pkg = await PromotionPackage.findById(packageId);
    if (!pkg || !pkg.isActive) throw httpError(400, 'Selected package is not available');
    if (pkg.module !== promotion.module) throw httpError(400, `That package belongs to ${pkg.module}, not ${promotion.module}`);
    const productCount = (selectedProducts !== undefined ? selectedProducts : promotion.selectedProducts || []).length;
    if (productCount > pkg.maxProducts) {
      throw httpError(400, `"${pkg.name}" allows up to ${pkg.maxProducts} product(s) — you have ${productCount} selected`);
    }
    promotion.packageId = pkg._id;
    promotion.packageNameSnapshot = pkg.name;
    promotion.durationDaysSnapshot = pkg.durationDays;
    promotion.amountSnapshot = pkg.price;
    promotion.placementSnapshot = pkg.placement;
    promotion.maxProductsSnapshot = pkg.maxProducts;
  }

  await promotion.save();
  return ok(res, promotion, 'Promotion updated');
});

const validateForSubmission = (promotion) => {
  if (!promotion.title || !promotion.title.trim()) throw httpError(400, 'Give the promotion a title');
  if (!promotion.bannerImage) throw httpError(400, 'Upload a promotion banner before submitting');
  if (!promotion.selectedProducts || !promotion.selectedProducts.length) throw httpError(400, 'Select at least one product');
  if (!promotion.packageId) throw httpError(400, 'Choose a promotion package');
  // Final safety net — updatePromotion already enforces this from both
  // directions, but re-check here too rather than trust that invariant blindly.
  if (promotion.maxProductsSnapshot && promotion.selectedProducts.length > promotion.maxProductsSnapshot) {
    throw httpError(400, `Your package allows up to ${promotion.maxProductsSnapshot} product(s) — you have ${promotion.selectedProducts.length} selected`);
  }
};

/**
 * Seller notification — kept as the local call shape every site in this
 * file already uses (a seller doc + {title, message}), now delegating to
 * the central notification service instead of writing to Mongo directly —
 * that's what upgrades this from DB-only to DB + socket + FCM.
 */
const notifySeller = async (seller, { title, message }) => {
  if (!seller?._id) return;
  try {
    await notifySellerCentral(seller._id, {
      event: NOTIFICATION_EVENT.SELLER_PROMOTION_UPDATE,
      title,
      message,
      route: '/seller/promotions',
    });
  } catch (err) {
    console.error('[SELLER PROMOTION] notify failed:', err.message);
  }
};

/** Admin notification via the same durable channel — no separate admin-notification system invented. */
const notifyAdminsOfResubmission = async (promotion) => {
  try {
    const { default: Admin } = await import('../models/Admin.js');
    const admins = await Admin.find({}).select('_id').lean();
    await Notification.insertMany(admins.map((a) => ({
      userId: a._id,
      type: 'promotion',
      title: 'Seller promotion resubmitted',
      message: `A seller has resubmitted "${promotion.title}" for verification.`,
      metadata: { promotionId: promotion._id },
    })));
  } catch (err) {
    console.error('[SELLER PROMOTION] admin notify failed:', err.message);
  }
};

/** @route POST /api/sellers/promotions/:id/submit — DRAFT -> PENDING_REVIEW */
export const submitPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'DRAFT') throw httpError(400, `Only a draft can be submitted (this is ${promotion.status})`);

  validateForSubmission(promotion);
  promotion.status = 'PENDING_REVIEW';
  promotion.submittedAt = new Date();
  await promotion.save();

  return ok(res, promotion, 'Promotion submitted for admin verification');
});

/** @route POST /api/sellers/promotions/:id/resubmit — CHANGES_REQUESTED -> PENDING_REVIEW */
export const resubmitPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'CHANGES_REQUESTED') throw httpError(400, 'This promotion has no pending change request');

  validateForSubmission(promotion);
  promotion.status = 'PENDING_REVIEW';
  promotion.resubmittedAt = new Date();
  await promotion.save();
  await notifyAdminsOfResubmission(promotion);

  return ok(res, promotion, 'Promotion resubmitted for admin verification');
});

/** @route POST /api/sellers/promotions/:id/cancel — seller withdraws before payment. */
export const cancelPromotion = asyncHandler(async (req, res) => {
  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) throw httpError(404, 'Promotion not found');
  if (!['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(promotion.status)) {
    throw httpError(400, `A ${promotion.status} promotion cannot be cancelled`);
  }
  promotion.status = 'CANCELLED';
  await promotion.save();
  await disablePromotionBanner(promotion); // defensive — see expireDuePromotions' comment
  await unsetSearchBoost(promotion);
  return ok(res, promotion, 'Promotion cancelled');
});

// ============================================================
// PAYMENT — reuses the shared PhonePe integration exactly the way
// premium.controller.js's purchasePremium/settlePremiumPayment does.
// ============================================================

/**
 * Move a SellerPromotion's payment to paid/failed exactly once. Exported so
 * payment.controller.js's shared webhook can branch into it, same as
 * settlePremiumPayment/settleShgSubscriptionPayment.
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
    const seller = await Seller.findById(promotion.sellerId).select('userId').lean();
    if (promotion.status === 'ACTIVE') {
      await notifySeller(seller, {
        title: 'Your promotion is now live',
        message: `"${promotion.title}" is now live until ${promotion.expiresAt.toDateString()}.`,
      });
      await syncPromotionBanner(promotion);
      await syncSearchBoost(promotion);
    } else {
      // Paid too late — the approval-based window already closed.
      await notifySeller(seller, {
        title: 'Payment received, but the promotion window has closed',
        message: `"${promotion.title}" was approved for a window that ended on ${promotion.expiresAt?.toDateString?.() || 'the scheduled date'}. Contact support about this payment.`,
      });
    }
  }

  return result;
};

/** @route POST /api/sellers/promotions/:id/payment — only once APPROVED. */
export const initiatePromotionPayment = asyncHandler(async (req, res) => {
  if (!isConfigured()) throw httpError(503, 'Online payment is not available right now');

  const promotion = await SellerPromotion.findById(req.params.id);
  if (!promotion || String(promotion.sellerId) !== String(req.seller._id)) throw httpError(404, 'Promotion not found');
  if (promotion.status !== 'APPROVED') {
    throw httpError(400, `Payment can only be started for an approved promotion (this is ${promotion.status})`);
  }

  let payment = promotion.paymentId ? await Payment.findById(promotion.paymentId) : null;
  if (!payment || payment.status === PAYMENT_STATUS.PAID) {
    payment = await Payment.create({
      userId: req.user._id,
      sellerPromotionId: promotion._id,
      amount: promotion.amountSnapshot,
      method: 'online',
      status: PAYMENT_STATUS.PENDING,
    });
    promotion.paymentId = payment._id;
  }

  promotion.status = 'PAYMENT_PENDING';
  await promotion.save();

  const attempt = (payment.attempts || 0) + 1;
  const merchantOrderId = `PROMO-${promotion._id}-A${attempt}`;
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/promotions/payment/return/${merchantOrderId}`;

  const gw = await createPayment({
    merchantOrderId,
    amountPaise: rupeesToPaise(promotion.amountSnapshot),
    redirectUrl,
    message: `Bulkimart Seller Promotion — ${promotion.title}`,
  });

  payment.attempts = attempt;
  payment.gateway = { provider: 'phonepe', merchantOrderId, orderId: gw.orderId, initiatedAt: new Date() };
  await payment.save();

  return created(res, {
    redirectUrl: gw.redirectUrl,
    merchantOrderId,
    expireAt: gw.expireAt,
    amount: promotion.amountSnapshot,
  }, 'Redirecting to PhonePe');
});

/** @route GET /api/promotions/payment/return/:merchantOrderId — public, PhonePe browser return. */
export const promotionPaymentReturn = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': merchantOrderId });

  let status = 'unknown';
  if (payment) {
    try {
      const live = await getOrderStatus(merchantOrderId);
      const settled = await settleSellerPromotionPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  return res.redirect(`${app}/seller?promotionPayment=${encodeURIComponent(status)}`);
});

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

  const seller = await Seller.findById(promotion.sellerId).select('userId').lean();
  await notifySeller(seller, {
    title: 'Your promotion has been approved',
    message: `"${promotion.title}" is approved and runs until ${promotion.expiresAt.toDateString()}. Complete payment now to make it visible to customers.`,
  });

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

  const seller = await Seller.findById(promotion.sellerId).select('userId').lean();
  await notifySeller(seller, {
    title: 'Changes requested on your promotion',
    message: `Your promotion requires changes. Please review admin feedback: "${feedback}"`,
  });

  return ok(res, promotion, 'Change request sent to the seller');
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

  const seller = await Seller.findById(promotion.sellerId).select('userId').lean();
  await notifySeller(seller, {
    title: 'Your promotion was rejected',
    message: `"${promotion.title}" was rejected.${req.body.reason ? ` Reason: ${req.body.reason}` : ''}`,
  });

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
    _id: { $in: promotion.selectedProducts || [] }, isDeleted: { $ne: true }, isActive: true, status: 'approved',
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
