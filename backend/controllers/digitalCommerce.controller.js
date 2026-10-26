import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import CheckoutAttempt from '../models/CheckoutAttempt.js';
import DigitalDownloadAudit from '../models/DigitalDownloadAudit.js';
import DigitalEntitlement from '../models/DigitalEntitlement.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { applyCouponCode, redeemCoupon } from '../services/coupon.service.js';
import { openStoredEbook } from '../services/ebookStorage.service.js';
import { mutateInventory, isUnlimitedDigital } from '../services/inventory.service.js';
import { httpError, created, ok } from '../utils/response.js';

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const publicOrder = (order) => {
  const value = order?.toObject ? order.toObject() : { ...order };
  value.items = (value.items || []).map(({ digitalFile: _privateFile, ...item }) => item);
  return value;
};
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const checkoutIdentity = async (req) => {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw httpError(400, 'A valid Idempotency-Key header is required');
  }
  const requestHash = createHash('sha256').update(`digital\n${canonicalJson(req.body || {})}`).digest('hex');
  const previous = await CheckoutAttempt.findOne({ userId: req.user._id, key }).lean();
  if (!previous) return { key, requestHash };
  if (previous.operation !== 'digital' || previous.requestHash !== requestHash) throw httpError(409, 'This checkout key was already used for different checkout details');
  if (previous.status !== 'completed') throw httpError(409, 'This checkout is still being processed. Please retry shortly.');
  const order = await Order.findById(previous.orderIds?.[0]);
  if (!order || String(order.userId) !== String(req.user._id)) throw httpError(409, 'The previous checkout result is unavailable');
  return { key, requestHash, replay: { order, previous } };
};

// Digital-only checkout has no address, delivery, COD or shipping mutations; it
// only takes stock for e-books whose seller set a copy limit.
export const createDigitalOrder = asyncHandler(async (req, res) => {
  const identity = await checkoutIdentity(req);
  if (identity.replay) {
    return created(res, { order: publicOrder(identity.replay.order), payment: { id: identity.replay.previous.paymentId, method: 'online', amount: identity.replay.previous.amount } }, 'Digital order restored');
  }

  if (req.body.paymentMethod && req.body.paymentMethod !== 'online') throw httpError(400, 'E-books can only be purchased using Razorpay');
  const cart = await Cart.findOne({ userId: req.user._id, channel: 'ecommerce' });
  if (!cart?.items?.length) throw httpError(400, 'Your Shop All cart is empty');

  const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) } }).select('+digital.file.fileId');
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const kinds = new Set(products.map((product) => product.fulfillmentType));
  if (kinds.size !== 1 || !kinds.has('digital') || products.length !== cart.items.length) {
    throw httpError(409, 'Digital and physical items require separate checkout. Keep only e-books in this cart to continue.');
  }

  const sellerIds = [...new Set(products.map((product) => String(product.sellerId)))];
  const activeSellerCount = await Seller.countDocuments({ _id: { $in: sellerIds }, status: 'approved', isActive: { $ne: false } });
  if (activeSellerCount !== sellerIds.length) throw httpError(409, 'One or more e-books are no longer available');

  const lines = cart.items.map((line) => {
    const product = byId.get(String(line.productId));
    const file = product?.digital?.file;
    if (!product || product.isDeleted || !product.isActive || product.status !== 'approved' || file?.status !== 'uploaded') {
      throw httpError(409, `"${line.name}" is no longer available`);
    }
    const variant = product.variants?.find((entry) => !line.variantId || String(entry._id) === String(line.variantId));
    if (!variant || Number(variant.price) <= 0) throw httpError(409, `"${product.name}" has invalid pricing`);
    if (!isUnlimitedDigital(product) && !(Number(variant.stock) >= 1)) throw httpError(409, `"${product.name}" is sold out`);
    return {
      productId: product._id,
      variantId: variant._id,
      sku: variant.sku,
      variantName: variant.name,
      name: product.name,
      image: product.images?.[0] || '',
      qty: 1,
      price: Number(variant.price),
      sellerId: product.sellerId,
      categoryId: product.category,
      type: product.type,
      fulfillmentType: 'digital',
      digitalSnapshot: {
        author: product.digital.author,
        language: product.digital.language,
        licenseTerms: product.digital.licenseTerms,
        format: 'pdf',
      },
      digitalFile: { fileId: file.fileId, sha256: file.sha256, sizeBytes: file.sizeBytes, status: 'uploaded' },
      ...(isUnlimitedDigital(product) ? {} : { stockReserved: true }),
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.price, 0));
  let applied = null;
  if (req.body.coupon) {
    applied = await applyCouponCode(req.body.coupon, { items: lines, subtotal, user: req.user, deliveryCharge: 0 });
    if (!applied.ok) throw httpError(400, applied.reason);
  }
  const couponDiscount = applied?.ok ? round2(Math.min(applied.discount || 0, subtotal)) : 0;
  const totalAmount = round2(Math.max(0, subtotal - couponDiscount));
  if (totalAmount <= 0) throw httpError(400, 'This checkout has no payable Razorpay amount');

  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      await CheckoutAttempt.create([{ userId: req.user._id, key: identity.key, requestHash: identity.requestHash, operation: 'digital', status: 'processing' }], { session });
      // A limited e-book gives up one copy per sale; the conditional update
      // refuses the last copy to a second concurrent buyer.
      for (const line of lines) {
        if (line.stockReserved) await mutateInventory({ productId: line.productId, variantId: line.variantId, quantity: 1, session });
      }
      const [payment] = await Payment.create([{ userId: req.user._id, amount: totalAmount, method: 'online', status: 'pending' }], { session });
      [order] = await Order.create([{
        userId: req.user._id,
        type: 'ecommerce',
        items: lines,
        pricing: { discountRepresentation: 'components-v1', subtotal, discount: 0, couponDiscount, couponCode: applied?.coupon?.code, deliveryCharge: 0, totalAmount },
        coupon: applied?.coupon?._id,
        paymentMethod: 'online',
        paymentId: payment._id,
        status: 'placed',
        timeline: [{ status: 'placed', timestamp: new Date(), note: 'Digital order placed; payment pending' }],
      }], { session });
      payment.orderId = order._id;
      await payment.save({ session });
      if (applied?.ok) await redeemCoupon({ coupon: applied.coupon, userId: req.user._id, orderId: order._id, discountAmount: couponDiscount, orderTotal: totalAmount }, session);
      await Cart.updateOne({ _id: cart._id }, { $set: { items: [] } }, { session });
      await CheckoutAttempt.updateOne(
        { userId: req.user._id, key: identity.key },
        { $set: { status: 'completed', orderIds: [order._id], paymentId: payment._id, paymentMethod: 'online', amount: totalAmount, nextStep: 'Complete Razorpay payment to activate downloads.' } },
        { session },
      );
    });
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'This digital checkout is already being processed');
    if (/Transaction numbers are only allowed|replica set|does not support transactions/i.test(error?.message || '')) {
      throw httpError(503, 'Digital checkout requires database transaction support. Please retry later.');
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return created(res, { order: publicOrder(order), payment: { id: order.paymentId, method: 'online', amount: totalAmount } }, `Digital order ${order.orderNo} placed`);
});

