import mongoose from 'mongoose';
import PackagingMaterial from '../models/PackagingMaterial.js';
import PackagingPackage from '../models/PackagingPackage.js';
import PackagingOrder from '../models/PackagingOrder.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError, paginated, getPagination } from '../utils/response.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { resolvePackagingItems, pricePackage, BULK_ORDER_MIN_TOTAL_ITEMS } from '../services/packaging.service.js';
import { notifySeller, notifyAllAdmins, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { PAYMENT_STATUS } from '../constants/enums.js';
import {
  createPayment, getOrderStatus, rupeesToPaise, isConfigured,
} from '../services/phonepe.service.js';

/**
 * NHCONE Branded Packaging Material System — V1.
 *
 * Reuses the existing PhonePe integration (services/phonepe.service.js),
 * the shared Payment model (see Payment.js's `packagingOrderId`), the
 * existing Cloudinary upload pipeline, the existing centralized
 * notification service, and the existing seller/admin auth middleware —
 * exactly the discipline sellerPromotion.controller.js already follows for
 * its own "Admin catalog -> seller purchase -> PhonePe -> confirmed" flow.
 *
 * V1 stops at a confirmed packaging order. No Shiprocket, no physical
 * warehouse stock — see the file comments on PackagingOrder.js and this
 * feature's final report for the exact boundary.
 */

// ============================================================================
// ADMIN — PACKAGING MATERIALS
// ============================================================================

// @desc    List packaging materials (admin)
// @route   GET /api/admin/packaging/materials?status=active|inactive
// @access  Private/Admin
export const listPackagingMaterialsAdmin = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const filter = {};
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (search) filter.name = new RegExp(search, 'i');

  const materials = await PackagingMaterial.find(filter).sort({ createdAt: -1 });
  return ok(res, materials);
});

// @desc    Create a packaging material
// @route   POST /api/admin/packaging/materials
// @access  Private/Admin
export const createPackagingMaterial = asyncHandler(async (req, res) => {
  const { name, materialType, specification, unitPrice, description } = req.body;

  if (!name || !String(name).trim()) throw httpError(400, 'Material name is required');
  if (!materialType || !String(materialType).trim()) throw httpError(400, 'Material type is required');
  const price = Number(unitPrice);
  if (!Number.isFinite(price) || price < 0) throw httpError(400, 'A valid, non-negative unit price is required');

  let image;
  if (req.file) image = await uploadToCloudinary(req.file.buffer, 'packaging-materials');

  const material = await PackagingMaterial.create({
    name: String(name).trim(),
    materialType: String(materialType).trim(),
    specification: specification ? String(specification).trim() : undefined,
    unitPrice: price,
    description,
    image,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  return created(res, material, 'Packaging material created');
});

// @desc    Edit a packaging material
// @route   PATCH /api/admin/packaging/materials/:id
// @access  Private/Admin
export const updatePackagingMaterial = asyncHandler(async (req, res) => {
  const material = await PackagingMaterial.findById(req.params.id);
  if (!material) throw httpError(404, 'Packaging material not found');

  const { name, materialType, specification, unitPrice, description } = req.body;

  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, 'Material name cannot be empty');
    material.name = String(name).trim();
  }
  if (materialType !== undefined) {
    if (!String(materialType).trim()) throw httpError(400, 'Material type cannot be empty');
    material.materialType = String(materialType).trim();
  }
  if (specification !== undefined) material.specification = String(specification).trim();
  if (description !== undefined) material.description = description;
  if (unitPrice !== undefined) {
    const price = Number(unitPrice);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, 'A valid, non-negative unit price is required');
    material.unitPrice = price;
  }
  if (req.file) material.image = await uploadToCloudinary(req.file.buffer, 'packaging-materials');

  material.updatedBy = req.user._id;
  await material.save();

  return ok(res, material, 'Packaging material updated');
});

// @desc    Activate / deactivate a packaging material
// @route   PATCH /api/admin/packaging/materials/:id/status
// @access  Private/Admin
export const setPackagingMaterialStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') throw httpError(400, 'isActive (boolean) is required');

  const material = await PackagingMaterial.findById(req.params.id);
  if (!material) throw httpError(404, 'Packaging material not found');

  material.isActive = isActive;
  material.updatedBy = req.user._id;
  await material.save();

  return ok(res, material, isActive ? 'Material activated' : 'Material deactivated');
});

// ============================================================================
// ADMIN — PACKAGING PACKAGES
// ============================================================================

