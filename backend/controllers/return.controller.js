import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import Seller from '../models/Seller.js';
import Delivery from '../models/Delivery.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { uploadFileWithMeta } from '../services/cloudinary.service.js';
import {
  getReturnEligibility, createReturnRequest, transitionReturnStatus, calculateReturnRefund,
  processReturnRefund, markCodRefundSettled, sellerDecideReturn,
} from '../services/return.service.js';
import { arrangeReturnPickup, markReturnDeliveredToSeller, returnPickupOptions } from '../services/returnPickup.service.js';
import { bookReturnCourier, reconcileReturnCourier, cancelReturnCourier } from '../services/returnCourier.service.js';
import {
  RETURN_REASONS, RETURN_STATUSES, RETURN_MAX_ATTACHMENTS, RETURN_STATUS,
} from '../constants/enums.js';

/**
 * NHCONE Return & Refund — Phase 4 (item-level core backend). Business
 * logic lives in services/return.service.js; this stays thin. Nothing here
 * touches order.controller.js::requestReturn (the separate, untouched
 * legacy whole-order endpoint) or Order.status.
 */

const uploadAttachments = async (files = []) => {
  if (files.length > RETURN_MAX_ATTACHMENTS) throw httpError(400, `You can attach at most ${RETURN_MAX_ATTACHMENTS} files`);
  const uploaded = [];
  for (const file of files) {
    const meta = await uploadFileWithMeta(file.buffer, 'returns', {
      resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
    });
    uploaded.push({ url: meta.url, publicId: meta.publicId, fileName: file.originalname, mimeType: file.mimetype });
  }
  return uploaded;
};

/**
 * `delivery` is optional — the live, UNVERIFIED pickup OTP for this
 * customer's own return, fetched by the caller only when
 * `pickup.status === 'ASSIGNED'` (Section: OTP fallback). This is safe to
 * return here specifically because it's the CUSTOMER's own code, on their
 * own return, via an endpoint already scoped to `customerId` — unlike the
 * rider-facing side, which never sees this value. It exists so the
 * socket-only `return_pickup_otp_ready` push (real-time) has a fallback for
 * a tab that was disconnected/reconnected when the rider generated it.
 */
const publicReturnShape = (ret, delivery) => ({
  _id: ret._id,
  returnNumber: ret.returnNumber,
  orderId: ret.orderId,
  orderItemId: ret.orderItemId,
  productId: ret.productId,
  variantId: ret.variantId,
  productName: ret.productName,
  productImage: ret.productImage,
  quantity: ret.quantity,
  reason: ret.reason,
  customerDescription: ret.customerDescription,
  attachments: ret.attachments,
  status: ret.status,
  requestedAt: ret.requestedAt,
  returnEligibleUntilSnapshot: ret.returnEligibleUntilSnapshot,
  adminComment: ret.status === RETURN_STATUS.REJECTED ? undefined : ret.adminComment,
  rejectionReason: ret.rejectionReason,
  refundAmount: ret.refundAmount,
  refundStatus: ret.refundStatus,
  refundDestination: ret.refundDestination,
  pickupMethod: ret.pickupMethod,
  reverseBooking: ret.reverseBooking && { state: ret.reverseBooking.state, trackingState: ret.reverseBooking.trackingState, error: ret.reverseBooking.error },
  awbNumber: ret.awbNumber,
  trackingUrl: ret.trackingUrl,
  refundReference: ret.refundStatus === 'completed' ? ret.refundReference : undefined,
  refundedAt: ret.refundedAt,
  restockDecision: ret.restockDecision,
  // Customer-facing timeline — the same audit trail admin sees, never a
  // second/fabricated version of it (Section 6 of the spec).
  history: (ret.history || []).map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, comment: h.comment, timestamp: h.timestamp })),
  // Quick Commerce reverse pickup — where the physical item is right now,
  // separate from `status` above (see models/Return.js's `pickup` comment).
  pickup: ret.pickup && {
    status: ret.pickup.status,
    riderName: ret.pickup.partnerId?.userId?.name,
    otp: (ret.pickup.status === 'ASSIGNED' && delivery && !delivery.otpVerified) ? delivery.otp : undefined,
  },
  pickedUpAt: ret.pickedUpAt,
});

