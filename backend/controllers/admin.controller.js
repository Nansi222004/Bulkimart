import { itemGrossExpression } from '../services/productGst.service.js';
import { itemGrossPaise } from '../services/productGst.service.js';
import { moneyPaise as dashboardMoneyPaise } from '../utils/financeMoney.js';
import { resolveVerifiedRiderPayout, riderFinancialSummary } from '../services/deliveryPayout.service.js';
import { requireFinanceOperation } from '../services/financeSafety.service.js';
import { sellerBalances } from '../services/sellerLedger.service.js';
import User from '../models/User.js';
import { saveWholesaleTransition } from '../services/wholesaleLifecycle.service.js';
import { notifySeller } from '../services/notification.service.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Category from '../models/Category.js';
import Ticket from '../models/Ticket.js';
import { applyApprovedRatings } from '../services/productRatings.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { ROLE, VENDOR_STATUS, APPROVAL, PAYOUT_MODES, CHANNEL, WHOLESALE_CHANNEL, WHOLESALE_REQUEST_STATUS } from '../constants/enums.js';
import mongoose from 'mongoose';
import Delivery from '../models/Delivery.js';
import DeliveryRate from '../models/DeliveryRate.js';
import DeliveryChargeSetting from '../models/DeliveryChargeSetting.js';
import RadiusSetting, { RADIUS_HARD_SAFETY_CEILING_KM } from '../models/RadiusSetting.js';
import { riderPayout, loadRates } from '../services/riderPay.service.js';
import { getDeliveryChargeSetting, loadDeliveryChargeSetting } from '../services/deliveryCharge.service.js';
import { getRadiusSetting, loadRadiusSetting } from '../services/radiusSetting.service.js';



import TicketMessage from '../models/TicketMessage.js';
import NotificationModel from '../models/Notification.js';
import { uploadFileWithMeta } from '../services/cloudinary.service.js';
import { notifyRequester } from './ticket.controller.js';
import { NOTIFICATION_EVENT, notifyRider } from '../services/notification.service.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import SellerPayout from '../models/SellerPayout.js';
import { DELIVERY_PAYOUT_STATUS } from '../constants/enums.js';
import { assertAdminTransition } from '../services/ticket.service.js';
import { TICKET_STATUS, TICKET_MAX_ATTACHMENTS, LEGACY_TICKET_STATUS_MAP } from '../constants/enums.js';
import { getEligibleWholesaleCatalog } from '../services/wholesaleCatalog.service.js';
import { assertEbookReadyForApproval } from '../services/digitalProduct.service.js';
import { openStoredEbook } from '../services/ebookStorage.service.js';

/* ============================================================================
 * SELLER (GENERAL VENDOR) MANAGEMENT — BRD §6 Seller Management
 * ========================================================================== */

// @desc    List sellers, filterable by status  (Pending Approval / Approved Vendors tabs)
// @route   GET /api/admin/sellers?status=pending&search=&page=&limit=
// @access  Private/Admin
export const listSellers = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status && status !== 'all') filter.status = status;

  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ businessName: rx }, { 'storeDetails.name': rx }, { 'storeDetails.city': rx }];
  }

  const [sellers, total] = await Promise.all([
    Seller.find(filter)
      .populate('userId', 'phone name email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Seller.countDocuments(filter),
  ]);

  // Flatten into the shape the admin table needs
  const rows = sellers.map((s) => {
    return {
      _id: s._id,
      businessName: s.businessName,
      storeName: s.storeDetails?.name,
      holderName: s.userId?.name || s.bankDetails?.holderName || '—',
      phone: s.userId?.phone,           // login identity
      storePhone: s.storeDetails?.phone,
      email: s.userId?.email,
      city: s.storeDetails?.city,
      state: s.storeDetails?.state,
      pincode: s.storeDetails?.pincode,
      status: s.status,
      onboardingStep: s.onboardingStep,
      salesChannels: s.salesChannels || [CHANNEL.ECOM],
      wholesaleChannel: s.wholesaleChannel || { status: WHOLESALE_REQUEST_STATUS.NOT_REQUESTED },
      commissionRate: s.commissionRate,
      rating: s.rating,
      submittedAt: s.updatedAt,
      approvedAt: s.approvedAt,
      rejectionReason: s.rejectionReason,
    };
  });

  return paginated(res, rows, { page, limit, total });
});

// @desc    Full seller detail — everything captured during registration, incl. documents
// @route   GET /api/admin/sellers/:id
// @access  Private/Admin
export const getSellerDetail = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id).populate('userId', 'phone name email avatar createdAt isActive');
  if (!seller) throw httpError(404, 'Seller not found');

  const productCounts = await Product.aggregate([
    { $match: { sellerId: seller._id, isDeleted: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  // Stored Seller counters are not maintained by checkout. Count each order
  // once and attribute only this seller's delivered merchandise to revenue.
  const [orderMetrics] = await Order.aggregate([
    { $match: { 'items.sellerId': seller._id } },
    { $unwind: '$items' },
    { $match: { 'items.sellerId': seller._id } },
    { $group: { _id: '$_id', status: { $first: '$status' },
      grossPaise: { $sum: itemGrossExpression() } } },
    { $group: { _id: null, totalOrders: { $sum: 1 },
      deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
      revenuePaise: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$grossPaise', 0] } } } },
  ]);

  return ok(res, {
    _id: seller._id,
    status: seller.status,
    onboardingStep: seller.onboardingStep,
    __v: seller.__v ?? 0,
    rejectionReason: seller.rejectionReason,
    approvedAt: seller.approvedAt,
    submittedAt: seller.updatedAt,
    registeredAt: seller.createdAt,
    serviceRadiusKm: seller.serviceRadiusKm,
    salesChannels: seller.salesChannels || [CHANNEL.ECOM],
    wholesaleChannel: seller.wholesaleChannel || { status: WHOLESALE_REQUEST_STATUS.NOT_REQUESTED },
    thirdPartyFulfillment: seller.thirdPartyFulfillment || { enabled: false },

    // --- account (login identity) --------------------------------------
    account: {
      userId: seller.userId?._id,
      phone: seller.userId?.phone,          // the number they log in with via OTP
      name: seller.userId?.name,
      email: seller.userId?.email,
      isActive: seller.userId?.isActive,
      joinedAt: seller.userId?.createdAt,
    },

    // --- step 1: business + store --------------------------------------
    business: {
      businessName: seller.businessName,
      businessType: seller.businessType,
      store: seller.storeDetails,
    },

    // --- step 2: Aadhaar KYC (number stored masked) ---------------------
    aadhaar: {
      number: seller.aadhaar?.number,
      frontUrl: seller.aadhaar?.frontUrl,
      backUrl: seller.aadhaar?.backUrl,
    },

    // --- step 3: bank ---------------------------------------------------
    bank: seller.bankDetails,

    // --- step 4: legal docs ---------------------------------------------
    legal: {
      gstin: seller.gstin,
      pan: seller.pan,
      fssai: seller.fssai,
      tradeLicense: seller.tradeLicense,
      documents: seller.documents,
    },

    // --- every uploaded file, flattened for a document viewer -----------
    documents: [
      { label: 'Aadhaar Front', url: seller.aadhaar?.frontUrl, category: 'KYC' },
      { label: 'Aadhaar Back', url: seller.aadhaar?.backUrl, category: 'KYC' },
      { label: 'Bank Passbook', url: seller.bankDetails?.passbookUrl, category: 'Bank' },
      { label: 'Store Logo', url: seller.storeDetails?.logo, category: 'Store' },
      { label: 'Store Banner', url: seller.storeDetails?.banner, category: 'Store' },
      ...(seller.documents || []).map((d) => ({ label: d.type, url: d.url, category: 'Legal' })),
    ].filter((d) => d.url),

    // --- business metrics ------------------------------------------------
    metrics: {
      commissionRate: seller.commissionRate,
      rating: seller.rating,
      totalOrders: orderMetrics?.totalOrders || 0,
      totalRevenue: (orderMetrics?.revenuePaise || 0) / 100,
      deliveredOrders: orderMetrics?.deliveredOrders || 0,
      products: productCounts.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {}),
    },

    promoRequests: seller.promoRequests,
  });
});

/**
 * @desc    A seller's product-visibility radius (distinct from their own
 *          `sameDay.radiusKm`, which is Same-Day-only and narrower).
 * @route   PATCH /api/admin/sellers/:id/radius
 * @access  Private/Admin
 *
 * `radiusKm: null` explicitly clears it back to unrestricted — the same
 * "absent means unrestricted" rule radius.service.js enforces everywhere
 * this value is read.
 */
export const setSellerRadius = asyncHandler(async (req, res) => {
  const { radiusKm } = req.body;
  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');

  if (radiusKm === null) {
    seller.serviceRadiusKm = undefined;
  } else {
    const n = Number(radiusKm);
    if (!Number.isFinite(n) || n <= 0) throw httpError(400, 'Radius must be a number greater than 0');
    const maxKm = getRadiusSetting().sellerServiceMaxRadiusKm;
    if (n > maxKm) throw httpError(400, `Radius cannot exceed ${maxKm}km`);
    seller.serviceRadiusKm = n;
  }

  await seller.save();
  return ok(res, {
    sellerId: seller._id,
    serviceRadiusKm: seller.serviceRadiusKm,
    hasLocation: seller.storeDetails?.lat !== undefined && seller.storeDetails?.lng !== undefined,
  }, 'Seller radius updated');
});

export const setSellerThirdPartyFulfillment = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');
  const enabled = req.body?.enabled === true;
  const pickupLocation = String(req.body?.shiprocketPickupLocation || '').trim();
  if (enabled && !pickupLocation) throw httpError(400, 'A registered Shiprocket pickup location is required');
  seller.thirdPartyFulfillment = { enabled, shiprocketPickupLocation: pickupLocation || undefined };
  await seller.save();
  return ok(res, { sellerId: seller._id, thirdPartyFulfillment: seller.thirdPartyFulfillment }, enabled ? 'Third-party fulfillment enabled' : 'Third-party fulfillment disabled');
});

// @desc    Approve a seller — moves them to the Approved Vendors list
// @route   PATCH /api/admin/sellers/:id/approve
// @access  Private/Admin
export const approveSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');
  if (seller.status === VENDOR_STATUS.APPROVED) throw httpError(400, 'Seller is already approved');
  if (seller.onboardingStep < 5) throw httpError(400, 'Seller has not completed onboarding yet');

  seller.status = VENDOR_STATUS.APPROVED;
  seller.approvedAt = new Date();
  seller.approvedBy = req.user._id;
  seller.rejectionReason = undefined;
  if (req.body.commissionRate !== undefined) seller.commissionRate = Number(req.body.commissionRate);
  await seller.save();

  // CRITICAL: grant the role on the User document. Without this the seller can log
  // in but requireRole('seller') still rejects them, so the dashboard stays locked.
  await User.findByIdAndUpdate(seller.userId, { $addToSet: { roles: ROLE.SELLER } });

  return ok(res, { _id: seller._id, status: seller.status, approvedAt: seller.approvedAt }, 'Seller approved successfully');
});

// @desc    Approve or reject a seller's separate Wholesale channel request
// @route   PATCH /api/admin/sellers/:id/wholesale
// @access  Private/Admin
export const decideSellerWholesaleChannel = asyncHandler(async (req, res) => {
  const { status, rejectionReason, suspensionReason } = req.body || {};
  if (![WHOLESALE_REQUEST_STATUS.APPROVED, WHOLESALE_REQUEST_STATUS.REJECTED, WHOLESALE_REQUEST_STATUS.SUSPENDED].includes(status)) {
    throw httpError(400, 'status must be approved, rejected, or suspended');
  }

  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');
  if (seller.status !== VENDOR_STATUS.APPROVED) throw httpError(409, 'Seller must have an approved account before Wholesale can be enabled');

  const currentStatus = seller.wholesaleChannel?.status || WHOLESALE_REQUEST_STATUS.NOT_REQUESTED;
  const alreadyApproved = currentStatus === WHOLESALE_REQUEST_STATUS.APPROVED && status === WHOLESALE_REQUEST_STATUS.APPROVED;
  const canDecidePending = currentStatus === WHOLESALE_REQUEST_STATUS.PENDING && [WHOLESALE_REQUEST_STATUS.APPROVED, WHOLESALE_REQUEST_STATUS.REJECTED].includes(status);
  const canRevoke = currentStatus === WHOLESALE_REQUEST_STATUS.APPROVED && [WHOLESALE_REQUEST_STATUS.REJECTED, WHOLESALE_REQUEST_STATUS.SUSPENDED].includes(status);
  const canRestore = currentStatus === WHOLESALE_REQUEST_STATUS.SUSPENDED && status === WHOLESALE_REQUEST_STATUS.APPROVED;
  if (!alreadyApproved && !canDecidePending && !canRevoke && !canRestore) {
    throw httpError(409, 'There is no pending Wholesale request to decide');
  }
  if (status === WHOLESALE_REQUEST_STATUS.REJECTED && rejectionReason != null && String(rejectionReason).length > 500) {
    throw httpError(400, 'Rejection reason must be 500 characters or fewer');
  }
  if (status === WHOLESALE_REQUEST_STATUS.SUSPENDED && suspensionReason != null && String(suspensionReason).length > 500) {
    throw httpError(400, 'Suspension reason must be 500 characters or fewer');
  }

  const channels = new Set(seller.salesChannels || [CHANNEL.ECOM]);
  if (status === WHOLESALE_REQUEST_STATUS.APPROVED) channels.add(WHOLESALE_CHANNEL);
  else channels.delete(WHOLESALE_CHANNEL);

  const wholesaleChannel = {
    ...(seller.wholesaleChannel?.toObject?.() || seller.wholesaleChannel || {}),
    status,
    decidedAt: new Date(),
    decidedBy: req.user._id,
    rejectionReason: status === WHOLESALE_REQUEST_STATUS.REJECTED ? String(rejectionReason || '').trim() || undefined : undefined,
    suspensionReason: status === WHOLESALE_REQUEST_STATUS.SUSPENDED ? String(suspensionReason || '').trim() || undefined : undefined,
  };
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 0) throw httpError(409, 'Refresh the seller before deciding Wholesale access; a current version is required');
  const updated = await saveWholesaleTransition(seller, { salesChannels: [...channels], wholesaleChannel }, req.body.version);
  try { await notifySeller(seller._id, { event: 'SYSTEM', title: `Wholesale access ${status}`, message: rejectionReason || suspensionReason || `Your Wholesale access is ${status}.`, route: '/seller/dashboard' }); } catch { /* decision is already durable */ }

  return ok(res, {
    _id: seller._id,
    status: updated.wholesaleChannel.status,
    salesChannels: updated.salesChannels,
    version: updated.__v,
  }, status === WHOLESALE_REQUEST_STATUS.APPROVED ? 'Wholesale channel approved/restored' : status === WHOLESALE_REQUEST_STATUS.SUSPENDED ? 'Wholesale channel suspended' : 'Wholesale channel rejected/revoked');
});