/** Validates + resolves package `items` input shared by create/update. Never publishes with an inactive/invalid material. */
const validatePackageItems = async (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw httpError(400, 'A package needs at least one packaging material');
  }
  const seen = new Set();
  const cleanItems = [];
  for (const raw of rawItems) {
    const materialId = String(raw?.materialId || '');
    const quantity = Number(raw?.quantity);
    if (!mongoose.Types.ObjectId.isValid(materialId)) throw httpError(400, 'Invalid material reference');
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, 'Every material quantity must be a whole number greater than zero');
    }
    if (seen.has(materialId)) throw httpError(400, 'The same material cannot appear twice in one package');
    seen.add(materialId);
    cleanItems.push({ materialId, quantity });
  }

  const materials = await PackagingMaterial.find({ _id: { $in: cleanItems.map((i) => i.materialId) } });
  const byId = new Map(materials.map((m) => [String(m._id), m]));
  for (const item of cleanItems) {
    const material = byId.get(item.materialId);
    if (!material) throw httpError(400, 'One of the selected materials no longer exists');
    if (!material.isActive) throw httpError(400, `"${material.name}" is inactive and cannot be used in a package`);
  }

  return cleanItems;
};

// @desc    List packaging packages (admin)
// @route   GET /api/admin/packaging/packages?status=DRAFT|PUBLISHED|DISABLED
// @access  Private/Admin
export const listPackagingPackagesAdmin = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status && ['DRAFT', 'PUBLISHED', 'DISABLED'].includes(status)) filter.status = status;

  const packages = await PackagingPackage.find(filter).sort({ createdAt: -1 }).lean();
  const priced = await Promise.all(packages.map(async (p) => {
    const { totalItems, subtotal } = await pricePackage(p);
    return { ...p, totalItems, subtotal };
  }));

  return ok(res, priced);
});

// @desc    Package detail with live pricing (admin)
// @route   GET /api/admin/packaging/packages/:id
// @access  Private/Admin
export const getPackagingPackageAdmin = asyncHandler(async (req, res) => {
  const pkg = await PackagingPackage.findById(req.params.id).lean();
  if (!pkg) throw httpError(404, 'Package not found');
  const { items, totalItems, subtotal } = await pricePackage(pkg);
  return ok(res, { ...pkg, items, totalItems, subtotal });
});

// @desc    Create a package (starts as DRAFT)
// @route   POST /api/admin/packaging/packages
// @access  Private/Admin
export const createPackagingPackage = asyncHandler(async (req, res) => {
  const { name, description, items } = req.body;
  if (!name || !String(name).trim()) throw httpError(400, 'Package name is required');

  const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
  const cleanItems = await validatePackageItems(parsedItems);

  let image;
  if (req.file) image = await uploadToCloudinary(req.file.buffer, 'packaging-packages');

  const pkg = await PackagingPackage.create({
    name: String(name).trim(),
    description,
    image,
    items: cleanItems,
    status: 'DRAFT',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  const { totalItems, subtotal } = await pricePackage(pkg);
  return created(res, { ...pkg.toObject(), totalItems, subtotal }, 'Package created as draft');
});

// @desc    Edit a package (name/description/image/items). Allowed in any lifecycle state — historical orders hold their own snapshot.
// @route   PATCH /api/admin/packaging/packages/:id
// @access  Private/Admin
export const updatePackagingPackage = asyncHandler(async (req, res) => {
  const pkg = await PackagingPackage.findById(req.params.id);
  if (!pkg) throw httpError(404, 'Package not found');

  const { name, description, items } = req.body;
  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, 'Package name cannot be empty');
    pkg.name = String(name).trim();
  }
  if (description !== undefined) pkg.description = description;
  if (items !== undefined) {
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    pkg.items = await validatePackageItems(parsedItems);
  }
  if (req.file) pkg.image = await uploadToCloudinary(req.file.buffer, 'packaging-packages');

  pkg.updatedBy = req.user._id;
  await pkg.save();

  const { totalItems, subtotal } = await pricePackage(pkg);
  return ok(res, { ...pkg.toObject(), totalItems, subtotal }, 'Package updated');
});

// @desc    Publish a DRAFT/DISABLED package — becomes purchasable
// @route   PATCH /api/admin/packaging/packages/:id/publish
// @access  Private/Admin
export const publishPackagingPackage = asyncHandler(async (req, res) => {
  const pkg = await PackagingPackage.findById(req.params.id);
  if (!pkg) throw httpError(404, 'Package not found');
  if (!pkg.items || pkg.items.length === 0) throw httpError(400, 'Cannot publish an empty package');

  // Re-validate every material is still active — one may have been
  // deactivated after this package was last saved.
  await validatePackageItems(pkg.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity })));

  pkg.status = 'PUBLISHED';
  pkg.publishedAt = new Date();
  pkg.updatedBy = req.user._id;
  await pkg.save();

  return ok(res, pkg, 'Package published');
});