/* ============================================================================
 * CUSTOMER
 * ========================================================================== */

// @desc    Whether/how much of one order item can still be returned
// @route   GET /api/orders/:orderId/items/:itemId/return-eligibility
// @access  Private
export const getOrderItemReturnEligibility = asyncHandler(async (req, res) => {
  try {
    const { item, remaining } = await getReturnEligibility({
      orderId: req.params.orderId, orderItemId: req.params.itemId, customerId: req.user._id, quantity: 1,
    });
    return ok(res, {
      eligible: true,
      returnWindowDays: item.returnPolicy?.returnWindowDays,
      returnEligibleUntil: item.returnEligibleUntil,
      maxReturnableQuantity: remaining,
    });
  } catch (err) {
    // A genuinely bad/foreign order id stays a real error (404); every
    // other reason (not delivered, not returnable, window expired, nothing
    // left to return) is a normal, expected verdict a UI needs to render a
    // message for, not a request failure.
    if (err.meta?.code === 'RETURN_NOT_FOUND') throw err;
    return ok(res, { eligible: false, reason: err.message, code: err.meta?.code });
  }
});

// @desc    Request a return for a specific quantity of one order item
// @route   POST /api/returns
// @access  Private
export const createReturn = asyncHandler(async (req, res) => {
  const { orderId, orderItemId, quantity, reason, customerDescription } = req.body;

  if (!RETURN_REASONS.includes(reason)) {
    throw httpError(400, `reason must be one of: ${RETURN_REASONS.join(', ')}`);
  }
  if (reason === 'OTHER' && !(customerDescription || '').trim()) {
    throw httpError(400, 'Please describe the issue when selecting "Other"');
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw httpError(400, 'Quantity must be a whole number greater than zero');
  }

  const attachments = await uploadAttachments(req.files);

  const ret = await createReturnRequest({
    orderId, orderItemId, customerId: req.user._id, quantity: qty, reason, customerDescription, attachments,
    requestKey: req.get('Idempotency-Key'),
  });

  return created(res, publicReturnShape(ret), `Return ${ret.returnNumber} requested`);
});

// @desc    This customer's own return requests
// @route   GET /api/returns
// @access  Private
export const listMyReturns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { customerId: req.user._id };
  if (req.query.status && RETURN_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  // Lets the order-detail screen ask for "returns on THIS order" directly,
  // instead of paging through everything this customer has ever returned.
  if (req.query.orderId && mongoose.Types.ObjectId.isValid(req.query.orderId)) filter.orderId = req.query.orderId;

  const [rows, total] = await Promise.all([
    Return.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'pickup.partnerId', select: 'userId', populate: { path: 'userId', select: 'name' } })
      .lean(),
    Return.countDocuments(filter),
  ]);

  // Live OTP fallback for the socket-only `return_pickup_otp_ready` push —
  // batched, since a list can hold several ASSIGNED pickups at once.
  const assignedDeliveryIds = rows.filter((r) => r.pickup?.status === 'ASSIGNED' && r.pickup?.deliveryId).map((r) => r.pickup.deliveryId);
  const deliveriesById = assignedDeliveryIds.length
    ? new Map((await Delivery.find({ _id: { $in: assignedDeliveryIds } }).select('otp otpVerified').lean()).map((d) => [String(d._id), d]))
    : new Map();

  return paginated(res, rows.map((r) => publicReturnShape(r, deliveriesById.get(String(r.pickup?.deliveryId)))), { page, limit, total });
});

// @desc    One of this customer's own returns, in detail
// @route   GET /api/returns/:id
// @access  Private
export const getMyReturn = asyncHandler(async (req, res) => {
  const ret = await Return.findById(req.params.id)
    .populate({ path: 'pickup.partnerId', select: 'userId', populate: { path: 'userId', select: 'name' } })
    .lean();
  // 404, not 403, on a mismatch — never confirms another customer's return id exists.
  if (!ret || String(ret.customerId) !== String(req.user._id)) throw httpError(404, 'Return not found');

  // Live OTP fallback — see the batched version's comment above.
  const delivery = (ret.pickup?.status === 'ASSIGNED' && ret.pickup?.deliveryId)
    ? await Delivery.findById(ret.pickup.deliveryId).select('otp otpVerified').lean()
    : null;

  return ok(res, publicReturnShape(ret, delivery));
});