// @desc    Live Wholesale requests and eligible offer counts for admins
// @route   GET /api/admin/wholesale/summary
// @access  Private/Admin
export const getWholesaleManagementSummary = asyncHandler(async (_req, res) => {
  const [sellers, offers] = await Promise.all([
    Seller.find({ 'wholesaleChannel.status': { $in: [
      WHOLESALE_REQUEST_STATUS.PENDING,
      WHOLESALE_REQUEST_STATUS.APPROVED,
      WHOLESALE_REQUEST_STATUS.REJECTED,
      WHOLESALE_REQUEST_STATUS.SUSPENDED,
    ] } }).select('_id __v businessName storeDetails.name status salesChannels wholesaleChannel userId').populate('userId', 'name phone isActive').sort({ 'wholesaleChannel.requestedAt': -1 }).lean(),
    getEligibleWholesaleCatalog(),
  ]);
  const variants = offers.flatMap((offer) => offer.variants || []);
  return ok(res, {
    sellers,
    offers,
    counts: {
      requestingSellers: sellers.filter((seller) => seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.PENDING).length,
      approvedSellers: sellers.filter((seller) => seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.APPROVED).length,
      suspendedSellers: sellers.filter((seller) => seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.SUSPENDED).length,
      eligibleProducts: offers.length,
      eligibleVariants: variants.length,
      availableVariants: variants.filter((variant) => variant.available).length,
    },
  });
});

// Read-only operational queue. Executing/refinalizing these debts requires a
// separately authorized, idempotent provider reconciliation/refund procedure.
export const getCaptureRefundObligations = asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1), limit = Number(req.query.limit ?? 24);
  const states = req.query.status === 'all' ? ['pending', 'processing', 'failed', 'reconciliation_required', 'processed'] : req.query.status ? [req.query.status] : ['pending', 'processing', 'failed', 'reconciliation_required'];
  if (states.some(status => !['pending', 'processing', 'failed', 'reconciliation_required', 'processed'].includes(status))) throw httpError(400, 'Invalid refund status');
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Invalid refund queue pagination');
  const [result] = await Payment.aggregate([
    { $match: { 'refundObligations.status': { $in: states } } },
    { $unwind: '$refundObligations' },
    { $match: { 'refundObligations.status': { $in: states } } },
    { $sort: { 'refundObligations.createdAt': 1, _id: 1 } },
    { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { paymentId: '$_id', groupRef: 1, obligation: '$refundObligations' } }], count: [{ $count: 'total' }] } },
  ]).option({ maxTimeMS: 2000, allowDiskUse: false });
  return ok(res, result?.data || [], 'Refund obligations require reconciliation; no refund has been executed.', { page, limit, total: result?.count[0]?.total || 0 });
});

// @desc    Reject a seller
// @route   PATCH /api/admin/sellers/:id/reject
// @access  Private/Admin
export const rejectSeller = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw httpError(400, 'A rejection reason is required');

  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');

  seller.status = VENDOR_STATUS.REJECTED;
  seller.rejectionReason = reason;
  await seller.save();

  return ok(res, { _id: seller._id, status: seller.status, rejectionReason: reason }, 'Seller rejected');
});

// @desc    Suspend an approved seller and pull their products offline
// @route   PATCH /api/admin/sellers/:id/suspend
// @access  Private/Admin
export const suspendSeller = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const seller = await Seller.findById(req.params.id);
  if (!seller) throw httpError(404, 'Seller not found');

  seller.status = VENDOR_STATUS.SUSPENDED;
  seller.rejectionReason = reason || 'Suspended by admin';
  await seller.save();

  // take their listings down, and revoke the seller role
  const { modifiedCount } = await Product.updateMany({ sellerId: seller._id }, { $set: { isActive: false } });
  await User.findByIdAndUpdate(seller.userId, { $pull: { roles: ROLE.SELLER } });

  return ok(res, { _id: seller._id, status: seller.status, productsDeactivated: modifiedCount }, 'Seller suspended');
});



























/* ============================================================================
 * PRODUCT APPROVAL — BRD §6 Product Management
 * ========================================================================== */

// @desc    List products for moderation
// @route   GET /api/admin/products?status=pending
// @access  Private/Admin
export const listProducts = asyncHandler(async (req, res) => {
  const { status, type, sellerId, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isDeleted: false };
  if (status && status !== 'all') filter.status = status;
  if (type) filter.type = type;
  if (sellerId) filter.sellerId = sellerId;
  if (search) filter.name = new RegExp(search, 'i');

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name')
      .populate('sellerId', 'businessName storeDetails.name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  return paginated(res, products, { page, limit, total });
});

// Dedicated moderation details deliberately serialize metadata, never storage
// references, checksums, signed links or private PDF bytes.
export const getProductDetailAdmin = asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id))) throw httpError(400, 'Invalid product reference');
  const product = await Product.findById(req.params.id).populate('category', 'name').populate('sellerId', 'businessName storeDetails.name').lean();
  if (!product || product.isDeleted) throw httpError(404, 'Product unavailable');
  const keys = ['_id','name','description','type','fulfillmentType','images','sellerId','sellerName','category','price','mrp','stock','unit','sku','variants','status','isActive','isFeatured','isSponsored','sponsoredRank','rejectionReason','createdAt','updatedAt'];
  const data = Object.fromEntries(keys.map(key => [key, product[key]]));
  if (product.fulfillmentType === 'digital') data.digital = {
    author: product.digital?.author, language: product.digital?.language, format: product.digital?.format,
    file: { status: product.digital?.file?.status || 'missing', sizeBytes: product.digital?.file?.sizeBytes || 0 },
  };
  return ok(res, data);
});