// @desc    Disable a package — no new purchases; historical orders unaffected
// @route   PATCH /api/admin/packaging/packages/:id/disable
// @access  Private/Admin
export const disablePackagingPackage = asyncHandler(async (req, res) => {
  const pkg = await PackagingPackage.findById(req.params.id);
  if (!pkg) throw httpError(404, 'Package not found');

  pkg.status = 'DISABLED';
  pkg.updatedBy = req.user._id;
  await pkg.save();

  return ok(res, pkg, 'Package disabled');
});

// ============================================================================
// ADMIN — PACKAGING ORDERS
// ============================================================================

// @desc    List packaging orders (admin) — search/filter by status/seller
// @route   GET /api/admin/packaging/orders?status=&sellerId=
// @access  Private/Admin
export const listPackagingOrdersAdmin = asyncHandler(async (req, res) => {
  const { status, sellerId } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status) filter.orderStatus = status;
  if (sellerId) filter.sellerId = sellerId;

  const [rows, total] = await Promise.all([
    PackagingOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'sellerId', select: 'businessName userId', populate: { path: 'userId', select: 'name phone' } })
      .lean(),
    PackagingOrder.countDocuments(filter),
  ]);

  return paginated(res, rows, { page, limit, total });
});

// @desc    Packaging order detail (admin)
// @route   GET /api/admin/packaging/orders/:id
// @access  Private/Admin
export const getPackagingOrderAdmin = asyncHandler(async (req, res) => {
  const order = await PackagingOrder.findById(req.params.id)
    .populate({ path: 'sellerId', select: 'businessName userId', populate: { path: 'userId', select: 'name phone' } });
  if (!order) throw httpError(404, 'Packaging order not found');
  return ok(res, order);
});

// @desc    Move a CONFIRMED order to PROCESSING, or CANCEL a still-unpaid order
// @route   PATCH /api/admin/packaging/orders/:id/status
// @access  Private/Admin
export const updatePackagingOrderStatusAdmin = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const order = await PackagingOrder.findById(req.params.id);
  if (!order) throw httpError(404, 'Packaging order not found');

  // Only V1-honest transitions — no fake DISPATCHED/DELIVERED (Section 14).
  const allowed = {
    CONFIRMED: ['PROCESSING'],
    PAYMENT_PENDING: ['CANCELLED'],
  };
  if (!allowed[order.orderStatus]?.includes(status)) {
    throw httpError(400, `Cannot move a ${order.orderStatus} order to ${status}`);
  }

  order.orderStatus = status;
  await order.save();

  const seller = await Seller.findById(order.sellerId).select('userId').lean();
  if (seller && status === 'PROCESSING') {
    await notifySeller(seller, {
      event: NOTIFICATION_EVENT.PACKAGING_ORDER_PROCESSING,
      title: 'Your packaging order is being prepared',
      message: `Order ${order.orderNumber} is now being processed.`,
      route: '/seller/packaging/orders',
    });
  }

  return ok(res, order, 'Order status updated');
});

// ============================================================================
// SELLER — BROWSE
// ============================================================================

// @desc    Active packaging materials a seller may choose for a bulk order
// @route   GET /api/sellers/packaging/materials
// @access  Private/Seller (approved)
export const listPackagingMaterialsForSeller = asyncHandler(async (req, res) => {
  const materials = await PackagingMaterial.find({ isActive: true }).sort({ materialType: 1, name: 1 });
  return ok(res, materials);
});

// @desc    Published packaging packages a seller may purchase
// @route   GET /api/sellers/packaging/packages
// @access  Private/Seller (approved)
export const listPackagingPackagesForSeller = asyncHandler(async (req, res) => {
  const packages = await PackagingPackage.find({ status: 'PUBLISHED' }).sort({ createdAt: -1 }).lean();
  const priced = await Promise.all(packages.map(async (p) => {
    const { totalItems, subtotal } = await pricePackage(p);
    return { ...p, totalItems, subtotal };
  }));
  return ok(res, priced);
});

// @desc    One published package's detail with live pricing
// @route   GET /api/sellers/packaging/packages/:id
// @access  Private/Seller (approved)
export const getPackagingPackageForSeller = asyncHandler(async (req, res) => {
  const pkg = await PackagingPackage.findById(req.params.id).lean();
  if (!pkg || pkg.status !== 'PUBLISHED') throw httpError(404, 'Package not found');
  const { items, totalItems, subtotal } = await pricePackage(pkg);
  return ok(res, { ...pkg, items, totalItems, subtotal });
});

