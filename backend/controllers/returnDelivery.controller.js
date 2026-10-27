import Return from '../models/Return.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import {
  acceptReturnPickup, declineReturnPickup, expireReturnPickupOffer,
  generateReturnPickupOtp, verifyReturnPickupOtp,
  updateReturnPickupLocation, updateReturnPickupStage,
} from '../services/returnPickup.service.js';
import { RETURN_PICKUP_STATUS, OFFER_ATTEMPT_STATUS } from '../constants/enums.js';
import { distanceKm } from '../utils/geo.js';

/**
 * QUICK COMMERCE ONLY — rider-facing reverse-pickup endpoints, the
 * counterpart to deliveryPartner.controller.js's forward-order
 * accept/decline/expire/OTP flow. Every action here is scoped to
 * `req.partner` (injected by requireApprovedPartner) — a rider can only
 * act on a pickup already offered to or assigned to THEM (Section 23).
 */

// @desc    Pending offers + this rider's own active/past return pickups
// @route   GET /api/delivery/return-pickups
// @access  Private (approved partner)
export const listReturnPickups = asyncHandler(async (req, res) => {
  const partnerId = req.partner._id;

  const [pending, mine] = await Promise.all([
    Return.find({ pickupMethod: 'MANUAL', status: { $in: ['APPROVED', 'AWAITING_RETURN'] }, $or: [{ 'pickup.requestedRiderId': { $exists: false } }, { 'pickup.requestedRiderId': partnerId }], 'pickup.offerAttempts': { $elemMatch: { riderId: partnerId, status: OFFER_ATTEMPT_STATUS.OFFERED } }, 'pickup.status': RETURN_PICKUP_STATUS.NOT_ASSIGNED })
      .select('returnNumber productName productImage quantity sellerId orderId pickup')
      .populate('orderId', 'shippingAddress')
      .populate('sellerId', 'storeDetails businessName')
      .populate('pickup.deliveryId', 'pickupLocation dropLocation status')
      .lean(),
    Return.find({ 'pickup.partnerId': partnerId, 'pickup.status': { $in: [RETURN_PICKUP_STATUS.ASSIGNED, RETURN_PICKUP_STATUS.PICKED_UP] } })
      .select('returnNumber productName productImage quantity sellerId orderId pickup')
      .populate('orderId', 'shippingAddress')
      .populate('sellerId', 'storeDetails businessName')
      .populate('pickup.deliveryId', 'pickupLocation dropLocation status')
      .lean(),
  ]);

  // Completed pickups this rider delivered back to a seller, newest first, with
  // what the trip earned.
  const history = await Return.find({ 'pickup.partnerId': partnerId, 'pickup.status': RETURN_PICKUP_STATUS.DELIVERED_TO_SELLER })
    .select('returnNumber productName productImage quantity sellerId orderId pickup pickedUpAt updatedAt')
    .sort({ 'pickup.sellerConfirmedReceivedAt': -1, updatedAt: -1 }).limit(30)
    .populate('orderId', 'shippingAddress')
    .populate('sellerId', 'storeDetails businessName')
    .populate('pickup.deliveryId', 'status partnerEarnings endTime route')
    .lean();

  // Distances the rider needs to judge an offer: from where they are to the
  // customer, and from the customer to the seller.
  const riderAt = req.partner.currentLocation?.lat !== undefined ? req.partner.currentLocation : req.partner.baseLocation;
  const withDistances = (row) => {
    const pickupAt = row.orderId?.shippingAddress, dropAt = row.sellerId?.storeDetails;
    const toCustomer = distanceKm(riderAt, pickupAt), toSeller = distanceKm(pickupAt, dropAt);
    return { ...row, pickupDistanceKm: Number.isFinite(toCustomer) ? toCustomer : undefined, routeDistanceKm: Number.isFinite(toSeller) ? toSeller : undefined };
  };

  return ok(res, { pending: pending.map(withDistances), active: mine.map(withDistances), history }, 'Return pickups');
});

// @desc    Accept an offered return pickup
// @route   POST /api/delivery/return-pickups/:id/accept
// @access  Private (approved partner)
export const acceptReturnPickupCtrl = asyncHandler(async (req, res) => {
  const { ret, delivery } = await acceptReturnPickup({ returnId: req.params.id, partnerId: req.partner._id });
  return ok(res, { returnId: ret._id, deliveryId: delivery._id, pickupStatus: ret.pickup.status }, 'Pickup accepted');
});

// @desc    Decline an offered return pickup
// @route   POST /api/delivery/return-pickups/:id/decline
// @access  Private (approved partner)
export const declineReturnPickupCtrl = asyncHandler(async (req, res) => {
  const ret = await declineReturnPickup({ returnId: req.params.id, partnerId: req.partner._id, reason: req.body.reason });
  return ok(res, { returnId: ret._id }, 'Pickup declined');
});

// @desc    Client-driven offer timeout confirmation (same convention as forward orders)
// @route   POST /api/delivery/return-pickups/:id/expire
// @access  Private (approved partner)
export const expireReturnPickupCtrl = asyncHandler(async (req, res) => {
  const ret = await expireReturnPickupOffer({ returnId: req.params.id, partnerId: req.partner._id });
  return ok(res, { returnId: ret._id }, 'Offer expired');
});

// @desc    Send a fresh pickup OTP to the customer
// @route   POST /api/delivery/return-pickups/:id/generate-otp
// @access  Private (approved partner)
export const generateReturnPickupOtpCtrl = asyncHandler(async (req, res) => {
  const result = await generateReturnPickupOtp({ returnId: req.params.id, partnerId: req.partner._id });
  return ok(res, result, 'Pickup code sent to the customer');
});

// @desc    Confirm the customer handed the item over
// @route   POST /api/delivery/return-pickups/:id/verify-otp
// @access  Private (approved partner)
export const verifyReturnPickupOtpCtrl = asyncHandler(async (req, res) => {
  if (!req.body.otp) throw httpError(400, 'otp is required');
  const { ret } = await verifyReturnPickupOtp({ returnId: req.params.id, partnerId: req.partner._id, otp: req.body.otp });
  return ok(res, { returnId: ret._id, pickupStatus: ret.pickup.status }, 'Pickup confirmed');
});

// @desc    Live location ping for an active return pickup
// @route   PUT /api/delivery/return-pickups/:id/location
// @access  Private (approved partner)
export const updateReturnPickupLocationCtrl = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) throw httpError(400, 'lat and lng are required');
  const result = await updateReturnPickupLocation({ returnId: req.params.id, partnerId: req.partner._id, lat: Number(lat), lng: Number(lng) });
  return ok(res, result, 'Location updated');
});

// @desc    Trip-stage marks (arrived at customer / in transit / arrived at seller) —
//          never the final "seller received" step, which only the Seller may confirm.
// @route   PATCH /api/delivery/return-pickups/:id/status
// @access  Private (approved partner)
export const updateReturnPickupStageCtrl = asyncHandler(async (req, res) => {
  const delivery = await updateReturnPickupStage({ returnId: req.params.id, partnerId: req.partner._id, status: req.body.status });
  return ok(res, delivery, 'Status updated');
});