/* ============================================================================
 * SELLER — read-only (Phase 4)
 * ========================================================================== */

// @desc    Returns for products this seller sold — read-only
// @route   GET /api/sellers/returns
// @access  Private/Seller (approved)
// Internal bookkeeping a seller never needs (idempotency keys, provider
// operation tokens, refund locks, rider offer lists).
const SELLER_HIDDEN_FIELDS = '-requestKey -reverseBooking.operationToken -refundLockedAt -pickup.offerAttempts -zeroRefundEvidence';

export const listSellerReturns = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');

  const { page, limit, skip } = getPagination(req.query);
  const filter = { sellerId: seller._id };
  // `status` may be one status or a comma-separated group (the KPI cards
  // filter by group, e.g. REFUND_PENDING,REFUNDED).
  const statuses = String(req.query.status || '').split(',').filter((s) => RETURN_STATUSES.includes(s));
  if (statuses.length) filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };

  const [rows, total, counts] = await Promise.all([
    Return.find(filter).select(SELLER_HIDDEN_FIELDS).sort({ requestedAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'pickup.partnerId', select: 'userId', populate: { path: 'userId', select: 'name phone' } })
      .lean(),
    Return.countDocuments(filter),
    // Unfiltered per-status totals, so the KPI cards stay true whatever
    // filter or page the list is showing.
    Return.aggregate([{ $match: { sellerId: seller._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const statusCounts = Object.fromEntries(counts.map((row) => [row._id, row.count]));
  return paginated(res, rows, { page, limit, total, statusCounts });
});

// @desc    One of this seller's returns, with the order context needed to act on it
// @route   GET /api/sellers/returns/:returnId
// @access  Private/Seller (approved)
export const getSellerReturn = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  if (!mongoose.Types.ObjectId.isValid(req.params.returnId)) throw httpError(400, 'Invalid return id');

  const ret = await Return.findOne({ _id: req.params.returnId, sellerId: seller._id })
    .select(SELLER_HIDDEN_FIELDS)
    .populate('customerId', 'name')
    .populate({ path: 'pickup.requestedRiderId', select: 'userId', populate: { path: 'userId', select: 'name' } })
    .populate({ path: 'pickup.partnerId', select: 'userId vehicleType vehicleNo', populate: { path: 'userId', select: 'name phone' } })
    .populate('pickup.deliveryId', 'status startTime endTime')
    .lean();
  // 404 on a mismatch — never confirms another seller's return id exists.
  if (!ret) throw httpError(404, 'Return not found');

  const order = await Order.findById(ret.orderId).select('orderNo status paymentMethod deliveredAt items shippingAddress').lean();
  const item = order?.items?.find((row) => String(row._id) === String(ret.orderItemId));
  const address = order?.shippingAddress || {};

  return ok(res, {
    ...ret,
    customerName: ret.customerId?.name,
    customerId: undefined,
    order: order && {
      _id: order._id,
      orderNo: order.orderNo,
      status: order.status,
      paymentMethod: order.paymentMethod,
      deliveredAt: item?.deliveredAt || order.deliveredAt,
      item: item && { name: item.name, qty: item.qty, price: item.price, lineTotal: item.price * item.qty },
      // Pickup location only — the full contact stays with the rider/courier.
      pickupAddress: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode },
    },
  });
});

// @desc    Seller approves or rejects a return of their own item
// @route   POST /api/sellers/returns/:returnId/decision  { decision: APPROVED|REJECTED, rejectionReason?, comment? }
// @access  Private/Seller (approved)
export const sellerDecideReturnCtrl = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  if (!mongoose.Types.ObjectId.isValid(req.params.returnId)) throw httpError(400, 'Invalid return id');
  const { decision, rejectionReason, comment } = req.body;
  const ret = await sellerDecideReturn({ returnId: req.params.returnId, sellerId: seller._id, sellerUserId: req.user._id, decision, rejectionReason, comment });
  return ok(res, { returnId: ret._id, status: ret.status }, ret.status === RETURN_STATUS.APPROVED ? 'Return approved — choose a pickup method' : 'Return rejected');
});