// ============================================================================
// SELLER — CREATE ORDER + START PAYMENT
// (one call: create the PAYMENT_PENDING order, then hand back a PhonePe
//  redirect, exactly like sellerPromotion.controller.js's
//  initiatePromotionPayment — except packaging needs no admin approval step
//  first, so order-creation and payment-initiation collapse into one call.)
// ============================================================================

const startPackagingPayment = async ({ order, seller, req }) => {
  if (!isConfigured()) throw httpError(503, 'Online payment is not available right now');

  const payment = await Payment.create({
    userId: req.user._id,
    packagingOrderId: order._id,
    amount: order.payableAmount,
    method: 'online',
    status: PAYMENT_STATUS.PENDING,
  });
  order.paymentId = payment._id;
  await order.save();

  const merchantOrderId = `PKGORD-${order._id}-A1`;
  const base = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
  const redirectUrl = `${base}/api/packaging/payment/return/${merchantOrderId}`;

  const gw = await createPayment({
    merchantOrderId,
    amountPaise: rupeesToPaise(order.payableAmount),
    redirectUrl,
    message: `Bulkimart Packaging Order ${order.orderNumber}`,
  });

  payment.attempts = 1;
  payment.gateway = { provider: 'phonepe', merchantOrderId, orderId: gw.orderId, initiatedAt: new Date() };
  await payment.save();

  await notifyAllAdmins({
    event: NOTIFICATION_EVENT.PACKAGING_ORDER_CREATED,
    title: 'New packaging order',
    message: `${seller.businessName || 'A seller'} started a packaging order (${order.orderNumber}) for ₹${order.payableAmount}.`,
    metadata: { orderId: String(order._id) },
    route: '/admin/packaging/orders',
  });

  return { redirectUrl: gw.redirectUrl, merchantOrderId, expireAt: gw.expireAt, amount: order.payableAmount, order };
};

/** Snapshots the seller's registered store address — read-only, no new UI. */
const shippingSnapshotOf = (seller) => ({
  address: seller.storeDetails?.address,
  city: seller.storeDetails?.city,
  state: seller.storeDetails?.state,
  pincode: seller.storeDetails?.pincode,
});

// @desc    Buy a predefined package (packageQuantity = how many units)
// @route   POST /api/sellers/packaging/orders/package
// @access  Private/Seller (approved)
export const createPackageOrder = asyncHandler(async (req, res) => {
  const { packageId, quantity } = req.body;
  const packageQuantity = Number(quantity) || 1;
  if (!Number.isInteger(packageQuantity) || packageQuantity <= 0) {
    throw httpError(400, 'Package quantity must be a positive whole number');
  }

  const pkg = await PackagingPackage.findById(packageId);
  if (!pkg || pkg.status !== 'PUBLISHED') {
    // Revalidated here even if the seller's screen still shows it — Admin
    // may have disabled it since the page loaded (Section 31).
    throw httpError(400, 'This package is not available for purchase right now');
  }

  // Multiply every material's quantity by the number of package units the
  // seller wants, then resolve through the exact same authoritative pricing
  // path a bulk order uses — never a stored/cached package subtotal.
  const rawItems = pkg.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity * packageQuantity }));
  const { items, totalItems, subtotal } = await resolvePackagingItems(rawItems);

  const seller = req.seller;
  const order = await PackagingOrder.create({
    sellerId: seller._id,
    orderType: 'PACKAGE',
    packageId: pkg._id,
    packageNameSnapshot: pkg.name,
    packageQuantity,
    items,
    totalItems,
    subtotal,
    payableAmount: subtotal,
    shippingAddressSnapshot: shippingSnapshotOf(seller),
    orderStatus: 'PAYMENT_PENDING',
  });

  const result = await startPackagingPayment({ order, seller, req });
  return created(res, result, 'Redirecting to PhonePe');
});

// @desc    Custom bulk packaging order — minimum 500 total items, server-priced
// @route   POST /api/sellers/packaging/orders/bulk
// @access  Private/Seller (approved)
export const createBulkOrder = asyncHandler(async (req, res) => {
  const { items: rawItems } = req.body;
  const parsedItems = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;

  const { items, totalItems, subtotal } = await resolvePackagingItems(parsedItems);

  if (totalItems < BULK_ORDER_MIN_TOTAL_ITEMS) {
    throw httpError(400, `A bulk packaging order needs at least ${BULK_ORDER_MIN_TOTAL_ITEMS} total items (this order has ${totalItems})`);
  }

  const seller = req.seller;
  const order = await PackagingOrder.create({
    sellerId: seller._id,
    orderType: 'BULK',
    items,
    totalItems,
    subtotal,
    payableAmount: subtotal,
    shippingAddressSnapshot: shippingSnapshotOf(seller),
    orderStatus: 'PAYMENT_PENDING',
  });

  const result = await startPackagingPayment({ order, seller, req });
  return created(res, result, 'Redirecting to PhonePe');
});