export const getDigitalLibrary = asyncHandler(async (req, res) => {
  const entitlements = await DigitalEntitlement.find({ userId: req.user._id })
    .populate('productId', 'name images digital.author digital.language digital.licenseTerms isDeleted')
    .populate('orderId', 'orderNo status createdAt')
    .populate('paymentId', 'status paidAt gateway.provider gateway.paymentId')
    .sort({ createdAt: -1 })
    .lean();
  return ok(res, entitlements.map((entry) => ({
    id: entry._id,
    status: entry.status,
    activatedAt: entry.activatedAt,
    lastDownloadedAt: entry.lastDownloadedAt,
    downloadCount: entry.downloadCount,
    product: entry.productId,
    order: entry.orderId,
    payment: entry.paymentId,
    downloadAvailable: entry.status === 'active' && entry.paymentId?.status === 'paid',
  })), 'Digital library');
});

export const downloadDigitalBook = asyncHandler(async (req, res) => {
  const entitlement = await DigitalEntitlement.findOne({ _id: req.params.entitlementId, userId: req.user._id }).select('+fileId');
  if (!entitlement) throw httpError(404, 'E-book not found in your library');
  if (entitlement.status !== 'active') throw httpError(403, 'This download is not currently available');
  const payment = await Payment.findById(entitlement.paymentId).select('status');
  const order = await Order.findOne({ _id: entitlement.orderId, userId: req.user._id, 'items.productId': entitlement.productId }).select('status orderNo');
  if (!payment || payment.status !== 'paid' || !order || order.status === 'cancelled' || order.status === 'refunded') {
    throw httpError(403, 'A verified eligible purchase is required');
  }
  const product = await Product.findById(entitlement.productId).select('name');
  const opened = await openStoredEbook({ fileId: entitlement.fileId, sha256: entitlement.fileSha256, sizeBytes: entitlement.fileSizeBytes });
  await Promise.all([
    DigitalEntitlement.updateOne({ _id: entitlement._id }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } }),
    DigitalDownloadAudit.create({ entitlementId: entitlement._id, userId: req.user._id, orderId: entitlement.orderId, productId: entitlement.productId, ip: req.ip, userAgent: req.get('user-agent') }),
  ]);
  const safeName = String(product?.name || 'ebook').replace(/[^a-z0-9 _.-]/gi, '').trim() || 'ebook';
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(opened.sizeBytes),
    'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  opened.stream.on('error', () => { if (!res.headersSent) res.status(503).end(); else res.destroy(); });
  opened.stream.pipe(res);
});