/**
 * @desc    Request an eligible delivery partner chosen by the seller.
 *          The response confirms a request, not assignment; pickup.status
 *          becomes ASSIGNED only after that partner accepts.
 * @route   POST /api/sellers/returns/:returnId/assign-rider
 * @access  Private/Seller (approved)
 */
export const assignRiderForReturn = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');

  if (!mongoose.Types.ObjectId.isValid(req.body.riderId)) throw httpError(400, 'Choose a delivery partner');
  const ret = await arrangeReturnPickup({ returnId: req.params.returnId, sellerId: seller._id, riderId: req.body.riderId });
  return ok(res, { returnId: ret._id, pickupStatus: ret.pickup.status }, 'Pickup requested; awaiting delivery partner acceptance');
});

export const getReturnPickupOptions = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller not found');
  return ok(res, await returnPickupOptions({ returnId: req.params.returnId, sellerId: seller._id }));
});

export const selectReturnPickup = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller not found');
  const input = { returnId: req.params.returnId, sellerId: seller._id, riderId: req.body.riderId };
  if (!['MANUAL', 'SHIPROCKET'].includes(req.body.pickupMethod)) throw httpError(400, 'Choose MANUAL or SHIPROCKET');
  if (req.body.pickupMethod === 'MANUAL' && !mongoose.Types.ObjectId.isValid(req.body.riderId)) throw httpError(400, 'Choose a delivery partner');
  const ret = req.body.pickupMethod === 'MANUAL' ? await arrangeReturnPickup(input) : await bookReturnCourier(input);
  return ok(res, ret, req.body.pickupMethod === 'MANUAL' ? 'Pickup requested; awaiting delivery partner acceptance' : 'Shiprocket pickup status recorded');
});
export const refreshReturnCourier = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller not found');
  return ok(res, await reconcileReturnCourier({ returnId: req.params.returnId, sellerId: seller._id }));
});
export const cancelReturnPickup = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller not found');
  const ret = await Return.findOne({ _id: req.params.returnId, sellerId: seller._id });
  if (!ret) throw httpError(404, 'Return not found');
  if (ret.pickupMethod === 'SHIPROCKET') return ok(res, await cancelReturnCourier({ returnId: ret._id, sellerId: seller._id }), 'Cancellation requested; refresh for provider confirmation');
  const changed = await Return.findOneAndUpdate({ _id: ret._id, pickupMethod: 'MANUAL', status: { $in: ['APPROVED', 'AWAITING_RETURN'] }, 'pickup.status': 'NOT_ASSIGNED', 'pickup.partnerId': { $exists: false } }, {
    $set: { 'pickup.status': 'CANCELLED', 'pickup.offerAttempts': [] }, $unset: { pickupMethod: 1, 'pickup.requestedRiderId': 1 }, $push: { history: { toStatus: ret.status, changedByRole: 'seller', comment: 'Unassigned manual pickup cancelled' } },
  }, { returnDocument: 'after' });
  if (!changed) throw httpError(409, 'An assigned or collected pickup cannot be switched');
  return ok(res, changed);
});

/**
 * @desc    Seller confirms they physically received the returned item back
 *          from the rider. Does NOT move Return.status — only Admin's
 *          existing PATCH /api/admin/returns/:id/status (RETURN_RECEIVED)
 *          decides restock/refund eligibility (Section 16 of the spec).
 * @route   POST /api/sellers/returns/:returnId/mark-received
 * @access  Private/Seller (approved)
 */
export const sellerConfirmReturnReceived = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');

  const ret = await markReturnDeliveredToSeller({ returnId: req.params.returnId, sellerId: seller._id });
  return ok(res, { returnId: ret._id, pickupStatus: ret.pickup.status }, 'Marked as received — an admin will review it for restock/refund.');
});