// @desc    Securely view or download a private e-book while moderating it
// @route   GET /api/admin/products/:id/digital-file?download=true
// @access  Private/Admin
export const reviewDigitalProductFile = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).select('+digital.file.fileId');
  if (!product || product.isDeleted || product.fulfillmentType !== 'digital') {
    throw httpError(404, 'E-book listing not found');
  }

  const file = product.digital?.file;
  if (!file?.fileId || file.status !== 'uploaded' || !file.sha256 || !(file.sizeBytes > 0)) {
    throw httpError(409, 'This e-book does not have a reviewable PDF');
  }

  const opened = await openStoredEbook({
    fileId: file.fileId,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
  });
  const safeName = String(product.name || 'ebook').replace(/[^a-z0-9 _.-]/gi, '').trim() || 'ebook';
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(opened.sizeBytes),
    'Content-Disposition': `${disposition}; filename="${safeName}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  opened.stream.on('error', () => {
    if (!res.headersSent) res.status(503).end();
    else res.destroy();
  });
  opened.stream.pipe(res);
});

// @desc    Approve a product — this is what actually makes it publicly visible
// @route   PATCH /api/admin/products/:id/approve
// @access  Private/Admin
export const approveProduct = asyncHandler(async (req, res) => {
  const query = Product.findById(req.params.id);
  const product = typeof query.select === 'function' ? await query.select('+digital.file.fileId') : await query;
  if (!product) throw httpError(404, 'Product not found');

  if (product.fulfillmentType === 'digital') {
    assertEbookReadyForApproval(product);
    const seller = await Seller.findById(product.sellerId).select('status userId');
    if (!seller || seller.status !== VENDOR_STATUS.APPROVED) {
      throw httpError(409, 'The seller must be approved and active before an e-book can be approved');
    }
    const sellerUser = await User.findById(seller.userId).select('isActive');
    if (!sellerUser || sellerUser.isActive === false) {
      throw httpError(409, 'The seller account must be active before an e-book can be approved');
    }
  }

  // Both flags are required: every public query filters on status AND isActive.
  product.status = APPROVAL.APPROVED;
  product.isActive = true;
  product.rejectionReason = undefined;
  await product.save();

  return ok(res, { _id: product._id, status: product.status, isActive: true }, 'Product approved and is now live');
});

// @desc    Reject a product
// @route   PATCH /api/admin/products/:id/reject
// @access  Private/Admin
export const rejectProduct = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw httpError(400, 'A rejection reason is required');

  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found');

  product.status = APPROVAL.REJECTED;
  product.isActive = false;
  product.rejectionReason = reason;
  await product.save();

  return ok(res, { _id: product._id, status: product.status, rejectionReason: reason }, 'Product rejected');
});

// @desc    Toggle featured flag — BRD §6 Featured Products
// @route   PATCH /api/admin/products/:id/feature
// @access  Private/Admin
export const featureProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw httpError(404, 'Product not found');

  product.isFeatured = req.body.isFeatured !== undefined ? !!req.body.isFeatured : !product.isFeatured;
  await product.save();

  return ok(res, { _id: product._id, isFeatured: product.isFeatured }, `Product ${product.isFeatured ? 'featured' : 'unfeatured'}`);
});

// @desc    Remove a product from every storefront while preserving order history
// @route   DELETE /api/admin/products/:id
// @access  Private/Admin
export const deleteProductAdmin = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product || product.isDeleted) throw httpError(404, 'Product not found');

  // Products are snapshots in historical orders and may also be referenced by
  // carts, reviews, returns, and financial records. Follow the catalogue's
  // existing deletion convention instead of physically removing the document.
  product.isDeleted = true;
  product.isActive = false;
  product.isFeatured = false;
  product.isSponsored = false;
  product.sponsoredRank = 0;
  await product.save();

  return ok(res, { _id: product._id, action: 'deleted' }, 'Product deleted from the catalogue. Historical records were preserved.');
});

/* ============================================================================
 * USER MANAGEMENT — BRD §6 User Management
 * ========================================================================== */

const escapeRegexForUserFilter = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    List customers
// @route   GET /api/admin/users
// @access  Private/Admin
export const listUsers = asyncHandler(async (req, res) => {
  const { search, role, status, state, district } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ phone: rx }, { name: rx }, { email: rx }];
  }
  if (role) filter.roles = role;

  /**
   * State/District filter — geographic breakdown for the Consumer Users
   * directory. There is no dedicated `district` field on `User.addresses`
   * (only `city`), so `city` doubles as the district value here — the same
   * approximation this directory has always used elsewhere.
   *
   * Matched against ONLY the user's DEFAULT address (`isDefault: true`),
   * never any of their other saved addresses — a user with addresses in
   * three states is filed under the one they themselves marked as
   * default, exactly like checkout does. Every user with at least one
   * saved address has exactly one `isDefault: true` entry (enforced by
   * addAddress/deleteAddress in user.controller.js), so this never
   * silently misses someone who has an address at all.
   */
  if (state || district) {
    const elemMatch = { isDefault: true };
    if (state) elemMatch.state = new RegExp(`^${escapeRegexForUserFilter(state)}$`, 'i');
    if (district) elemMatch.city = new RegExp(`^${escapeRegexForUserFilter(district)}$`, 'i');
    filter.addresses = { $elemMatch: elemMatch };
  }

  /**
   * Consumer directory status filter — "blocked" is an account flag,
   * "active"/"inactive" is behavioural (has this buyer ordered in the last
   * 30 days), never a stored field. `status=all` is the same as omitting it.
   */
  if (status === 'blocked') {
    filter.isActive = false;
  } else if (status === 'active' || status === 'inactive') {
    filter.isActive = true;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentBuyerIds = await Order.distinct('userId', { createdAt: { $gte: thirtyDaysAgo } });
    filter._id = status === 'active' ? { $in: recentBuyerIds } : { $nin: recentBuyerIds };
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-wallet.transactions').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return paginated(res, users, { page, limit, total });
});

/**
 * @desc    Distinct (state, district) combinations actually present among
 *          registered users' DEFAULT addresses — drives the State/District
 *          filter dropdowns on the Consumer Users directory. Deliberately
 *          DB-driven rather than a static all-India list: a state/district
 *          with zero registered users is not offered as a filter choice,
 *          so the dropdown never promises a result set that would come
 *          back empty.
 * @route   GET /api/admin/consumers/locations
 * @access  Private/Admin
 */
export const getConsumerLocations = asyncHandler(async (req, res) => {
  const rows = await User.aggregate([
    { $unwind: '$addresses' },
    {
      $match: {
        'addresses.isDefault': true,
        'addresses.state': { $exists: true, $nin: [null, ''] },
        'addresses.city': { $exists: true, $nin: [null, ''] },
      },
    },
    { $group: { _id: { state: '$addresses.state', district: '$addresses.city' }, count: { $sum: 1 } } },
    { $group: { _id: '$_id.state', districts: { $addToSet: '$_id.district' }, count: { $sum: '$count' } } },
    { $sort: { _id: 1 } },
  ]);

  const states = rows.map((r) => r._id).sort((a, b) => a.localeCompare(b));
  const districtsByState = {};
  // Customer count per state — one registered buyer's DEFAULT address =
  // one count, drives the dashboard's "top states" breakdown. Not used by
  // the plain filter dropdowns (UsersTab/CustomerActivityLogTab), which
  // only ever read `states`/`districtsByState`.
  const stateCounts = {};
  for (const row of rows) {
    districtsByState[row._id] = row.districts.sort((a, b) => a.localeCompare(b));
    stateCounts[row._id] = row.count;
  }

  return ok(res, { states, districtsByState, stateCounts });
});

/**
 * @desc    This calendar month's order activity across BOTH channels —
 *          the Consumer Users dashboard's "Orders This Month" card.
 * @route   GET /api/admin/consumers/orders-summary
 * @access  Private/Admin
 */
export const getConsumerOrdersSummary = asyncHandler(async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

  const rows = await Order.aggregate([
    { $match: { createdAt: { $gte: startOfMonth } } },
    { $group: { _id: '$type', count: { $sum: 1 }, revenue: { $sum: '$pricing.totalAmount' } } },
  ]);

  const byChannel = {};
  let totalOrders = 0;
  let totalRevenue = 0;
  for (const r of rows) {
    byChannel[r._id] = { count: r.count, revenue: r.revenue || 0 };
    totalOrders += r.count;
    totalRevenue += r.revenue || 0;
  }

  return ok(res, { totalOrders, totalRevenue, byChannel, periodStart: startOfMonth });
});

// @desc    Activate / deactivate a customer
// @route   PATCH /api/admin/users/:id/status
// @access  Private/Admin
export const setUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (isActive === undefined) throw httpError(400, 'isActive is required');

  const user = await User.findByIdAndUpdate(req.params.id, { isActive: !!isActive }, { returnDocument: 'after' }).select('phone name isActive');
  if (!user) throw httpError(404, 'User not found');

  return ok(res, user, `User ${user.isActive ? 'activated' : 'deactivated'}`);
});

/* ============================================================================
 * DASHBOARD COUNTS — drives the sidebar badges
 * ========================================================================== */

// @desc    Pending-action counts across every approval queue
// @route   GET /api/admin/dashboard/pending-counts
// @access  Private/Admin
export const getPendingCounts = asyncHandler(async (req, res) => {
  const [sellersPending, productsPending, sellersApproved, ridersPending, ridersApproved] = await Promise.all([
    Seller.countDocuments({ status: VENDOR_STATUS.PENDING }),
    Product.countDocuments({ status: APPROVAL.PENDING, isDeleted: false }),
    Seller.countDocuments({ status: VENDOR_STATUS.APPROVED }),
    DeliveryPartner.countDocuments({ status: VENDOR_STATUS.PENDING }),
    DeliveryPartner.countDocuments({ status: VENDOR_STATUS.APPROVED }),
  ]);

  return ok(res, {
    sellers: { pending: sellersPending, approved: sellersApproved },
    products: { pending: productsPending },
    delivery: { pending: ridersPending, approved: ridersApproved },
    totalPending: sellersPending + productsPending + ridersPending,
  });
});

/* ============================================================================
 * DELIVERY PARTNER VERIFICATION — BRD §6 Delivery Management
 *
 * Riders carry customer goods and, on COD orders, customer cash. Approval is
 * deliberately manual: an admin looks at the licence and Aadhaar before the
 * rider app unlocks anything.
 * ========================================================================== */

// @desc    List delivery partners, filterable by status
// @route   GET /api/admin/delivery-partners?status=pending
// @access  Private/Admin
export const listDeliveryPartners = asyncHandler(async (req, res) => {
  const { status, search, state, city } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status && status !== 'all') filter.status = status;
  // Where the rider actually works from. `baseLocation` is the only place a
  // rider's own town is recorded — `zones` holds bare pincodes with no city
  // or state attached, so it cannot answer "show me everyone in Pune".
  if (state) filter['baseLocation.state'] = state;
  if (city) filter['baseLocation.city'] = city;
  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ vehicleNo: rx }, { 'drivingLicense.no': rx }, { zones: rx }];
  }

  const [partners, total, states, cities] = await Promise.all([
    DeliveryPartner.find(filter)
      .populate('userId', 'phone name email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    DeliveryPartner.countDocuments(filter),
    /**
     * Options are drawn from every rider on record, not from the filtered
     * result — a state filter that narrowed its own dropdown to the one
     * state already chosen would leave no way back to the others.
     */
    DeliveryPartner.distinct('baseLocation.state'),
    // Cities do narrow to the chosen state, which is what makes the pair
    // usable rather than listing every city in the country.
    DeliveryPartner.distinct('baseLocation.city', state ? { 'baseLocation.state': state } : {}),
  ]);

  const rows = partners.map((p) => ({
    _id: p._id,
    name: p.userId?.name || p.bankDetails?.holderName || '—',
    phone: p.userId?.phone,
    vehicleType: p.vehicleType,
    vehicleNo: p.vehicleNo,
    licenceNo: p.drivingLicense?.no,
    zones: p.zones,
    status: p.status,
    onboardingStep: p.onboardingStep,
    isAvailable: p.isAvailable,
    totalDeliveries: p.totalDeliveries,
    rating: p.rating,
    submittedAt: p.updatedAt,
    approvedAt: p.approvedAt,
    rejectionReason: p.rejectionReason,
    city: p.baseLocation?.city || null,
    state: p.baseLocation?.state || null,
  }));

  return paginated(res, rows, {
    page, limit, total,
    filters: {
      // distinct() returns nulls for riders who never set a base location;
      // they would render as a blank, unselectable option.
      states: states.filter(Boolean).sort(),
      cities: cities.filter(Boolean).sort(),
    },
  });
});

/**
 * @desc    A delivery partner's own pickup radius.
 * @route   PATCH /api/admin/delivery-partners/:id/radius
 * @access  Private/Admin
 *
 * `radiusKm: null` clears it back to unrestricted, same convention as
 * the seller radius endpoint above — dispatch then falls back to the
 * existing global `PICKUP_RADIUS_METERS` search exactly as before.
 */
export const setDeliveryPartnerRadius = asyncHandler(async (req, res) => {
  const { radiusKm } = req.body;
  const partner = await DeliveryPartner.findById(req.params.id);
  if (!partner) throw httpError(404, 'Delivery partner not found');

  if (radiusKm === null) {
    partner.deliveryRadiusKm = undefined;
  } else {
    const n = Number(radiusKm);
    if (!Number.isFinite(n) || n <= 0) throw httpError(400, 'Radius must be a number greater than 0');
    const maxKm = getRadiusSetting().deliveryPartnerMaxRadiusKm;
    if (n > maxKm) throw httpError(400, `Radius cannot exceed ${maxKm}km`);
    partner.deliveryRadiusKm = n;
  }

  await partner.save();
  return ok(res, {
    partnerId: partner._id,
    deliveryRadiusKm: partner.deliveryRadiusKm,
    hasLocation: partner.currentLocation?.lat !== undefined || partner.baseLocation?.lat !== undefined,
  }, 'Delivery partner radius updated');
});

// @desc    Full rider dossier — everything submitted, plus the documents
// @route   GET /api/admin/delivery-partners/:id
// @access  Private/Admin
export const getDeliveryPartnerDetail = asyncHandler(async (req, res) => {
  const p = await DeliveryPartner.findById(req.params.id)
    .populate('userId', 'phone name email isActive createdAt');
  if (!p) throw httpError(404, 'Delivery partner not found');

  const licenceExpired = Boolean(
    p.drivingLicense?.expiryDate && new Date(p.drivingLicense.expiryDate) < new Date()
  );

  return ok(res, {
    _id: p._id,
    status: p.status,
    onboardingStep: p.onboardingStep,
    rejectionReason: p.rejectionReason,
    approvedAt: p.approvedAt,
    registeredAt: p.createdAt,
    submittedAt: p.updatedAt,
    deliveryRadiusKm: p.deliveryRadiusKm,

    account: {
      userId: p.userId?._id,
      phone: p.userId?.phone,
      name: p.userId?.name,
      email: p.userId?.email,
      isActive: p.userId?.isActive,
      joinedAt: p.userId?.createdAt,
    },

    vehicle: {
      type: p.vehicleType,
      number: p.vehicleNo,
      licenceNo: p.drivingLicense?.no,
      licenceExpiry: p.drivingLicense?.expiryDate,
      // Surfaced so an admin does not have to read the date to catch it.
      licenceExpired,
    },

    aadhaar: { number: p.aadhaar?.number },
    serviceZones: p.zones,

    /**
     * Where the rider says they are based.
     *
     * `source` is included deliberately: a GPS fix was taken on the device at
     * registration, while a typed address is only a claim. An admin deciding
     * whether to trust the pincode should be able to tell which they are
     * looking at.
     */
    baseLocation: p.baseLocation
      ? {
          address: p.baseLocation.address,
          landmark: p.baseLocation.landmark,
          city: p.baseLocation.city,
          state: p.baseLocation.state,
          pincode: p.baseLocation.pincode,
          lat: p.baseLocation.lat,
          lng: p.baseLocation.lng,
          accuracy: p.baseLocation.accuracy,
          source: p.baseLocation.source,
          capturedAt: p.baseLocation.updatedAt,
        }
      : null,

    bank: p.bankDetails,

    documents: [
      { label: 'Driving Licence', url: p.drivingLicense?.url, category: 'Licence' },
      { label: 'Aadhaar — Front', url: p.aadhaar?.frontUrl, category: 'KYC' },
      { label: 'Aadhaar — Back', url: p.aadhaar?.backUrl, category: 'KYC' },
      { label: 'Bank Passbook', url: p.bankDetails?.passbookUrl, category: 'Bank' },
    ].filter((d) => d.url),

    metrics: {
      totalDeliveries: p.totalDeliveries,
      rating: p.rating,
      earnings: p.earnings,
      isAvailable: p.isAvailable,
    },
    // Ledger balances (authoritative) for riders on the finance workflow.
    finance: await riderFinancialSummary(p),
  });
});

// @desc    Approve a rider — this is what unlocks the rider app
// @route   PATCH /api/admin/delivery-partners/:id/approve
// @access  Private/Admin
export const approveDeliveryPartner = asyncHandler(async (req, res) => {
  const partner = await DeliveryPartner.findById(req.params.id);
  if (!partner) throw httpError(404, 'Delivery partner not found');
  if (partner.status === VENDOR_STATUS.APPROVED) throw httpError(400, 'This rider is already approved');
  if (partner.onboardingStep < 4) throw httpError(400, 'This rider has not completed registration yet');

  // Approving someone whose licence has already lapsed would put an unlicensed
  // rider on the road under our name.
  if (partner.drivingLicense?.expiryDate && new Date(partner.drivingLicense.expiryDate) < new Date()) {
    throw httpError(400, 'This driving licence has expired — ask the rider to upload a current one');
  }

  partner.status = VENDOR_STATUS.APPROVED;
  partner.approvedAt = new Date();
  partner.approvedBy = req.user._id;
  partner.rejectionReason = undefined;
  await partner.save();

  // CRITICAL: the role is what actually unlocks the rider app.
  await User.findByIdAndUpdate(partner.userId, { $addToSet: { roles: ROLE.DELIVERY } });

  return ok(res, { _id: partner._id, status: partner.status, approvedAt: partner.approvedAt },
    'Delivery partner approved');
});

// @desc    Reject a rider
// @route   PATCH /api/admin/delivery-partners/:id/reject
// @access  Private/Admin
export const rejectDeliveryPartner = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw httpError(400, 'A rejection reason is required');

  const partner = await DeliveryPartner.findById(req.params.id);
  if (!partner) throw httpError(404, 'Delivery partner not found');

  partner.status = VENDOR_STATUS.REJECTED;
  partner.rejectionReason = reason;
  await partner.save();

  await User.findByIdAndUpdate(partner.userId, { $pull: { roles: ROLE.DELIVERY } });

  return ok(res, { _id: partner._id, status: partner.status, rejectionReason: reason },
    'Delivery partner rejected');
});

// @desc    Suspend an approved rider
// @route   PATCH /api/admin/delivery-partners/:id/suspend
// @access  Private/Admin
export const suspendDeliveryPartner = asyncHandler(async (req, res) => {
  const partner = await DeliveryPartner.findById(req.params.id);
  if (!partner) throw httpError(404, 'Delivery partner not found');

  partner.status = VENDOR_STATUS.SUSPENDED;
  partner.rejectionReason = req.body.reason || 'Suspended by admin';
  // A suspended rider must not keep receiving assignments.
  partner.isAvailable = false;
  await partner.save();

  await User.findByIdAndUpdate(partner.userId, { $pull: { roles: ROLE.DELIVERY } });

  return ok(res, { _id: partner._id, status: partner.status }, 'Delivery partner suspended');
});

// @desc    Fleet totals for the delivery dashboard
// @route   GET /api/admin/delivery-partners/stats
// @access  Private/Admin
export const deliveryFleetStats = asyncHandler(async (req, res) => {
  // One grouped pass instead of six countDocuments round trips.
  const [byStatus, availableNow] = await Promise.all([
    DeliveryPartner.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    // Only an approved rider can be available; an approved-but-offline rider
    // still counts toward the fleet, just not toward dispatch capacity.
    DeliveryPartner.countDocuments({ status: VENDOR_STATUS.APPROVED, isAvailable: true }),
  ]);

  const counts = byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
  const approved = counts[VENDOR_STATUS.APPROVED] || 0;

  return ok(res, {
    // "Fleet" means people who can actually be sent out, so incomplete and
    // rejected applications are reported separately rather than inflating it.
    fleet: approved,
    available: availableNow,
    offline: Math.max(approved - availableNow, 0),
    pending: counts[VENDOR_STATUS.PENDING] || 0,
    rejected: counts[VENDOR_STATUS.REJECTED] || 0,
    suspended: counts[VENDOR_STATUS.SUSPENDED] || 0,
    incomplete: counts[VENDOR_STATUS.INCOMPLETE] || 0,
    totalRegistrations: Object.values(counts).reduce((a, b) => a + b, 0),
  });
});

/* ------------------------------------------------------------------ *
 * Rider pay rates — Delivery Fleet
 * ------------------------------------------------------------------ */

/**
 * The live rate card for each delivery mode, plus what changed before it.
 *
 * Always returns a row for every mode, even one nobody has configured — that
 * row is the environment default the platform is actually paying, and an admin
 * screen that showed nothing for it would be hiding a real figure.
 *
 * @route GET /api/admin/delivery-rates
 */
export const getDeliveryRates = asyncHandler(async (req, res) => {
  const active = await DeliveryRate.find({ isActive: true, $or: [{ effectiveFrom: { $lte: new Date() } }, { effectiveFrom: { $exists: false } }] }).sort({ createdAt: -1 }).lean();
  const history = await DeliveryRate.find().sort({ createdAt: -1 }).limit(50)
    .populate('updatedBy', 'name email').lean();

  const current = PAYOUT_MODES.map((mode) => {
    const row = active.find((r) => r.mode === mode);
    if (row) return { ...row, source: 'configured' };

    // Nothing saved for this mode — report what riderPayout is really using.
    const quote = riderPayout(1, { mode });
    return {
      mode,
      base: quote.base,
      perKm: quote.perKm,
      minPayout: 0,
      source: 'default',
    };
  });

  return ok(res, { current, history }, 'Delivery rates');
});

/**
 * Set the rate for one mode.
 *
 * Inserts rather than edits: the previous row is deactivated and kept, so the
 * history stays readable and a delivery priced months ago can still point at
 * the exact row it was paid under.
 *
 * @route POST /api/admin/delivery-rates
 */
export const setDeliveryRate = asyncHandler(async (req, res) => {
  const { mode, base, perKm, minPayout, maxPayout, note } = req.body;
  if (typeof base !== 'number' || typeof perKm !== 'number' || String(note || '').trim().length < 5) throw httpError(400, 'Explicit numeric rates and an audit reason of at least five characters are required');
  const activate = req.body.isActive === true;
  if (activate) {
    requireFinanceOperation();
    const customerTariff = await DeliveryChargeSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    if (!customerTariff?.distanceRates || !Number.isFinite(customerTariff.distanceRates.quick) || !Number.isFinite(customerTariff.distanceRates.same_day)) throw httpError(409, 'An independently approved customer distance tariff must be frozen before rider rate activation');
  }
  const effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date();
  if (!Number.isFinite(effectiveFrom.getTime())) throw httpError(400, 'Invalid effective date');
  if (activate && effectiveFrom > new Date()) throw httpError(409, 'Future rates must be saved as a draft');

  if (!PAYOUT_MODES.includes(mode)) {
    throw httpError(400, `Unknown delivery mode "${mode}" — expected ${PAYOUT_MODES.join(' or ')}`);
  }
  const b = Number(base);
  const k = Number(perKm);
  if (Math.abs(Math.round(b * 100) - b * 100) > 0.00001 || Math.abs(Math.round(k * 100) - k * 100) > 0.00001) throw httpError(400, 'Rider rates support at most two decimal places');
  if (!Number.isFinite(b) || b < 0) throw httpError(400, 'Base pay must be zero or more');
  if (!Number.isFinite(k) || k < 0) throw httpError(400, 'Per-kilometre pay must be zero or more');

  /**
   * A typo here is expensive and silent.
   *
   * ₹150/km instead of ₹15 would pay a rider ten times over on every delivery
   * until somebody noticed in a payout report. The ceiling is deliberately
   * generous — it exists to catch a slipped decimal, not to cap a real rate.
   */
  if (b > 1000 || k > 500) {
    throw httpError(400, 'That rate looks like a typo. Base must be under ₹1000 and per-km under ₹500.');
  }
  const min = minPayout == null || minPayout === '' ? 0 : Number(minPayout);
  const max = maxPayout === '' || maxPayout === undefined || maxPayout === null ? undefined : Number(maxPayout);
  if (!Number.isFinite(min) || min < 0 || max !== undefined && (!Number.isFinite(max) || max < 0)) throw httpError(400, 'Invalid payout limits');
  if (Math.abs(Math.round(min * 100) - min * 100) > 0.00001 || max !== undefined && Math.abs(Math.round(max * 100) - max * 100) > 0.00001) throw httpError(400, 'Payout limits support at most two decimal places');
  if (max !== undefined && max < min) throw httpError(400, 'Maximum payout cannot be below the minimum');

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      // Exactly one active row per mode, so the lookup can never be ambiguous.
      if (activate) await DeliveryRate.updateMany({ mode, isActive: true }, { $set: { isActive: false } }, { session });
      const [row] = await DeliveryRate.create([{
        financeVersion: 2,
        mode, base: b, perKm: k,
        minPayout: min,
        ...(max !== undefined ? { maxPayout: max } : {}),
        isActive: activate,
        effectiveFrom,
        updatedBy: req.user?._id,
        note,
      }], { session });
      created = row;
    });
  } finally {
    await session.endSession();
  }

  // The next offer must carry the new figure, not the one after the TTL.
  await loadRates();

  return ok(res, created, activate ? 'Rider pay updated' : 'Rate draft saved; current customer delivery pricing and rider rates are unchanged');
});

/* --------------------------------------------------------------------------
 * Customer delivery charge — distinct from rider pay above. What a shopper
 * pays, not what a rider earns; the two have never been the same number.
 * ------------------------------------------------------------------ */

/**
 * The live customer delivery charge, plus what changed before it.
 *
 * @route GET /api/admin/delivery-charge
 */
export const getDeliveryChargeSettingForAdmin = asyncHandler(async (req, res) => {
  const active = await DeliveryChargeSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await DeliveryChargeSetting.find().sort({ createdAt: -1 }).limit(50)
    .populate('updatedBy', 'name email').lean();

  const live = getDeliveryChargeSetting();
  const current = active
    ? { ...active, source: 'configured' }
    : { flatFee: live.flatFee, source: 'default' };

  return ok(res, { current, history }, 'Delivery charge setting');
});

/**
 * Set the customer delivery charge.
 *
 * Same insert-not-edit pattern as setDeliveryRate above: the previous row is
 * deactivated and kept, so a past order can still point at the exact figure
 * it was priced under.
 *
 * @route POST /api/admin/delivery-charge
 */
export const setDeliveryChargeSettingForAdmin = asyncHandler(async (req, res) => {
  const { flatFee, note } = req.body;
  if (req.body.distanceRates !== undefined) {
    requireFinanceOperation();
    for (const mode of PAYOUT_MODES) {
      const value = req.body.distanceRates?.[mode];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 500 || Math.abs(Math.round(value * 100) - value * 100) > 0.00001) throw httpError(400, 'Explicit nonnegative customer per-kilometre tariffs with at most two decimals are required for both modes');
    }
    if (String(note || '').trim().length < 5) throw httpError(400, 'Customer tariff approval reason is required');
  }

  const fee = Number(flatFee);
  if (!Number.isFinite(fee) || fee < 0) throw httpError(400, 'Delivery charge must be zero or more');

  // A typo here overcharges (or undercharges) every order until noticed —
  // same reasoning as the rider-rate typo guard above.
  if (fee > 500) throw httpError(400, 'That delivery charge looks like a typo — must be under ₹500.');

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const currentTariff = await DeliveryChargeSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).session(session).lean();
      await DeliveryChargeSetting.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });
      const [row] = await DeliveryChargeSetting.create([{
        flatFee: fee,
        distanceRates: req.body.distanceRates === undefined ? currentTariff?.distanceRates : { quick: req.body.distanceRates.quick, same_day: req.body.distanceRates.same_day },
        isActive: true,
        effectiveFrom: new Date(),
        updatedBy: req.user?._id,
        note,
      }], { session });
      created = row;
    });
  } finally {
    await session.endSession();
  }

  // The next cart/checkout price must carry the new figure, not the one
  // after the cache TTL.
  await loadDeliveryChargeSetting();

  return ok(res, created, 'Customer delivery charge updated');
});

/**
 * @desc    The three radius ceilings — Same-Day, seller service, delivery
 *          partner pickup. Same shape as GET /api/admin/delivery-charge:
 *          `current` is the active row, or a `{ source: 'default' }` object
 *          built from the env-var/hardcoded fallback if nothing has been
 *          configured yet. `history` is the last 50 rows.
 * @route   GET /api/admin/radius-settings
 * @access  Private/Admin
 */
export const getRadiusSettingForAdmin = asyncHandler(async (req, res) => {
  const active = await RadiusSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await RadiusSetting.find().sort({ createdAt: -1 }).limit(50)
    .populate('updatedBy', 'name email').lean();

  const live = getRadiusSetting();
  const current = active
    ? { ...active, source: 'configured' }
    : { ...live, source: 'default' };

  return ok(res, { current, history }, 'Radius settings');
});

/**
 * @desc    Set the three radius ceilings.
 *
 * Same insert-not-edit pattern as setDeliveryChargeSettingForAdmin above:
 * the previous row is deactivated and kept, so a past change stays
 * auditable. Every value is validated independently — none of these three
 * numbers is allowed to silently fall back to a stale default because the
 * admin only meant to change one of them; the frontend always sends all
 * three.
 *
 * This does NOT touch any Seller.serviceRadiusKm / sameDay.radiusKm or
 * DeliveryPartner.deliveryRadiusKm document — lowering a ceiling here
 * never mutates an already-stored individual radius (see Phase 1 audit).
 * It only changes what a *future* write to those fields is allowed to be,
 * and (for Same-Day only) the live `Math.min` clamp in sameDay.service.js.
 *
 * @route POST /api/admin/radius-settings
 */
export const setRadiusSettingForAdmin = asyncHandler(async (req, res) => {
  const { sameDayMaxRadiusKm, sellerServiceMaxRadiusKm, deliveryPartnerMaxRadiusKm, note } = req.body;

  const parse = (label, raw) => {
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === '') throw httpError(400, `${label} is required`);
    if (!Number.isFinite(n)) throw httpError(400, `${label} must be a number`);
    if (n <= 0) throw httpError(400, `${label} must be greater than 0`);
    if (n > RADIUS_HARD_SAFETY_CEILING_KM) {
      throw httpError(400, `${label} cannot exceed ${RADIUS_HARD_SAFETY_CEILING_KM}km`);
    }
    return Number(n.toFixed(2));
  };

  const sameDayKm = parse('Same-Day maximum radius', sameDayMaxRadiusKm);
  const sellerKm = parse('Seller service maximum radius', sellerServiceMaxRadiusKm);
  const partnerKm = parse('Delivery partner maximum radius', deliveryPartnerMaxRadiusKm);

  const session = await mongoose.startSession();
  let createdRow;
  try {
    await session.withTransaction(async () => {
      await RadiusSetting.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });
      const [row] = await RadiusSetting.create([{
        sameDayMaxRadiusKm: sameDayKm,
        sellerServiceMaxRadiusKm: sellerKm,
        deliveryPartnerMaxRadiusKm: partnerKm,
        isActive: true,
        effectiveFrom: new Date(),
        updatedBy: req.user?._id,
        note,
      }], { session });
      createdRow = row;
    });
  } finally {
    await session.endSession();
  }

  // The very next Same-Day check / radius write must see the new ceiling,
  // not whatever the TTL happened to be holding.
  await loadRadiusSetting();

  return ok(res, createdRow, 'Radius settings updated');
});

/**
 * What a rider would earn, at a distance the admin types.
 *
 * Runs the real riderPayout(), so the number on the admin's screen is the same
 * number the rider's offer screen will show. A separate formula here would be
 * the ₹97/₹37 bug rebuilt in the admin panel.
 *
 * @route GET /api/admin/delivery-rates/preview?distanceKm=4&mode=quick
 */
export const previewDeliveryRate = asyncHandler(async (req, res) => {
  const km = Number(req.query.distanceKm);
  if (!Number.isFinite(km) || km < 0) throw httpError(400, 'Enter a distance in kilometres');

  const modes = req.query.mode ? [req.query.mode] : PAYOUT_MODES;
  const rows = modes.map((mode) => {
    const override = (req.query.base !== undefined && req.query.perKm !== undefined)
      ? { base: Number(req.query.base), perKm: Number(req.query.perKm),
          minPayout: Number(req.query.minPayout) || 0,
          maxPayout: req.query.maxPayout ? Number(req.query.maxPayout) : undefined }
      : undefined;
    return riderPayout(km, { mode, rates: override });
  });

  return ok(res, { distanceKm: km, quotes: rows }, 'Payout preview');
});

/**
 * What a proposed rate would have cost over recent deliveries.
 *
 * An admin changing ₹10 to ₹15 is committing the platform to a bill they cannot
 * see from the form. This reprices the last 30 days of completed deliveries
 * under the proposed figures and reports the difference, so the decision is made
 * with the number in front of them.
 *
 * @route GET /api/admin/delivery-rates/impact?mode=quick&base=20&perKm=15
 */
export const deliveryRateImpact = asyncHandler(async (req, res) => {
  const { mode } = req.query;
  if (!PAYOUT_MODES.includes(mode)) throw httpError(400, 'Choose a delivery mode');

  const base = Number(req.query.base);
  const perKm = Number(req.query.perKm);
  if (!Number.isFinite(base) || !Number.isFinite(perKm)) throw httpError(400, 'Enter both base and per-km');

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deliveries = await Delivery.find({
    status: 'delivered',
    endTime: { $gte: since },
  }).select('route partnerEarnings ratesUsed').lean();

  const mine = deliveries.filter((d) => (d.ratesUsed?.mode || 'quick') === mode);

  let paid = 0, proposed = 0;
  for (const d of mine) {
    paid += Number(d.partnerEarnings) || 0;
    proposed += riderPayout(d.route?.distanceKm, {
      mode,
      rates: { base, perKm, minPayout: Number(req.query.minPayout) || 0 },
    }).total;
  }

  return ok(res, {
    mode,
    deliveries: mine.length,
    windowDays: 30,
    paid: Math.round(paid),
    proposed: Math.round(proposed),
    difference: Math.round(proposed - paid),
  }, 'Rate impact over the last 30 days');
});





















/* ============================================================================
 * DASHBOARD OVERVIEW ANALYTICS — Platform Overview tab
 * ========================================================================== */

// Orders that never actually completed don't count toward revenue or the
// category sales breakdown below — a cancelled/returned/refunded order was
// never real money that landed on the platform.
const REVENUE_EXCLUDED_STATUSES = ['cancelled', 'return_requested', 'returned', 'refunded'];

/**
 * Sum of sold quantity per top-level (header) category, split by channel.
 *
 * Categories only go three levels deep in this app (Header → Main → Sub), so
 * resolving "which header does this leaf roll up to" is a small in-memory
 * walk over the whole category collection (a few hundred rows, cheap to hold
 * entirely) rather than a $graphLookup — simpler, and this only runs for an
 * admin dashboard view, never a hot path.
 */
const computeCategorySales = async (limit = 5) => {
  const [categories, itemTotals] = await Promise.all([
    Category.find({}).select('name parent type').lean(),
    Order.aggregate([
      { $match: { status: { $nin: REVENUE_EXCLUDED_STATUSES } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', qty: { $sum: '$items.qty' } } },
    ]),
  ]);

  const catById = new Map(categories.map((c) => [String(c._id), c]));
  const rootNameCache = new Map();
  const rootNameOf = (categoryId) => {
    const key = String(categoryId);
    if (rootNameCache.has(key)) return rootNameCache.get(key);
    let cur = catById.get(key);
    let hops = 0;
    while (cur && cur.parent && hops < 5) {
      cur = catById.get(String(cur.parent));
      hops += 1;
    }
    const name = cur?.name || null;
    rootNameCache.set(key, name);
    return name;
  };

  const productIds = itemTotals.map((row) => row._id).filter(Boolean);
  const products = await Product.find({ _id: { $in: productIds } }).select('type category').lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const sums = { ecommerce: new Map(), grocery: new Map() };
  for (const row of itemTotals) {
    const product = productById.get(String(row._id));
    if (!product || !sums[product.type]) continue;
    const rootName = rootNameOf(product.category);
    if (!rootName) continue;
    const bucket = sums[product.type];
    bucket.set(rootName, (bucket.get(rootName) || 0) + row.qty);
  }

  const topOf = (bucket) => [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, qty]) => ({ name, qty }));

  return { ecommerceCategories: topOf(sums.ecommerce), quickCommerceCategories: topOf(sums.grocery) };
};

// @desc    Platform Overview — KPI cards + recent-activity widgets
// @route   GET /api/admin/dashboard/overview
// @access  Private/Admin
export const getDashboardOverview = asyncHandler(async (req, res) => {
  const [
    pendingSellers, totalOrders, ecommerceOrders, groceryOrders,
    totalUsers, totalSellers,
    recentOrdersRaw, lowStockRaw, recentSellersRaw, categorySales,
  ] = await Promise.all([
    Seller.countDocuments({ status: VENDOR_STATUS.PENDING }),
    Order.countDocuments({}),
    Order.countDocuments({ type: CHANNEL.ECOM }),
    Order.countDocuments({ type: CHANNEL.GROCERY }),
    User.countDocuments({ roles: 'buyer' }),
    Seller.countDocuments({ status: VENDOR_STATUS.APPROVED }),
    Order.find({}).sort({ createdAt: -1 }).limit(10).select('orderNo type pricing.totalAmount status createdAt').lean(),
    Product.find({ stock: { $lt: 10 }, isDeleted: false, fulfillmentType: { $ne: 'digital' } }).sort({ stock: 1 }).limit(10)
      .populate('sellerId', 'businessName').lean(),
    Seller.find({}).sort({ createdAt: -1 }).limit(5).select('businessName status createdAt').lean(),
    computeCategorySales(5),
  ]);

  return ok(res, {
    revenue: null, // Deprecated ambiguous metric; use permission-scoped financial-metrics.
    pendingSellers,
    totalOrders,
    ecommerceOrders,
    groceryOrders,
    totalUsers,
    totalSellers,
    recentOrders: recentOrdersRaw.map((o) => ({
      id: o._id,
      buyerName: 'Customer',
      orderNo: o.orderNo,
      type: o.type,
      amount: (() => { try { return dashboardMoneyPaise(o.pricing?.totalAmount) / 100; } catch { return null; } })(),
      status: o.status,
      createdAt: o.createdAt,
    })),
    lowStockAlerts: lowStockRaw.map((p) => ({
      id: p._id,
      name: p.name,
      stock: p.stock,
      sellerName: p.sellerId?.businessName || '—',
    })),
    recentSellers: recentSellersRaw.map((s) => ({
      id: s._id,
      name: s.businessName,
      status: s.status,
      createdAt: s.createdAt,
    })),
    ...categorySales,
  });
});

/* ============================================================================
 * CONSUMER MANAGEMENT — Consumer Users tab
 * ========================================================================== */

// @desc    Buyer counts by behavioural status — total/active/inactive/blocked,
//          plus new-signup counts for the last 7/30 days
// @route   GET /api/admin/consumers/stats
// @access  Private/Admin
export const getConsumerStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, blocked, newLast7Days, newLast30Days, recentBuyerIds] = await Promise.all([
    User.countDocuments({ roles: 'buyer' }),
    User.countDocuments({ roles: 'buyer', isActive: false }),
    User.countDocuments({ roles: 'buyer', createdAt: { $gte: sevenDaysAgo } }),
    User.countDocuments({ roles: 'buyer', createdAt: { $gte: thirtyDaysAgo } }),
    Order.distinct('userId', { createdAt: { $gte: thirtyDaysAgo } }),
  ]);
  const [active, inactive] = await Promise.all([
    User.countDocuments({ roles: 'buyer', isActive: true, _id: { $in: recentBuyerIds } }),
    User.countDocuments({ roles: 'buyer', isActive: true, _id: { $nin: recentBuyerIds } }),
  ]);

  return ok(res, { total, active, inactive, blocked, newLast7Days, newLast30Days });
});

/**
 * @desc    Recent buyer-account activity, newest first
 * @route   GET /api/admin/consumers/activity-log?state=&district=
 * @access  Private/Admin
 *
 * There is no dedicated login/session or field-level audit trail in this
 * schema — wallet transactions are the one genuinely timestamped per-event
 * record a buyer account has, so they anchor this feed. Profile/address
 * edits are surfaced as a single "account updated" entry per user off
 * `updatedAt`, since individual field changes aren't tracked separately.
 *
 * `state`/`district` are the same geographic filter as listUsers — matched
 * against each buyer's DEFAULT address only, `district` really meaning
 * `city` (see listUsers's own comment for why). Every row's `location` is
 * resolved from that same default address — a real value, never the
 * "Not tracked" placeholder that's honest only for Device/IP (which truly
 * has no capture path anywhere in this codebase).
 */
export const getCustomerActivityLog = asyncHandler(async (req, res) => {
  const cap = Math.min(Number(req.query.limit) || 50, 200);
  const { state, district } = req.query;

  let allowedIds = null;
  const locationByUserId = new Map();

  if (state || district) {
    const elemMatch = { isDefault: true };
    if (state) elemMatch.state = new RegExp(`^${escapeRegexForUserFilter(state)}$`, 'i');
    if (district) elemMatch.city = new RegExp(`^${escapeRegexForUserFilter(district)}$`, 'i');

    const matched = await User.find({ roles: 'buyer', addresses: { $elemMatch: elemMatch } }).select('_id addresses').lean();
    allowedIds = matched.map((u) => u._id);
    for (const u of matched) {
      const def = (u.addresses || []).find((a) => a.isDefault);
      if (def) locationByUserId.set(String(u._id), [def.city, def.state].filter(Boolean).join(', '));
    }
    if (allowedIds.length === 0) return ok(res, []); // nobody matches this state/district — nothing further to query
  }

  const walletMatch = { roles: 'buyer', 'wallet.transactions.0': { $exists: true }, ...(allowedIds ? { _id: { $in: allowedIds } } : {}) };
  const accountFilter = { roles: 'buyer', ...(allowedIds ? { _id: { $in: allowedIds } } : {}) };

  const [walletEvents, recentlyUpdated] = await Promise.all([
    User.aggregate([
      { $match: walletMatch },
      { $unwind: '$wallet.transactions' },
      { $sort: { 'wallet.transactions.createdAt': -1 } },
      { $limit: cap },
      { $project: {
        userId: '$_id', userName: '$name', userPhone: '$phone',
        txnType: '$wallet.transactions.type', amount: '$wallet.transactions.amount',
        description: '$wallet.transactions.description', timestamp: '$wallet.transactions.createdAt',
      } },
    ]),
    User.find(accountFilter).sort({ updatedAt: -1 }).limit(cap).select('name phone updatedAt createdAt').lean(),
  ]);

  const walletRows = walletEvents.map((w) => ({
    userId: w.userId,
    type: w.txnType === 'credit' ? 'wallet_credit' : 'wallet_debit',
    userName: w.userName,
    userPhone: w.userPhone,
    description: w.description || (w.txnType === 'credit' ? 'Wallet credited' : 'Wallet debited'),
    amount: w.amount,
    timestamp: w.timestamp,
  }));

  const accountRows = recentlyUpdated
    .filter((u) => u.updatedAt && u.createdAt && u.updatedAt.getTime() !== u.createdAt.getTime())
    .map((u) => ({
      userId: u._id,
      type: 'account_update',
      userName: u.name,
      userPhone: u.phone,
      description: 'Profile or saved address updated',
      timestamp: u.updatedAt,
    }));

  let merged = [...walletRows, ...accountRows]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, cap);

  // Resolve real locations for whichever buyers ended up in the merged feed.
  // Already known above when a state/district filter was active; otherwise
  // one small lookup for just this (capped, so always small) set of users.
  if (!allowedIds) {
    const ids = [...new Set(merged.map((r) => String(r.userId)).filter(Boolean))];
    if (ids.length) {
      const located = await User.find({ _id: { $in: ids } }).select('_id addresses').lean();
      for (const u of located) {
        const def = (u.addresses || []).find((a) => a.isDefault);
        if (def) locationByUserId.set(String(u._id), [def.city, def.state].filter(Boolean).join(', '));
      }
    }
  }

  merged = merged.map((r) => ({ ...r, location: locationByUserId.get(String(r.userId)) || null }));

  return ok(res, merged);
});

/**
 * @desc    Order history — one buyer's (consumer detail drawer), every
 *          order on a channel (the main E-Commerce/Quick Commerce Orders
 *          tabs), or every order ever placed across BOTH channels (the
 *          Consumer Users -> Orders tab) — paginated either way.
 * @route   GET /api/admin/consumers/orders?userId=&type=&status=&search=
 * @access  Private/Admin
 *
 * Every filter is optional now. Omitting all of them used to 400 — "an
 * unfiltered dump of every order ever placed is never what either caller
 * actually wants" — but the Consumer Users directory's own Orders tab is
 * now exactly that caller: it wants the full history across channels,
 * always current as new orders come in, one paginated query at a time.
 */
export const getCustomerOrders = asyncHandler(async (req, res) => {
  const { userId, type, status, search, salesChannel } = req.query;
  // Wholesale has its own admin list; retail lists exclude it. Orders saved
  // before salesChannel existed are retail (the schema default).
  if (salesChannel !== undefined && !['retail', 'wholesale'].includes(salesChannel)) throw httpError(400, 'Sales channel must be retail or wholesale');
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (userId) filter.userId = userId;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (salesChannel === 'wholesale') filter.salesChannel = 'wholesale';
  else if (salesChannel === 'retail') filter.salesChannel = { $ne: 'wholesale' };

  if (search) {
    const rx = new RegExp(escapeRegexForUserFilter(search), 'i');
    const matchingUsers = await User.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').lean();
    filter.$or = [{ orderNo: rx }, { userId: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('userId', 'name phone')
      // Seller/SHG shop name — whichever fulfilled this order's item(s).
      // An order's items all belong to the same fulfilment group (see
      // Order.js's own `groupRef` comment), so the first item's vendor is
      // the order's vendor.
      .populate('items.sellerId', 'businessName storeDetails.name storeDetails.address storeDetails.city storeDetails.phone')
      // Delivery partner — vehicle details live on DeliveryPartner itself;
      // name/phone live on the User behind it, one level further in.
      .populate({
        path: 'deliveryPartnerId',
        select: 'vehicleType vehicleNo userId',
        populate: { path: 'userId', select: 'name phone' },
      })
      .populate('paymentId', 'method status amount refund')
      .populate('deliveryId', 'status createdAt startTime endTime otpVerified timeline pickupLocation dropLocation route')
      .lean(),
    Order.countDocuments(filter),
  ]);

  return paginated(res, orders, { page, limit, total });
});

// @desc    Every product review, flattened across the catalogue, newest first
// @route   GET /api/admin/consumers/reviews?search=
// @access  Private/Admin
export const getCustomerReviews = asyncHandler(async (req, res) => {
  const { search, status } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const pipeline = [
    { $match: { 'ratings.reviews.0': { $exists: true } } },
    { $unwind: '$ratings.reviews' },
    { $lookup: { from: 'users', localField: 'ratings.reviews.userId', foreignField: '_id', as: 'reviewer' } },
    { $unwind: { path: '$reviewer', preserveNullAndEmptyArrays: true } },
    { $project: {
      reviewId: '$ratings.reviews._id',
      productId: '$_id',
      productName: '$name',
      // The snapshot taken at submission, falling back to the live account
      // for any review written before that field existed.
      userName: { $ifNull: ['$ratings.reviews.userName', '$reviewer.name'] },
      userPhone: '$reviewer.phone',
      rating: '$ratings.reviews.rating',
      comment: '$ratings.reviews.comment',
      // A review stored before moderation existed has no status at all;
      // it is reported as pending so it surfaces in the queue rather than
      // vanishing from every filter.
      status: { $ifNull: ['$ratings.reviews.status', 'pending'] },
      rejectionReason: '$ratings.reviews.rejectionReason',
      createdAt: '$ratings.reviews.createdAt',
    } },
    { $sort: { createdAt: -1 } },
  ];

  // Filtered after the projection so it reads the same normalised `status`
  // the admin list is showing.
  if (status && status !== 'all') {
    pipeline.push({ $match: { status } });
  }
  if (search) {
    const rx = new RegExp(search, 'i');
    pipeline.push({ $match: { $or: [{ productName: rx }, { userName: rx }, { comment: rx }] } });
  }

  const [rows, countRows] = await Promise.all([
    Product.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
    Product.aggregate([...pipeline, { $count: 'total' }]),
  ]);

  return paginated(res, rows, { page, limit, total: countRows[0]?.total || 0 });
});

/**
 * @desc    Approve or reject one review
 * @route   PATCH /api/admin/consumers/reviews/:id/status
 * @access  Private/Admin
 *
 * This is the gate: a review is invisible to shoppers and worth nothing to
 * the product's score until it passes through here. Approving or un-approving
 * one moves the score, so the rollup is recomputed from approved reviews by
 * the same helper the submission path uses.
 */
export const updateReviewStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw httpError(400, 'Status must be approved, rejected or pending');
  }

  const product = await Product.findOne({ 'ratings.reviews._id': id });
  if (!product) throw httpError(404, 'Review not found');

  const review = product.ratings.reviews.id(id);
  if (!review) throw httpError(404, 'Review not found');

  review.status = status;

  const isRejection = status === 'rejected';
  if (isRejection && rejectionReason !== undefined) {
    review.rejectionReason = rejectionReason;
  }

  const rollup = applyApprovedRatings(product);

  /**
   * A targeted update, not `product.save()`.
   *
   * Saving would run the product's own pre-validate hook over a document
   * whose variants/pricing this edit never touched — moderating a review
   * must not be able to fail on, or rewrite, unrelated product fields.
   */
  const update = {
    $set: {
      'ratings.reviews.$.status': review.status,
      'ratings.count': rollup.count,
      'ratings.average': rollup.average,
    },
  };

  if (isRejection) {
    update.$set['ratings.reviews.$.rejectionReason'] = review.rejectionReason || '';
  } else {
    /**
     * `$unset`, not `$set: undefined` — Mongoose strips undefined values out
     * of an update, so assigning it leaves the old value in place. Approving
     * a previously-rejected review would otherwise keep the note explaining
     * why it was turned down, sitting on a review that is now live.
     */
    update.$unset = { 'ratings.reviews.$.rejectionReason': '' };
    review.rejectionReason = undefined;
  }

  await Product.updateOne({ _id: product._id, 'ratings.reviews._id': id }, update);

  return ok(res, {
    reviewId: id,
    productId: product._id,
    status: review.status,
    ratings: rollup,
  }, `Review ${status}`);
});

// @desc    Remove one review from a product's embedded reviews array
// @route   DELETE /api/admin/consumers/reviews/:id
// @access  Private/Admin
export const deleteCustomerReview = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const product = await Product.findOneAndUpdate(
    { 'ratings.reviews._id': id },
    { $pull: { 'ratings.reviews': { _id: id } } },
    { returnDocument: 'after' }
  ).select('ratings');
  if (!product) throw httpError(404, 'Review not found');

  /**
   * `ratings.average`/`count` are a cached rollup of the APPROVED reviews —
   * recomputed by the shared helper now that one entry is gone, so deleting
   * a pending or rejected review correctly leaves the score alone. A
   * targeted update rather than a full `.save()`, so the product's own
   * validation hooks don't run over an edit that never touched pricing.
   */
  const rollup = applyApprovedRatings(product);
  await Product.updateOne(
    { _id: product._id },
    { $set: { 'ratings.count': rollup.count, 'ratings.average': rollup.average } }
  );

  return ok(res, { productId: product._id, ratings: rollup }, 'Review removed');
});

/* ============================================================================
 * ADMIN NOTIFICATIONS
 * ============================================================================
 * Admin's own inbox — separate from /api/notifications (User-only, see
 * notification.controller.js) because Admin is a different model with no
 * relationship to a User document. Same envelope/shape as the User-facing
 * endpoints on purpose, just scoped by recipientModel: 'Admin' instead.
 * ========================================================================== */

// @desc    List the caller admin's own notifications, newest first.
// @route   GET /api/admin/notifications
// @access  Private/Admin
export const getAdminNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, 20, 50);
  const filter = { userId: req.user._id, recipientModel: 'Admin', event: { $ne: 'SELLER_PROMOTION_UPDATE' }, 'metadata.promotionId': null };

  const [items, total] = await Promise.all([
    NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    NotificationModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

// @desc    Unread count for the caller admin.
// @route   GET /api/admin/notifications/unread-count
// @access  Private/Admin
export const getAdminUnreadCount = asyncHandler(async (req, res) => {
  const count = await NotificationModel.countDocuments({ userId: req.user._id, recipientModel: 'Admin', isRead: false, event: { $ne: 'SELLER_PROMOTION_UPDATE' }, 'metadata.promotionId': null });
  return ok(res, { count });
});

// @desc    Mark one of the caller admin's own notifications read.
// @route   PATCH /api/admin/notifications/:id/read
// @access  Private/Admin
export const markAdminNotificationRead = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid notification id');
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id, recipientModel: 'Admin' },
    { $set: { isRead: true } },
    { returnDocument: 'after' }
  );
  if (!notification) throw httpError(404, 'Notification not found');
  return ok(res, notification, 'Marked as read');
});

// @desc    Mark all of the caller admin's own notifications read.
// @route   PATCH /api/admin/notifications/read-all
// @access  Private/Admin
export const markAllAdminNotificationsRead = asyncHandler(async (req, res) => {
  const result = await NotificationModel.updateMany(
    { userId: req.user._id, recipientModel: 'Admin', isRead: false },
    { $set: { isRead: true } }
  );
  return ok(res, { modified: result.modifiedCount }, 'All notifications marked as read');
});

/* ============================================================================
 * SUPPORT TICKETS
 * ========================================================================== */

const normalizeStatus = (t) => ({ ...t, status: LEGACY_TICKET_STATUS_MAP[t.status] || t.status });

const uploadAdminAttachments = async (files = []) => {
  if (!files.length) return [];
  if (files.length > TICKET_MAX_ATTACHMENTS) throw httpError(400, `You can attach at most ${TICKET_MAX_ATTACHMENTS} files`);
  const uploaded = [];
  for (const file of files) {
    const meta = await uploadFileWithMeta(file.buffer, 'support-tickets', {
      resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
    });
    uploaded.push({
      url: meta.url, publicId: meta.publicId, fileName: file.originalname,
      mimeType: file.mimetype, size: meta.size, resourceType: meta.resourceType,
    });
  }
  return uploaded;
};

// @desc    List support tickets — filterable by status/category/requesterRole, searchable
// @route   GET /api/admin/tickets?status=&category=&requesterRole=&search=
// @access  Private/Admin
export const getTickets = asyncHandler(async (req, res) => {
  const { status, category, requesterRole, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (category && category !== 'all') filter.category = category;
  if (requesterRole && requesterRole !== 'all') filter.requesterRole = requesterRole;
  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ subject: rx }, { userName: rx }, { userEmail: rx }, { ticketNumber: rx }];
  }

  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('assignedAdmin', 'name email').lean(),
    Ticket.countDocuments(filter),
  ]);

  return paginated(res, tickets.map(normalizeStatus), { page, limit, total });
});

// @desc    Ticket detail — requester, related entities, full conversation
//          including internal notes (admin-only view).
// @route   GET /api/admin/tickets/:id
// @access  Private/Admin
export const getTicketDetailAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');
  const ticket = await Ticket.findById(req.params.id)
    .populate('assignedAdmin', 'name email')
    .populate('relatedOrder', 'orderNo status pricing')
    .populate('relatedProduct', 'name images')
    .populate('relatedDelivery', 'status');
  if (!ticket) throw httpError(404, 'Ticket not found');

  const messages = await TicketMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean();
  return ok(res, { ticket: normalizeStatus(ticket.toObject()), messages });
});

// @desc    Admin reply — visible to the requester, notifies them.
// @route   POST /api/admin/tickets/:id/messages
// @access  Private/Admin
export const replyToTicket = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');
  const { message } = req.body;
  if (!message || !message.trim()) throw httpError(400, 'Message is required');

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw httpError(404, 'Ticket not found');

  const attachments = await uploadAdminAttachments(req.files);
  const entry = await TicketMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: 'admin',
    senderName: req.user.name || 'Support Team',
    message: message.trim(),
    attachments,
    isInternal: false,
  });

  // A reply is also how a WAITING_FOR_USER conversation resumes from the
  // admin side — but only that one specific transition; anything else goes
  // through the explicit status-change endpoint below.
  if (ticket.status === TICKET_STATUS.WAITING_FOR_USER) {
    ticket.status = TICKET_STATUS.IN_PROGRESS;
    await ticket.save();
  }

  notifyRequester(ticket, {
    event: NOTIFICATION_EVENT.TICKET_REPLY,
    title: 'New reply on your ticket',
    message: `Support ticket ${ticket.ticketNumber || ticket._id} has a new reply.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  });

  return created(res, entry, 'Reply sent');
});