// ============================================================================
// SELLER — ORDER HISTORY
// ============================================================================

// @desc    This seller's own packaging orders
// @route   GET /api/sellers/packaging/orders
// @access  Private/Seller (approved)
export const listMyPackagingOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [rows, total] = await Promise.all([
    PackagingOrder.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PackagingOrder.countDocuments({ sellerId: req.seller._id }),
  ]);
  return paginated(res, rows, { page, limit, total });
});

// @desc    One of this seller's own packaging orders, in detail
// @route   GET /api/sellers/packaging/orders/:id
// @access  Private/Seller (approved)
export const getMyPackagingOrder = asyncHandler(async (req, res) => {
  const order = await PackagingOrder.findById(req.params.id);
  // 404, not 403, on a mismatch — never confirms another seller's order id exists.
  if (!order || String(order.sellerId) !== String(req.seller._id)) throw httpError(404, 'Packaging order not found');
  return ok(res, order);
});

// ============================================================================
// PAYMENT SETTLEMENT — mirrors settleSellerPromotionPayment exactly
// ============================================================================

/**
 * Moves a PackagingOrder's payment to paid/failed exactly once. Exported so
 * payment.controller.js's shared PhonePe webhook can branch into it, same as
 * settleSellerPromotionPayment/settlePremiumPayment/settleShgSubscriptionPayment.
 */
export const settlePackagingOrderPayment = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  if (payment.status === PAYMENT_STATUS.PAID) return { changed: false, status: 'paid' };

  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };
  let order = null;

  try {
    await session.withTransaction(async () => {
      const freshPayment = await Payment.findById(payment._id).session(session);
      if (!freshPayment || freshPayment.status === PAYMENT_STATUS.PAID) return;

      order = await PackagingOrder.findById(freshPayment.packagingOrderId).session(session);
      if (!order) return;

      if (state === 'COMPLETED') {
        freshPayment.status = PAYMENT_STATUS.PAID;
        freshPayment.paidAt = new Date();
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, paymentDetails };
        await freshPayment.save({ session });

        order.paymentStatus = 'paid';
        order.orderStatus = 'CONFIRMED';
        order.confirmedAt = new Date();
        await order.save({ session });

        result = { changed: true, status: 'paid' };
      } else if (state === 'FAILED') {
        freshPayment.status = PAYMENT_STATUS.FAILED;
        freshPayment.gateway = { ...(freshPayment.gateway || {}), orderId: gatewayOrderId, errorCode };
        await freshPayment.save({ session });

        // Left as PAYMENT_PENDING, not CANCELLED — the seller can retry the
        // same order (same pattern the marketplace `settle()` uses).
        order.paymentStatus = 'failed';
        await order.save({ session });

        result = { changed: true, status: 'failed' };
      }
    });
  } finally {
    await session.endSession();
  }

  if (result.changed && result.status === 'paid' && order) {
    const seller = await Seller.findById(order.sellerId).select('userId').lean();
    if (seller) {
      await notifySeller(seller, {
        event: NOTIFICATION_EVENT.PACKAGING_PAYMENT_CONFIRMED,
        title: 'Packaging order confirmed',
        message: `Payment received — order ${order.orderNumber} is confirmed.`,
        metadata: { orderId: String(order._id) },
        route: '/seller/packaging/orders',
      });
    }
  }

  return result;
};

// @desc    Where PhonePe sends the seller back for a packaging payment
// @route   GET /api/packaging/payment/return/:merchantOrderId
// @access  Public — the real state is re-checked against PhonePe, never trusted from the redirect
export const packagingPaymentReturn = asyncHandler(async (req, res) => {
  const { merchantOrderId } = req.params;
  const payment = await Payment.findOne({ 'gateway.merchantOrderId': merchantOrderId });

  let status = 'unknown';
  if (payment) {
    try {
      const live = await getOrderStatus(merchantOrderId);
      const settled = await settlePackagingOrderPayment({
        payment, state: live.state, gatewayOrderId: live.orderId, paymentDetails: live.paymentDetails,
      });
      status = settled.status;
    } catch {
      status = payment.status;
    }
  }

  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  return res.redirect(`${app}/seller?packagingPayment=${encodeURIComponent(status)}`);
});