/* ============================================================================
 * ADMIN
 * ========================================================================== */

// @desc    All return requests — searchable/filterable
// @route   GET /api/admin/returns?status=&search=
// @access  Private/Admin
export const listReturnsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, search } = req.query;

  const filter = {};
  if (status && RETURN_STATUSES.includes(status)) filter.status = status;
  if (search) {
    filter.$or = [
      { returnNumber: new RegExp(search, 'i') },
      { productName: new RegExp(search, 'i') },
    ];
  }

  const [rows, total] = await Promise.all([
    Return.find(filter)
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customerId', 'name phone')
      .populate('sellerId', 'businessName')
      .lean(),
    Return.countDocuments(filter),
  ]);

  return paginated(res, rows, { page, limit, total });
});

/**
 * The full admin view of one return: who bought it, who sold it, and the
 * order it came from.
 *
 * Shared by the detail read AND by every endpoint that mutates a return,
 * because they all feed the same admin screen. The mutations used to answer
 * with the bare `Return` document — no populated customer or seller and no
 * order at all — so the moment an admin moved a return to Under Review the
 * panel they were reading redrew with "Customer: — (—)", "Seller: —" and an
 * empty order line. The data was never missing; the response just stopped
 * carrying it. One builder means that cannot drift apart again.
 */
const buildReturnDetail = async (returnId) => {
  const ret = await Return.findById(returnId)
    .populate('customerId', 'name phone email')
    .populate('sellerId', 'businessName storeDetails.name storeDetails.phone')
    .populate({ path: 'pickup.partnerId', select: 'userId vehicleType vehicleNo', populate: { path: 'userId', select: 'name phone' } })
    .populate('pickup.deliveryId')
    .lean();
  if (!ret) throw httpError(404, 'Return not found');

  const order = await Order.findById(ret.orderId)
    .select('orderNo status pricing paymentMethod paymentId deliveredAt items shippingAddress financialSnapshot')
    .populate('paymentId', 'status method amount transactionId')
    .lean();

  // Already-computed/frozen breakdown (once refund processing has started)
  // is shown as-is; otherwise this is a live, non-binding estimate for the
  // admin to preview before starting the refund.
  const refundEstimate = ret.refundBreakdown?.refundAmount != null
    ? ret.refundBreakdown
    : calculateReturnRefund(ret, order);

  return { ...ret, order, refundEstimate };
};

// @desc    One return, in full detail — including its Order for context
// @route   GET /api/admin/returns/:id
// @access  Private/Admin
export const getReturnAdmin = asyncHandler(async (req, res) => {
  return ok(res, await buildReturnDetail(req.params.id));
});

// @desc    Start (or safely retry) this return's real refund
// @route   POST /api/admin/returns/:id/refund
// @access  Private/Admin
export const processReturnRefundAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid return id');
  const ret = await processReturnRefund({ returnId: req.params.id, adminId: req.user._id });
  // Re-read through the shared builder so the panel keeps its customer,
  // seller and order context instead of blanking out after the action.
  return ok(res, await buildReturnDetail(ret._id), `Return ${ret.returnNumber} refund is now ${ret.refundStatus || ret.status}`);
});

// @desc    Read-only compatibility for an already-settled historical COD refund
// @route   POST /api/admin/returns/:id/cod-settle
// @access  Private/Admin
export const codSettleReturnAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid return id');
  const ret = await markCodRefundSettled({ returnId: req.params.id, adminId: req.user._id, note: req.body.note });
  return ok(res, await buildReturnDetail(ret._id), `Return ${ret.returnNumber} marked as manually refunded`);
});

// @desc    Move a return to a validated next status
// @route   PATCH /api/admin/returns/:id/status
// @access  Private/Admin
export const updateReturnStatusAdmin = asyncHandler(async (req, res) => {
  const { status, comment, rejectionReason, restockDecision } = req.body;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid return id');

  const ret = await transitionReturnStatus({
    returnId: req.params.id, toStatus: status, adminId: req.user._id, comment, rejectionReason, restockDecision,
  });

  return ok(res, await buildReturnDetail(ret._id), `Return ${ret.returnNumber} is now ${ret.status}`);
});