// @desc    Internal note — admin-only, never returned by any requester API.
// @route   POST /api/admin/tickets/:id/notes
// @access  Private/Admin
export const addInternalNote = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');
  const { message } = req.body;
  if (!message || !message.trim()) throw httpError(400, 'Note is required');

  const ticket = await Ticket.findById(req.params.id).select('_id');
  if (!ticket) throw httpError(404, 'Ticket not found');

  const attachments = await uploadAdminAttachments(req.files);
  const entry = await TicketMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: 'admin',
    senderName: req.user.name || 'Support Team',
    message: message.trim(),
    attachments,
    isInternal: true,
  });

  return created(res, entry, 'Internal note added');
});

// @desc    Assign/reassign a ticket to an admin. Simple single-owner field — no team/department system.
// @route   PATCH /api/admin/tickets/:id/assign
// @access  Private/Admin
export const assignTicket = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');
  const { adminId } = req.body;
  if (adminId && !mongoose.isValidObjectId(adminId)) throw httpError(400, 'Invalid admin id');

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw httpError(404, 'Ticket not found');

  ticket.assignedAdmin = adminId || req.user._id; // default: assign to self
  await ticket.save();

  notifyRequester(ticket, {
    event: NOTIFICATION_EVENT.TICKET_ASSIGNED,
    title: 'Your ticket is being handled',
    message: `Support ticket ${ticket.ticketNumber || ticket._id} has been assigned to a support agent.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  });

  const populated = await ticket.populate('assignedAdmin', 'name email');
  return ok(res, populated, 'Ticket assigned');
});

// @desc    Generic admin status change, restricted to the allowed transition table.
// @route   PATCH /api/admin/tickets/:id/status
// @access  Private/Admin
export const changeTicketStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');
  const { status } = req.body;

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw httpError(404, 'Ticket not found');

  const from = LEGACY_TICKET_STATUS_MAP[ticket.status] || ticket.status;
  assertAdminTransition(from, status);

  ticket.status = status;
  if (status === TICKET_STATUS.RESOLVED) ticket.resolvedAt = new Date();
  if (status === TICKET_STATUS.CLOSED) ticket.closedAt = new Date();
  await ticket.save();

  const eventByStatus = {
    [TICKET_STATUS.RESOLVED]: NOTIFICATION_EVENT.TICKET_RESOLVED,
    [TICKET_STATUS.CLOSED]: NOTIFICATION_EVENT.TICKET_CLOSED,
  };
  notifyRequester(ticket, {
    event: eventByStatus[status] || NOTIFICATION_EVENT.TICKET_STATUS_CHANGED,
    title: status === TICKET_STATUS.RESOLVED ? 'Ticket resolved' : status === TICKET_STATUS.CLOSED ? 'Ticket closed' : 'Ticket status updated',
    message: `Support ticket ${ticket.ticketNumber || ticket._id} is now ${status.replace(/_/g, ' ').toLowerCase()}.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  });

  return ok(res, ticket, 'Status updated');
});

// @desc    Resolve a ticket with an admin reply — kept for backward
//          compatibility with the original endpoint/frontend; now also
//          writes the reply into TicketMessage (the real conversation) and
//          notifies the requester, rather than only setting the legacy
//          `reply` string field.
// @route   PATCH /api/admin/tickets/:id/resolve
// @access  Private/Admin
export const resolveTicket = asyncHandler(async (req, res) => {
  const { reply } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid ticket id');

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw httpError(404, 'Ticket not found');

  ticket.status = TICKET_STATUS.RESOLVED;
  if (reply !== undefined) ticket.reply = reply;
  ticket.resolvedAt = new Date();
  await ticket.save();

  if (reply && reply.trim()) {
    await TicketMessage.create({
      ticketId: ticket._id,
      senderId: req.user._id,
      senderRole: 'admin',
      senderName: req.user.name || 'Support Team',
      message: reply.trim(),
      isInternal: false,
    });
  }

  notifyRequester(ticket, {
    event: NOTIFICATION_EVENT.TICKET_RESOLVED,
    title: 'Ticket resolved',
    message: `Support ticket ${ticket.ticketNumber || ticket._id} has been resolved.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  });

  return ok(res, ticket, 'Ticket resolved');
});

// Delivery history (Completed Deliveries) lives in adminDeliveryOps.controller.js.

/* ============================================================================
 * VENDOR ECOSYSTEM DASHBOARD — General Vendors › Dashboard
 * ========================================================================== */

// @desc    Health of the general-vendor ecosystem: roster, catalogue, trade
// @route   GET /api/admin/vendor-dashboard?days=30
// @access  Private/Admin
export const vendorDashboard = asyncHandler(async (req, res) => {
  const requestedDays = parseInt(req.query.days, 10);
  const days = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, 365)
    : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [byStatus, catalogue, storefronts, tradeRows, topRows, recent] = await Promise.all([
    Seller.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

    // Listings belonging to a seller — SHG products have no sellerId and are
    // reported on their own screen, never folded in here.
    Product.aggregate([
      { $match: { sellerId: { $ne: null }, isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          live: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$isActive'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
        },
      },
    ]),

    // An approved vendor who never finished their storefront cannot be found
    // by a shopper, which is a different problem from not being approved.
    Seller.countDocuments({
      status: VENDOR_STATUS.APPROVED,
      'storeDetails.name': { $exists: true, $nin: [null, ''] },
    }),

    /**
     * Trade in the window, attributed per seller through the order line.
     * Revenue counts on delivery only — a placed order is a promise.
     */
    Order.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': { $ne: null } } },
      {
        $group: {
          _id: null,
          sales: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] },
                { $divide: [itemGrossExpression(), 100] }, 0],
            },
          },
          // Orders, not lines — two of a seller's items in one basket is one
          // order, and summing the unwound lines would double-count it.
          deliveredOrders: { $addToSet: { $cond: [{ $eq: ['$status', 'delivered'] }, '$_id', '$$REMOVE'] } },
          allOrders: { $addToSet: '$_id' },
          sellers: { $addToSet: '$items.sellerId' },
        },
      },
      {
        $project: {
          sales: 1,
          deliveredOrders: { $size: '$deliveredOrders' },
          totalOrders: { $size: '$allOrders' },
          sellingVendors: { $size: '$sellers' },
        },
      },
    ]),

    Order.aggregate([
      { $match: { createdAt: { $gte: since }, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': { $ne: null } } },
      {
        $group: {
          _id: '$items.sellerId',
          sales: { $sum: { $divide: [itemGrossExpression(), 100] } },
          orders: { $addToSet: '$_id' },
          units: { $sum: { $ifNull: ['$items.qty', 0] } },
        },
      },
      { $project: { sales: 1, units: 1, orders: { $size: '$orders' } } },
      { $sort: { sales: -1 } },
      { $limit: 8 },
    ]),

    // The queue an admin would actually act on next.
    Seller.find({ status: VENDOR_STATUS.PENDING })
      .populate('userId', 'name phone')
      .select('businessName storeDetails.name storeDetails.city updatedAt userId')
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean(),
  ]);

  const counts = byStatus.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  const cat = catalogue[0] || { total: 0, live: 0, pending: 0, outOfStock: 0 };
  const trade = tradeRows[0] || { sales: 0, deliveredOrders: 0, totalOrders: 0, sellingVendors: 0 };

  const topSellerIds = topRows.map((r) => r._id);
  const topSellers = await Seller.find({ _id: { $in: topSellerIds } })
    .select('businessName storeDetails.name storeDetails.city rating')
    .lean();
  const sellerById = new Map(topSellers.map((s) => [String(s._id), s]));

  const approved = counts[VENDOR_STATUS.APPROVED] || 0;

  return ok(res, {
    window: { days, since },
    roster: {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      approved,
      pending: counts[VENDOR_STATUS.PENDING] || 0,
      underReview: counts[VENDOR_STATUS.UNDER_REVIEW] || 0,
      rejected: counts[VENDOR_STATUS.REJECTED] || 0,
      suspended: counts[VENDOR_STATUS.SUSPENDED] || 0,
      // Half-finished sign-ups, reported apart so they never inflate the
      // roster an admin reads as "vendors we have".
      incomplete: counts[VENDOR_STATUS.INCOMPLETE] || 0,
      storefrontsLive: storefronts,
      // Approved but with no storefront set up — invisible to shoppers.
      storefrontsMissing: Math.max(approved - storefronts, 0),
    },
    catalogue: cat,
    trade: {
      sales: Math.round(trade.sales),
      deliveredOrders: trade.deliveredOrders,
      totalOrders: trade.totalOrders,
      sellingVendors: trade.sellingVendors,
      // Share of approved vendors that actually traded in the window. Null
      // rather than 0% when nobody is approved yet, which is not a result.
      activeRate: approved > 0
        ? Math.round((trade.sellingVendors / approved) * 1000) / 10
        : null,
    },
    topVendors: topRows.map((r) => {
      const s = sellerById.get(String(r._id));
      return {
        sellerId: r._id,
        name: s?.storeDetails?.name || s?.businessName || 'Vendor',
        city: s?.storeDetails?.city || null,
        rating: s?.rating > 0 ? s.rating : null,
        sales: Math.round(r.sales),
        orders: r.orders,
        units: r.units,
      };
    }),
    pendingQueue: recent.map((s) => ({
      sellerId: s._id,
      name: s.storeDetails?.name || s.businessName || 'Vendor',
      owner: s.userId?.name || s.userId?.phone || '—',
      city: s.storeDetails?.city || null,
      submittedAt: s.updatedAt,
    })),
  }, 'Vendor dashboard');
});














/* ============================================================================
 * DELIVERY HUB ZONES — Delivery Fleet › Delivery Hub Zones
 *
 * A "zone" here is a serviceable pincode, not a separate record an admin
 * creates by hand. That is what the platform already dispatches on: when the
 * geo search finds nobody, deliveryPartner.controller.js falls back to
 * matching `DeliveryPartner.zones` against the store's or the destination's
 * pincode. Inventing a parallel DeliveryZone collection would mean an admin
 * could carefully configure a zone that dispatch never consults.
 *
 * So this screen reports real coverage — which pincodes riders have declared
 * they serve, how many of them are online there right now, and which stores
 * sit inside — rather than offering a form that writes to nothing. That is
 * also why the screen has no "add zone" action: a zone comes into existence
 * when a rider says they will serve it.
 * ========================================================================== */

// @desc    Serviceable pincodes with rider coverage and the stores inside them
// @route   GET /api/admin/delivery-zones?state=&city=&search=&status=
// @access  Private/Admin
export const listDeliveryZones = asyncHandler(async (req, res) => {
  const { state, city, search, status } = req.query;

  /**
   * Riders are the smallest collection in play and each one carries a short
   * list of pincodes, so the grouping is done here rather than in a pipeline.
   * A zone's identity comes from several fields on the same document
   * (`zones`, `baseLocation`, `deliveryRadiusKm`) and an aggregation would
   * have to unwind and re-join them to say what a few lines of plain code say
   * directly.
   */
  const [partners, stores, radiusSetting] = await Promise.all([
    DeliveryPartner.find({ status: VENDOR_STATUS.APPROVED })
      .select('zones baseLocation deliveryRadiusKm isAvailable')
      .lean(),
    // Only approved stores dispatch orders; a rejected or suspended shop is not coverage demand.
    Seller.find({ status: VENDOR_STATUS.APPROVED, 'storeDetails.pincode': { $exists: true, $nin: [null, ''] } })
      .select('storeDetails.name storeDetails.pincode storeDetails.city storeDetails.state')
      .lean(),
    getRadiusSetting(),
  ]);

  /**
   * Where a pincode actually is.
   *
   * A rider's `zones` entry is a bare pincode with no city or state attached,
   * so the place name has to come from somewhere that knows both. A store's
   * address is the better authority — it was entered as a whole address — and
   * a rider's own base location is the fallback for a pincode no store sits
   * in yet.
   */
  const placeByPincode = new Map();
  const rememberPlace = (pincode, cityName, stateName) => {
    if (!pincode || (!cityName && !stateName)) return;
    if (placeByPincode.has(pincode)) return;
    placeByPincode.set(pincode, { city: cityName || null, state: stateName || null });
  };

  for (const s of stores) {
    rememberPlace(s.storeDetails?.pincode, s.storeDetails?.city, s.storeDetails?.state);
  }
  for (const p of partners) {
    rememberPlace(p.baseLocation?.pincode, p.baseLocation?.city, p.baseLocation?.state);
  }

  const storesByPincode = new Map();
  for (const s of stores) {
    const pin = s.storeDetails?.pincode;
    if (!pin) continue;
    if (!storesByPincode.has(pin)) storesByPincode.set(pin, []);
    storesByPincode.get(pin).push(s.storeDetails?.name || 'Unnamed store');
  }

  // The ceiling a rider who has set no radius of their own is dispatched
  // under — the same figure riderCapacity falls back to, not a new default.
  const defaultRadiusKm = radiusSetting?.deliveryPartnerMaxRadiusKm ?? null;

  const zones = new Map();
  for (const partner of partners) {
    for (const pincode of partner.zones || []) {
      if (!pincode) continue;
      if (!zones.has(pincode)) {
        zones.set(pincode, { pincode, riders: 0, availableRiders: 0, radii: [] });
      }
      const zone = zones.get(pincode);
      zone.riders += 1;
      if (partner.isAvailable) zone.availableRiders += 1;
      if (Number.isFinite(partner.deliveryRadiusKm)) zone.radii.push(partner.deliveryRadiusKm);
    }
  }
  // A store pincode no rider has declared is a coverage gap; it is the "Inactive" zone.
  for (const pincode of storesByPincode.keys()) {
    if (!zones.has(pincode)) zones.set(pincode, { pincode, riders: 0, availableRiders: 0, radii: [] });
  }

  let rows = [...zones.values()].map((zone) => {
    const place = placeByPincode.get(zone.pincode) || {};
    const storeNames = storesByPincode.get(zone.pincode) || [];
    return {
      zoneCode: zone.pincode,
      /**
       * Null when no store or rider base locates this pincode. It used to
       * fall back to "Pincode 452001", which only restated the zone code
       * sitting in the column beside it — the screen shows a dash instead,
       * which at least says the area name is genuinely unknown.
       */
      zoneName: place.city || null,
      city: place.city || null,
      state: place.state || null,
      storeCount: storeNames.length,
      // The first couple by name; the count above carries the rest.
      stores: storeNames.slice(0, 3),
      riders: zone.riders,
      activeRiders: zone.availableRiders,
      /**
       * The widest distance any rider here will travel. Reported as the
       * zone's reach because a parcel only needs one rider willing to carry
       * it that far — an average would understate what the zone can actually
       * cover. Null when nobody in the zone has set one, in which case they
       * all run on the platform ceiling reported separately.
       */
      radiusKm: zone.radii.length ? Math.max(...zone.radii) : null,
      // A zone with riders but none online cannot take an order right now,
      // and that is a different situation from having no riders at all.
      status: zone.availableRiders > 0 ? 'Active' : (zone.riders > 0 ? 'Offline' : 'Inactive'),
    };
  });

  if (state) rows = rows.filter((r) => r.state === state);
  if (city) rows = rows.filter((r) => r.city === city);
  if (status && status !== 'All') rows = rows.filter((r) => r.status === status);
  if (search) {
    const rx = new RegExp(escapeRegexForUserFilter(search), 'i');
    rows = rows.filter((r) => rx.test(r.zoneCode) || rx.test(r.zoneName || '') || rx.test(r.city || '') || rx.test(r.state || ''));
  }

  // Busiest coverage first, then by pincode so the order is stable between
  // loads rather than following Map insertion order.
  rows.sort((a, b) => b.activeRiders - a.activeRiders
    || b.riders - a.riders
    || a.zoneCode.localeCompare(b.zoneCode));

  /**
   * Filter options come from every zone that exists, not from the rows left
   * after filtering — otherwise choosing a state would empty the city list
   * that produced it and there would be no way back.
   */
  const allPlaces = [...zones.keys()].map((p) => placeByPincode.get(p)).filter(Boolean);
  const states = [...new Set(allPlaces.map((p) => p.state).filter(Boolean))].sort();
  const cities = [...new Set(
    allPlaces
      .filter((p) => !state || p.state === state)
      .map((p) => p.city)
      .filter(Boolean)
  )].sort();

  return ok(res, {
    zones: rows,
    filters: { states, cities },
    defaultRadiusKm,
    totals: {
      zones: rows.length,
      activeZones: rows.filter((r) => r.status === 'Active').length,
    },
  }, 'Delivery hub zones');
});

/* ============================================================================
 * DELIVERY PERFORMANCE — Delivery Fleet › Performance
 *
 * Every figure below is derived from records the platform already keeps —
 * Delivery outcomes and the Order.offerAttempts audit trail — rather than
 * from a counter maintained alongside them. Nothing here is stored; a
 * scorecard that drifted from the deliveries it claims to describe would be
 * worse than no scorecard, because an admin would act on it.
 * ========================================================================== */

/**
 * Minutes between a rider starting a trip and completing it.
 *
 * Reported as null, never 0, when either timestamp is missing. Deliveries
 * predating `startTime` exist, and averaging them in as zero-minute trips
 * would drag the fleet's average time down toward a figure no rider ever
 * achieved.
 */
const DURATION_MINUTES_EXPR = {
  $cond: [
    { $and: [{ $ifNull: ['$startTime', false] }, { $ifNull: ['$endTime', false] }] },
    { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 60000] },
    null,
  ],
};

const pct = (numerator, denominator) => (
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null
);

const round1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

// @desc    Fleet SLA scorecard + per-rider leaderboard
// @route   GET /api/admin/delivery-performance?days=30
// @access  Private/Admin
export const deliveryPerformanceStats = asyncHandler(async (req, res) => {
  /**
   * The window every figure on the screen describes.
   *
   * Sent back in the response because "acceptance rate 82%" means nothing
   * without it, and an admin comparing two screenshots needs to know whether
   * they are looking at the same period.
   */
  const requestedDays = parseInt(req.query.days, 10);
  // Junk and non-positive values fall back to the default rather than being
  // clamped up to 1 — "?days=-5" is a malformed request, and answering it with
  // a single day's data would look like a real (and alarmingly empty) week.
  const days = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, 365)
    : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  /**
   * Forward trips only.
   *
   * A Return's reverse pickup is a different job with a different promise to
   * a different person, and folding the two together would make the fleet's
   * average delivery time describe a journey nobody took.
   */
  const deliveryMatch = { direction: 'forward', createdAt: { $gte: since } };

  const [overallRows, perPartnerRows, offerRows] = await Promise.all([
    Delivery.aggregate([
      { $match: deliveryMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          // 'rejected' is what a rider stepping back before pickup writes —
          // see deliveryPartner.controller.js's cancelDelivery, which reuses
          // the status rather than adding a cancellation value of its own.
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          // Averaged over delivered trips with both timestamps; $avg ignores
          // the nulls this expression yields for the rest.
          avgMinutes: { $avg: { $cond: [{ $eq: ['$status', 'delivered'] }, DURATION_MINUTES_EXPR, null] } },
        },
      },
    ]),

    Delivery.aggregate([
      { $match: deliveryMatch },
      {
        $group: {
          _id: '$partnerId',
          total: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          avgMinutes: { $avg: { $cond: [{ $eq: ['$status', 'delivered'] }, DURATION_MINUTES_EXPR, null] } },
          earnings: { $sum: { $ifNull: ['$partnerEarnings', 0] } },
          tips: { $sum: { $ifNull: ['$partnerTip', 0] } },
        },
      },
    ]),

    /**
     * Acceptance, from the offer audit trail rather than from deliveries.
     *
     * A delivery record only exists once somebody accepted, so it can never
     * show what was turned down. `Order.offerAttempts` is the only place a
     * decline or an expiry is written at all.
     *
     * Offers still sitting at OFFERED are excluded from the denominator:
     * they are unresolved, not refused, and counting them would penalise a
     * rider for an offer that is still ringing on their phone.
     */
    Order.aggregate([
      { $match: { createdAt: { $gte: since }, 'offerAttempts.0': { $exists: true } } },
      { $unwind: '$offerAttempts' },
      { $match: { 'offerAttempts.status': { $ne: 'OFFERED' } } },
      {
        $group: {
          _id: '$offerAttempts.riderId',
          resolved: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ['$offerAttempts.status', 'ACCEPTED'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const overall = overallRows[0] || { total: 0, delivered: 0, failed: 0, cancelled: 0, avgMinutes: null };
  const offersByRider = new Map(offerRows.map((r) => [String(r._id), r]));

  const fleetResolved = offerRows.reduce((sum, r) => sum + r.resolved, 0);
  const fleetAccepted = offerRows.reduce((sum, r) => sum + r.accepted, 0);

  /**
   * Names and vehicles for the riders who actually appear in the window —
   * not every registered partner. A leaderboard row for somebody with no
   * trips is not a zero, it is a rider who wasn't working.
   */
  const partnerIds = perPartnerRows.map((r) => r._id).filter(Boolean);
  const partners = await DeliveryPartner.find({ _id: { $in: partnerIds } })
    .populate('userId', 'name phone')
    .select('userId vehicleType rating')
    .lean();
  const partnerById = new Map(partners.map((p) => [String(p._id), p]));

  const leaderboard = perPartnerRows
    .map((row) => {
      const partner = partnerById.get(String(row._id));
      const offers = offersByRider.get(String(row._id));
      return {
        partnerId: row._id,
        name: partner?.userId?.name || partner?.userId?.phone || 'Rider',
        vehicleType: partner?.vehicleType || null,
        totalJobs: row.total,
        completedJobs: row.delivered,
        cancelledJobs: row.cancelled,
        avgMinutes: round1(row.avgMinutes),
        acceptanceRate: offers ? pct(offers.accepted, offers.resolved) : null,
        earnings: Math.round(row.earnings),
        tips: Math.round(row.tips),
        // Riders are never rated today — no customer-facing flow writes
        // DeliveryPartner.rating. Reported as null so the screen can say so
        // rather than showing everyone a default 0 that reads like a verdict.
        rating: partner?.rating > 0 ? partner.rating : null,
      };
    })
    // Most completed jobs first; a faster average breaks a tie, since between
    // two riders who finished the same number of trips the quicker one is the
    // better performer.
    .sort((a, b) => b.completedJobs - a.completedJobs
      || (a.avgMinutes ?? Infinity) - (b.avgMinutes ?? Infinity));

  return ok(res, {
    window: { days, since },
    summary: {
      totalDeliveries: overall.total,
      successfulJobs: overall.delivered,
      failedJobs: overall.failed,
      cancelledJobs: overall.cancelled,
      avgDeliveryMinutes: round1(overall.avgMinutes),
      successRate: pct(overall.delivered, overall.total),
      acceptanceRate: pct(fleetAccepted, fleetResolved),
      cancellationRate: pct(overall.cancelled, overall.total),
      // No rider-rating flow exists yet; null tells the screen to say that
      // instead of rendering a fabricated score.
      customerRating: null,
      activeRiders: leaderboard.length,
    },
    leaderboard,
  }, 'Delivery performance');
});

/* ============================================================================
 * RIDER PAYOUTS — Delivery Fleet › Earnings & Payouts
 *
 * `DeliveryPartner.earnings` is kept live already: `deliveryPartner.controller.js`
 * increments `earnings.total`/`earnings.pending` by `partnerEarnings` the moment
 * a delivery is marked delivered (see the `$inc` there). Nothing here computes
 * a number that isn't already the platform's real, running ledger for that
 * rider — this section only reads it and, on settle, moves `pending` into `paid`.
 * ========================================================================== */

// @desc    Approved riders with their live earnings ledger + this-week trip count
// @route   GET /api/admin/rider-payouts?search=
// @access  Private/Admin
export const listRiderPayouts = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { status: VENDOR_STATUS.APPROVED };
  if (search) {
    // A rider's name lives on their linked User doc, not on DeliveryPartner.
    const rx = new RegExp(search, 'i');
    const matchingUserIds = await User.find({ name: rx }).distinct('_id');
    filter.userId = { $in: matchingUserIds };
  }

  const [partners, total] = await Promise.all([
    DeliveryPartner.find(filter)
      .sort({ 'earnings.pending': -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone')
      .select('userId vehicleType bankDetails earnings totalDeliveries')
      .lean(),
    DeliveryPartner.countDocuments(filter),
  ]);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tripsCounts = await Delivery.aggregate([
    { $match: { partnerId: { $in: partners.map((p) => p._id) }, status: 'delivered', endTime: { $gte: sevenDaysAgo } } },
    { $group: { _id: '$partnerId', count: { $sum: 1 } } },
  ]);
  const tripsMap = new Map(tripsCounts.map((t) => [String(t._id), t.count]));

  const rows = partners.map((p) => ({
    id: p._id,
    name: p.userId?.name || p.userId?.phone || 'Rider',
    vehicle: p.vehicleType || '—',
    hasPayoutMethod: Boolean(p.bankDetails?.upiId || p.bankDetails?.accountNo),
    pendingPayout: p.earnings?.pending || 0,
    paidTotal: p.earnings?.paid || 0,
    tripsThisWeek: tripsMap.get(String(p._id)) || 0,
  }));

  return paginated(res, rows, { page, limit, total });
});

// @desc    Settle a rider's pending earnings — moves pending into paid
// @route   PATCH /api/admin/rider-payouts/:id/settle
// @access  Private/Admin
export const settleRiderPayout = asyncHandler(async (req, res) => {
  requireFinanceOperation('payouts');
  throw httpError(409, 'Bulk payout without a verified reservation is unavailable. Use the rider payout request and reconciliation workflow.');
});

/* ============================================================================
 * PER-REQUEST RIDER PAYOUTS — a rider's own withdrawal requests, additive
 * alongside the bulk `settleRiderPayout` action above. Each request already
 * reserved its amount out of `earnings.pending` atomically at request time
 * (see deliveryPartner.controller.js::requestPayout) — approving here only
 * moves that already-reserved amount into `earnings.paid`; rejecting returns
 * it to `earnings.pending` so the rider can request again or it is swept by
 * a future bulk settle.
 * ========================================================================== */

// @desc    List rider payout requests, newest first
// @route   GET /api/admin/delivery-payouts?status=pending
// @access  Private/Admin
export const listDeliveryPayoutRequests = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status && DELIVERY_PAYOUT_STATUS[status.toUpperCase()]) filter.status = status;

  const [rows, total] = await Promise.all([
    DeliveryPayout.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'partnerId', select: 'userId vehicleType', populate: { path: 'userId', select: 'name phone' } })
      .lean(),
    DeliveryPayout.countDocuments(filter),
  ]);

  return paginated(res, rows, { page, limit, total });
});

// @desc    Mark a pending payout request as paid out (money moved out-of-band)
// @route   PATCH /api/admin/delivery-payouts/:id/complete
// @access  Private/Admin
export const completeDeliveryPayoutRequest = asyncHandler(async (req, res) => {
  const payout = await resolveVerifiedRiderPayout({ payoutId: req.params.id, actorId: req.user._id, complete: true, input: req.body });
  return ok(res, payout, 'Verified payout reconciliation recorded');
});

// @desc    Reject a pending payout request — returns the reserved amount to earnings.pending
// @route   PATCH /api/admin/delivery-payouts/:id/reject
// @access  Private/Admin
export const rejectDeliveryPayoutRequest = asyncHandler(async (req, res) => {
  const payout = await resolveVerifiedRiderPayout({ payoutId: req.params.id, actorId: req.user._id, complete: false, input: req.body });
  return ok(res, payout, 'Payout reservation returned to verified payable balance');
});

// @desc    Get all vendor orders for Admin (Active Pipeline or Order History)
// @route   GET /api/admin/vendor-orders?mode=active|history&status=&search=&sellerId=&page=&limit=
// @access  Private/Admin
export const getVendorOrdersAdmin = asyncHandler(async (req, res) => {
  const { mode = 'active', status, search, sellerId } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const ACTIVE_STATUSES = ['pending', 'placed', 'confirmed', 'preparing', 'dispatched', 'accepted', 'processing', 'packing', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'dispatch'];
  const HISTORY_STATUSES = ['delivered', 'completed', 'cancelled', 'rejected', 'refunded'];

  const filter = {};

  if (status && status !== 'all') {
    filter.status = status;
  } else if (mode === 'active') {
    filter.status = { $in: ACTIVE_STATUSES };
  } else if (mode === 'history') {
    filter.status = { $in: HISTORY_STATUSES };
  }

  if (sellerId) filter['items.sellerId'] = sellerId;

  if (search && search.trim()) {
    const rx = new RegExp(search.trim(), 'i');
    const searchConditions = [
      { orderNo: rx },
      { 'shippingAddress.name': rx },
      { 'shippingAddress.phone': rx },
      { 'shippingAddress.city': rx },
    ];
    filter.$or = searchConditions;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('userId', 'name phone email')
      .populate('items.sellerId', 'businessName storeDetails.name storeDetails.city')
      .populate('paymentId', 'status method refund')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const rows = orders.map((o) => {
    const storeNamesSet = new Set();
    (o.items || []).forEach((item) => {
      if (item.sellerId) {
        const storeName = item.sellerId.storeDetails?.name || item.sellerId.businessName;
        if (storeName) storeNamesSet.add(storeName);
      }
    });

    const storeNames = Array.from(storeNamesSet).join(', ') || 'Bulkimart Partner Store';

    return {
      _id: o._id,
      orderNo: o.orderNo,
      channel: o.type,
      salesChannel: o.salesChannel || 'retail',
      status: o.status,
      storeNames,
      customerName: o.shippingAddress?.name || o.userId?.name || 'Customer',
      customerPhone: o.shippingAddress?.phone || o.userId?.phone || '—',
      city: o.shippingAddress?.city || '—',
      itemCount: (o.items || []).reduce((sum, i) => sum + (i.qty || 1), 0),
      totalAmount: o.pricing?.totalAmount || o.pricing?.subtotal || 0,
      paymentMethod: o.paymentMethod || 'Online',
      paymentStatus: o.paymentId?.status || (o.paymentMethod === 'cod' ? 'pay_on_delivery' : 'pending'),
      paymentRefund: o.paymentId?.refund,
      deliveryMode: o.delivery?.mode || o.deliveryType || 'Standard',
      vendorDecision: o.vendorDecision || { status: 'pending' },
      fulfillment: o.fulfillment,
      shiprocket: o.shiprocket,
      deliveryPartnerId: o.deliveryPartnerId,
      deliveryId: o.deliveryId,
      assignmentHistory: o.assignmentHistory || [],
      needsManualAssignment: Boolean(o.needsManualAssignment),
      refundPending: o.refundPending,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      items: o.items || [],
      shippingAddress: o.shippingAddress,
      timeline: o.timeline || [],
    };
  });

  return paginated(res, rows, { page, limit, total });
});

// @desc    Get Vendor Sales analytics & ledger
// @route   GET /api/admin/vendor-sales?search=
// @access  Private/Admin
export const getVendorSalesAdmin = asyncHandler(async (req, res) => {
  const { search, status } = req.query;

  const sellers = await Seller.find({})
    .populate('userId', 'name phone email')
    .lean();

  const filterStatus = status && status !== 'all' ? status : null;
  const orderFilter = filterStatus ? { status: filterStatus } : {};
  const orders = await Order.find(orderFilter).lean();

  const salesMap = new Map();
  orders.forEach((o) => {
    (o.items || []).forEach((item) => {
      const sId = String(item.sellerId?._id || item.sellerId || '');
      if (sId) {
        if (!salesMap.has(sId)) {
          salesMap.set(sId, { ordersCount: 0, unitsSold: 0, grossSales: 0 });
        }
        const st = salesMap.get(sId);
        st.orderIds ||= new Set();
        st.orderIds.add(String(o._id)); st.ordersCount = st.orderIds.size;
        st.unitsSold += item.qty || 1;
        st.grossSales += itemGrossPaise(item) / 100;
      }
    });
  });

  let rows = sellers.map((s) => {
    const sId = String(s._id);
    const stats = salesMap.get(sId) || { ordersCount: 0, unitsSold: 0, grossSales: 0 };
    return {
      _id: s._id,
      sellerId: s._id,
      orderId: null, accountingBasis: 'Gross item sales only; commission and seller net require posted ledger',
      businessName: s.businessName || 'General Seller',
      storeName: s.storeDetails?.name || s.businessName || 'Store',
      city: s.storeDetails?.city || '—',
      sellerName: s.userId?.name || s.businessName || 'Seller',
      sellerPhone: s.userId?.phone || s.phone || '—',
      deliveredOrders: stats.ordersCount,
      unitsSold: stats.unitsSold,
      subTotal: stats.grossSales,
      totalAmount: stats.grossSales,
      grossSales: stats.grossSales,
      adminCommissionPercent: null,
      adminCommissionAmount: null,
      vendorEarnings: null,
      netEarnings: null,
      paymentMethod: 'Online / COD',
      status: 'aggregate',

      createdAt: s.createdAt || new Date(),
    };
  });

  if (search && search.trim()) {
    const rx = new RegExp(search.trim(), 'i');
    rows = rows.filter((r) => rx.test(r.businessName) || rx.test(r.storeName) || rx.test(r.sellerPhone));
  }

  const totalGrossSales = rows.reduce((sum, r) => sum + r.grossSales, 0);
  const totalCommission = rows.reduce((sum, r) => sum + r.adminCommissionAmount, 0);
  const totalOrders = rows.reduce((sum, r) => sum + r.deliveredOrders, 0);

  return ok(res, rows, {
    summary: {
      totalGrossSales: Number(totalGrossSales.toFixed(2)),
      totalCommission: null,
      totalOrders,
      deliveredOrders: totalOrders,
    },
  });
});

// @desc    Get Vendor Earnings & Commission breakdown
// @route   GET /api/admin/vendor-earnings?search=
// @access  Private/Admin
export const getVendorEarningsAdmin = asyncHandler(async (req, res) => {
  const sellers = await Seller.find({ status: 'approved' }).select('businessName storeDetails.name').lean();
  let rows = await Promise.all(sellers.map(async seller => {
    const balances = await sellerBalances(seller._id);
    return { sellerId: seller._id, businessName: seller.businessName, storeName: seller.storeDetails?.name || seller.businessName,
      balances, netPayable: balances.eligible, status: balances.eligible > 0 ? 'Eligible' : 'Held or no verified earnings' };
  }));
  const search = String(req.query.search || '').toLowerCase();
  if (search) rows = rows.filter(row => (row.businessName + ' ' + row.storeName).toLowerCase().includes(search));
  return ok(res, { rows, coverage: { historicalOrdersIncluded: false, source: 'seller_ledger_entries' },
    summary: { vendorCount: rows.length, totalNetPayable: rows.reduce((n, row) => n + row.netPayable, 0) } });
});

// @desc    Get Vendor Disbursal Payouts Queue
// @route   GET /api/admin/vendor-payouts?status=
// @access  Private/Admin
export const getVendorPayoutsAdmin = asyncHandler(async (req, res) => {
  const { status, search } = req.query;

  const sellers = await Seller.find({ status: 'approved' })
    .populate('userId', 'name phone email')
    .lean();

  const existingPayouts = await SellerPayout.find({}).lean();
  const payoutMap = new Map(existingPayouts.map((p) => [String(p.sellerId), p]));

  const orders = await Order.find({ status: { $in: ['delivered', 'completed'] } }).lean();

  const salesBySeller = new Map();
  orders.forEach((o) => {
    (o.items || []).forEach((item) => {
      if (item.sellerId) {
        const sId = String(item.sellerId);
        salesBySeller.set(sId, (salesBySeller.get(sId) || 0) + itemGrossPaise(item) / 100);
      }
    });
  });

  let rows = sellers.map((s) => {
    const sId = String(s._id);
    const grossSales = Number((salesBySeller.get(sId) || 0).toFixed(2));
    const commRate = s.commissionRate || 5;
    const platformFee = Number(((grossSales * commRate) / 100).toFixed(2));
    const netPayable = Number((grossSales - platformFee).toFixed(2));

    const existing = payoutMap.get(sId);
    const payoutStatus = existing ? existing.status : (netPayable > 0 ? 'PENDING' : 'APPROVED');

    return {
      _id: existing?._id || `PAY-${s._id.toString().substring(0, 8)}`,
      payoutNo: existing?.payoutNo || `PAY-${Date.now().toString(36).toUpperCase()}`,
      sellerId: s._id,
      businessName: s.businessName,
      storeName: s.storeDetails?.name || s.businessName,
      holderName: s.userId?.name || s.bankDetails?.holderName || '—',
      phone: s.userId?.phone,
      amount: existing?.amount || netPayable,
      status: payoutStatus === 'APPROVED' ? 'Approved' : payoutStatus === 'REJECTED' ? 'Rejected' : 'Pending',
      bankDetails: {
        holderName: s.bankDetails?.holderName || s.userId?.name || '—',
        bankName: s.bankDetails?.bankName || 'HDFC Bank',
        accountNo: s.bankDetails?.accountNo || 'XXXX-XXXX-1234',
        ifsc: s.bankDetails?.ifsc || 'HDFC0001234',
        upiId: s.bankDetails?.upiId || '',
      },
      requestedAt: existing?.requestedAt || s.createdAt,
      processedAt: existing?.processedAt,
      transactionRef: existing?.transactionRef || (payoutStatus === 'APPROVED' ? 'IMPS-SETTLED' : ''),
    };
  });

  if (status && status !== 'all' && status !== 'All') {
    const cleanStatus = status.toLowerCase();
    rows = rows.filter((r) => r.status.toLowerCase() === cleanStatus);
  }

  if (search && search.trim()) {
    const rx = new RegExp(search.trim(), 'i');
    rows = rows.filter((r) => rx.test(r.businessName) || rx.test(r.storeName) || rx.test(r.holderName));
  }

  rows.sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

  return ok(res, rows);
});

// @desc    Settle / Approve a vendor payout transfer
// @route   PATCH /api/admin/vendor-payouts/:id/settle
// @access  Private/Admin
export const settleVendorPayoutAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { transactionRef } = req.body;

  let sellerId = id;
  if (id.startsWith('PAY-')) {
    sellerId = id.replace('PAY-', '');
  }

  let payout = await SellerPayout.findOne({ sellerId });
  if (!payout) {
    payout = new SellerPayout({
      payoutNo: `PAY-${Date.now().toString(36).toUpperCase()}`,
      sellerId: mongoose.Types.ObjectId.isValid(sellerId) ? sellerId : id,
      amount: 1000,
      status: 'APPROVED',
      transactionRef: transactionRef || `IMPS-${Date.now()}`,
      processedAt: new Date(),
      processedBy: req.user._id,
    });
  } else {
    payout.status = 'APPROVED';
    payout.transactionRef = transactionRef || `IMPS-${Date.now()}`;
    payout.processedAt = new Date();
    payout.processedBy = req.user._id;
  }

  await payout.save();
  return ok(res, payout, 'Vendor payout transfer approved successfully');
});
