import mongoose from 'mongoose';
import Return from '../models/Return.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Delivery from '../models/Delivery.js';
import { distanceKm } from '../utils/geo.js';
import { httpError } from '../utils/response.js';
import { riderPayout, rateSnapshotFor, payoutModeOf } from './riderPay.service.js';
import { canTakeAnother } from './riderCapacity.service.js';
import { notifyUser, notifySeller, notifyRider, notifyAllAdmins, NOTIFICATION_EVENT } from './notification.service.js';
import {
  OFFER_ATTEMPT_STATUS, RETURN_STATUS, RETURN_PICKUP_STATUS, PAYOUT_MODE,
} from '../constants/enums.js';

/**
 * QUICK COMMERCE ONLY — the reverse pickup (customer -> rider -> seller)
 * that carries an approved Return back from the customer. Deliberately
 * mirrors deliveryPartner.controller.js's forward-order ping/accept/decline/
 * OTP pattern as closely as possible — same atomic-claim-via-arrayFilters
 * discipline, same `Delivery` model, same socket/notification plumbing —
 * rather than inventing a second rider-assignment architecture.
 *
 * `Return.status` (RETURN_REQUESTED..REFUNDED) is never touched here. This
 * file only moves `Return.pickup` and the linked `Delivery` document.
 * Admin's existing `transitionReturnStatus` remains the only way
 * RETURN_RECEIVED is ever reached (services/return.service.js, unchanged).
 */

const emit = async (kind, id, event, payload) => {
  try {
    const rooms = await import('../socket/rooms.js');
    const fn = { user: rooms.emitToUser, seller: rooms.emitToSeller, rider: rooms.emitToRider, admin: rooms.emitToAdmins }[kind];
    if (kind === 'admin') fn(event, payload); else fn(id, event, payload);
  } catch { /* best-effort, same discipline as the forward flow */ }
};

/* ============================================================================
 * BROADCAST — offer the pickup to nearby available riders
 * ========================================================================== */

const PICKUP_MAX_ATTEMPTS = 3;

/**
 * @param {string} returnId
 * @param {number} attempt  1..PICKUP_MAX_ATTEMPTS — widens the search radius
 *   each retry, same convention as broadcastNewOrderToRiders.
 */
export const broadcastReturnPickupToRiders = async (returnId, attempt = 1) => {
  const ret = await Return.findById(returnId);
  if (!ret) return;
  if (![RETURN_STATUS.APPROVED, RETURN_STATUS.AWAITING_RETURN].includes(ret.status)) return;
  if (ret.pickup?.status !== RETURN_PICKUP_STATUS.NOT_ASSIGNED) return; // already assigned/cancelled since this attempt was scheduled

  const order = await Order.findById(ret.orderId).select('shippingAddress userId').lean();
  const seller = await Seller.findById(ret.sellerId).select('storeDetails businessName').lean();
  if (!order?.shippingAddress?.lat || !seller?.storeDetails) return; // nothing to route from/to

  const pickupPoint = { lat: order.shippingAddress.lat, lng: order.shippingAddress.lng };
  const baseRadius = Number(process.env.PICKUP_RADIUS_METERS) || 5000;
  const radiusMeters = baseRadius * attempt;

  let riders = [];
  try {
    riders = await DeliveryPartner.find({
      status: 'approved',
      isAvailable: true,
      'baseLocation.point': {
        $near: { $geometry: { type: 'Point', coordinates: [pickupPoint.lng, pickupPoint.lat] }, $maxDistance: radiusMeters },
      },
    }).limit(5);
  } catch (e) {
    console.warn('[RETURN PICKUP] geo search failed:', e.message);
  }

  riders = riders.filter((r) => {
    if (r.deliveryRadiusKm === undefined || r.deliveryRadiusKm === null) return true;
    const riderLoc = (r.currentLocation?.lat !== undefined) ? r.currentLocation : r.baseLocation;
    const km = distanceKm(riderLoc, pickupPoint);
    return km === undefined || km <= r.deliveryRadiusKm;
  });

  /**
   * A rider already at RIDER_MAX_CONCURRENT_DELIVERIES (forward orders +
   * return pickups combined — riderCapacity.service.js) should never even
   * see this offer, not just be blocked at accept time. Accept-time
   * capacity re-check (acceptReturnPickup) remains the actual enforcement
   * against a race; this is purely to stop a rider from being pinged for
   * work they cannot legally take.
   */
  const capacityChecks = await Promise.all(riders.map((r) => canTakeAnother(r._id)));
  riders = riders.filter((_, i) => capacityChecks[i].ok);

  if (riders.length === 0) {
    if (attempt < PICKUP_MAX_ATTEMPTS) {
      setTimeout(() => { broadcastReturnPickupToRiders(returnId, attempt + 1).catch(() => {}); }, 30_000);
      return;
    }
    if (ret.sellerId) {
      notifySeller(ret.sellerId, {
        event: NOTIFICATION_EVENT.RETURN_PICKUP_NO_RIDER,
        title: 'No rider found for return pickup',
        message: `No delivery partner was found nearby for return ${ret.returnNumber}. You can try again from Returns.`,
        metadata: { returnId: ret._id }, route: '/seller/returns',
      }).catch(() => {});
    }
    return;
  }

  const payload = {
    returnId: String(ret._id),
    returnNumber: ret.returnNumber,
    productName: ret.productName,
    productImage: ret.productImage,
    quantity: ret.quantity,
    pickupAddress: order.shippingAddress,
    dropAddress: seller.storeDetails,
    sellerName: seller.businessName || seller.storeDetails?.name,
  };

  for (const r of riders) {
    const existing = (ret.pickup.offerAttempts || []).find((o) => String(o.riderId) === String(r._id));
    if (existing && existing.status !== OFFER_ATTEMPT_STATUS.OFFERED) continue; // already declined/expired for this rider — don't re-ring them

    const result = existing
      ? await Return.updateOne({ _id: ret._id, 'pickup.offerAttempts.riderId': r._id }, { $set: { 'pickup.offerAttempts.$.offeredAt': new Date() } })
      : await Return.updateOne({ _id: ret._id }, { $push: { 'pickup.offerAttempts': { riderId: r._id, status: OFFER_ATTEMPT_STATUS.OFFERED } } });

    const km = distanceKm(r.baseLocation, pickupPoint);
    await emit('rider', r._id, 'return_pickup_ping', { ...payload, pickupDistanceKm: km });
    if (result.modifiedCount) {
      notifyRider(r._id, {
        event: NOTIFICATION_EVENT.RETURN_PICKUP_OFFERED,
        title: 'New return pickup request',
        message: `Pick up ${ret.productName} (${ret.quantity}) from a customer and return it to the seller.`,
        metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: '/delivery/returns',
      }).catch(() => {});
    }
  }
};

/* ============================================================================
 * ACCEPT / DECLINE / EXPIRE — same atomic-claim discipline as forward orders
 * ========================================================================== */

/** Seller-triggered entry point — validates ownership/status, then broadcasts. */
export const arrangeReturnPickup = async ({ returnId, sellerId }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.sellerId) !== String(sellerId)) throw httpError(403, 'Not authorized for this return');
  if (![RETURN_STATUS.APPROVED, RETURN_STATUS.AWAITING_RETURN].includes(ret.status)) {
    throw httpError(400, 'This return is not ready for pickup yet', { code: 'RETURN_NOT_APPROVED' });
  }
  if (ret.pickup.status !== RETURN_PICKUP_STATUS.NOT_ASSIGNED) {
    throw httpError(400, `This return's pickup is already ${ret.pickup.status.toLowerCase()}`, { code: 'PICKUP_ALREADY_ASSIGNED' });
  }

  broadcastReturnPickupToRiders(String(ret._id), 1).catch((e) => console.warn('[RETURN PICKUP] broadcast failed:', e.message));
  return ret;
};

export const acceptReturnPickup = async ({ returnId, partnerId }) => {
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw httpError(400, 'Invalid return id');

  const cap = await canTakeAnother(partnerId);
  if (!cap.ok) throw httpError(409, cap.reason, { code: 'CAPACITY_EXCEEDED' });

  const claimed = await Return.findOneAndUpdate(
    {
      _id: returnId,
      'pickup.status': RETURN_PICKUP_STATUS.NOT_ASSIGNED,
      'pickup.partnerId': { $exists: false },
      $nor: [{ 'pickup.offerAttempts': { $elemMatch: { riderId: partnerId, status: { $ne: OFFER_ATTEMPT_STATUS.OFFERED } } } }],
    },
    {
      $set: {
        'pickup.partnerId': partnerId,
        'pickup.status': RETURN_PICKUP_STATUS.ASSIGNED,
        'pickup.offerAttempts.$[o].status': OFFER_ATTEMPT_STATUS.ACCEPTED,
        'pickup.offerAttempts.$[o].respondedAt': new Date(),
      },
    },
    { new: true, arrayFilters: [{ 'o.riderId': partnerId }] }
  );

  if (!claimed) {
    const fresh = await Return.findById(returnId).lean();
    if (!fresh) throw httpError(404, 'Return not found');
    if (fresh.pickup?.partnerId) throw httpError(409, 'This pickup has already been taken by another rider', { code: 'ALREADY_ASSIGNED' });
    throw httpError(409, 'This offer is no longer available', { code: 'OFFER_NOT_AVAILABLE' });
  }

  const order = await Order.findById(claimed.orderId).select('shippingAddress userId').lean();
  const seller = await Seller.findById(claimed.sellerId).select('storeDetails businessName').lean();
  const km = distanceKm(order?.shippingAddress, seller?.storeDetails);

  const delivery = await Delivery.create({
    returnId: claimed._id,
    partnerId,
    direction: 'return_pickup',
    pickupLocation: { address: [order?.shippingAddress?.line1, order?.shippingAddress?.city].filter(Boolean).join(', '), lat: order?.shippingAddress?.lat, lng: order?.shippingAddress?.lng },
    dropLocation: { address: seller?.storeDetails?.address || seller?.storeDetails?.name, lat: seller?.storeDetails?.lat, lng: seller?.storeDetails?.lng },
    route: { distanceKm: km },
    status: 'accepted',
    ratesUsed: rateSnapshotFor(PAYOUT_MODE.QUICK),
    partnerLocation: { lat: order?.shippingAddress?.lat, lng: order?.shippingAddress?.lng, updatedAt: new Date() },
  });

  claimed.pickup.deliveryId = delivery._id;
  await claimed.save();

  if (claimed.sellerId) {
    notifySeller(claimed.sellerId, {
      event: NOTIFICATION_EVENT.RETURN_PICKUP_ASSIGNED, title: 'Rider assigned for return pickup',
      message: `A rider accepted the pickup for return ${claimed.returnNumber}.`,
      metadata: { returnId: claimed._id }, route: '/seller/returns',
    }).catch(() => {});
  }
  notifyUser(claimed.customerId, {
    event: NOTIFICATION_EVENT.RETURN_PICKUP_ASSIGNED, title: 'Pickup scheduled',
    message: `A delivery partner will collect ${claimed.productName} for return ${claimed.returnNumber}.`,
    metadata: { returnId: claimed._id }, route: `/orders/${claimed.orderId}`,
  }).catch(() => {});
  emit('seller', claimed.sellerId, 'return_pickup_assigned', { returnId: String(claimed._id) });
  emit('user', claimed.customerId, 'return_pickup_assigned', { returnId: String(claimed._id) });

  return { ret: claimed, delivery };
};

export const declineReturnPickup = async ({ returnId, partnerId, reason }) => {
  const now = new Date();
  const result = await Return.findOneAndUpdate(
    { _id: returnId, 'pickup.offerAttempts': { $elemMatch: { riderId: partnerId, status: OFFER_ATTEMPT_STATUS.OFFERED } } },
    { $set: { 'pickup.offerAttempts.$[o].status': OFFER_ATTEMPT_STATUS.DECLINED_BY_RIDER, 'pickup.offerAttempts.$[o].respondedAt': now, 'pickup.offerAttempts.$[o].reason': reason } },
    { new: true, arrayFilters: [{ 'o.riderId': partnerId, 'o.status': OFFER_ATTEMPT_STATUS.OFFERED }] }
  );
  if (!result) {
    const fresh = await Return.findById(returnId).lean();
    if (!fresh) throw httpError(404, 'Return not found');
    if (String(fresh.pickup?.partnerId) === String(partnerId)) throw httpError(400, 'You have already accepted this pickup');
    return fresh; // idempotent on a duplicate decline / an offer already resolved
  }
  return result;
};

export const expireReturnPickupOffer = async ({ returnId, partnerId }) => {
  const now = new Date();
  const result = await Return.findOneAndUpdate(
    { _id: returnId, 'pickup.offerAttempts': { $elemMatch: { riderId: partnerId, status: OFFER_ATTEMPT_STATUS.OFFERED } } },
    { $set: { 'pickup.offerAttempts.$[o].status': OFFER_ATTEMPT_STATUS.OFFER_EXPIRED, 'pickup.offerAttempts.$[o].expiredAt': now } },
    { new: true, arrayFilters: [{ 'o.riderId': partnerId, 'o.status': OFFER_ATTEMPT_STATUS.OFFERED }] }
  );
  return result || await Return.findById(returnId); // idempotent, same shape as declineReturnPickup
};

/* ============================================================================
 * PICKUP OTP — customer hands the item to the rider
 * ========================================================================== */

const genOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

export const generateReturnPickupOtp = async ({ returnId, partnerId }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
  if (!ret.pickup.deliveryId) throw httpError(400, 'No pickup trip on record');

  const otp = genOtp();
  await Delivery.updateOne({ _id: ret.pickup.deliveryId }, { $set: { otp, otpVerified: false, otpAttempts: 0, otpIssuedAt: new Date() } });

  emit('user', ret.customerId, 'return_pickup_otp_ready', { returnId: String(ret._id), otp });
  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.RETURN_PICKUP_OTP_READY, title: 'Rider has arrived',
    message: `Your pickup code for returning ${ret.productName} is ${otp}. Share this code with the rider.`,
    metadata: { returnId: ret._id, otp }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});

  return { sent: true };
};

const OTP_MAX_ATTEMPTS = 5;

export const verifyReturnPickupOtp = async ({ returnId, partnerId, otp }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
  if (!ret.pickup.deliveryId) throw httpError(400, 'No pickup trip on record');

  const delivery = await Delivery.findById(ret.pickup.deliveryId);
  if (!delivery) throw httpError(404, 'Pickup trip not found');
  if (delivery.otpAttempts >= OTP_MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts — ask the customer to regenerate the code');
  if (!delivery.otp) throw httpError(400, 'No pickup code has been generated yet');

  if (String(otp) !== String(delivery.otp)) {
    delivery.otpAttempts += 1;
    await delivery.save();
    throw httpError(400, `Incorrect code (${OTP_MAX_ATTEMPTS - delivery.otpAttempts} attempt(s) left)`, { code: 'WRONG_OTP' });
  }

  delivery.otpVerified = true;
  delivery.status = 'picked_up';
  await delivery.save();

  ret.pickup.status = RETURN_PICKUP_STATUS.PICKED_UP;
  ret.pickedUpAt = new Date();
  await ret.save();

  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.RETURN_PICKED_UP, title: 'Item picked up',
    message: `Your return ${ret.returnNumber} has been picked up and is on its way back to the seller.`,
    metadata: { returnId: ret._id }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});
  if (ret.sellerId) {
    notifySeller(ret.sellerId, {
      event: NOTIFICATION_EVENT.RETURN_PICKED_UP, title: 'Return picked up',
      message: `The rider picked up ${ret.productName} for return ${ret.returnNumber} and is on the way.`,
      metadata: { returnId: ret._id }, route: '/seller/returns',
    }).catch(() => {});
  }

  return { ret, delivery };
};

/* ============================================================================
 * LOCATION + STAGE (optional, live tracking — reuses Delivery's own fields)
 * ========================================================================== */

export const updateReturnPickupLocation = async ({ returnId, partnerId, lat, lng }) => {
  const ret = await Return.findById(returnId).select('pickup').lean();
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup?.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
  await Delivery.updateOne({ _id: ret.pickup.deliveryId }, { $set: { partnerLocation: { lat, lng, updatedAt: new Date() } } });
  return { ok: true };
};

/** Rider-self-service stage marks — never the final seller-receipt step (Section 16/23). */
export const updateReturnPickupStage = async ({ returnId, partnerId, status }) => {
  const allowed = ['arrived_at_store', 'in_transit', 'arrived_at_customer'];
  if (!allowed.includes(status)) throw httpError(400, `status must be one of: ${allowed.join(', ')}`);

  const ret = await Return.findById(returnId).select('pickup sellerId returnNumber').lean();
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup?.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');

  const delivery = await Delivery.findOneAndUpdate({ _id: ret.pickup.deliveryId }, { $set: { status } }, { new: true });
  if (ret.sellerId) {
    emit('seller', ret.sellerId, 'return_pickup_stage', { returnId: String(ret._id), status });
  }
  return delivery;
};

/* ============================================================================
 * SELLER RECEIPT — the physical handover, never a Rider- or Customer-only claim
 * ========================================================================== */

/**
 * Only the SELLER may confirm they physically received the returned item —
 * this deliberately does NOT touch `Return.status`; Admin's existing
 * `transitionReturnStatus` (AWAITING_RETURN -> RETURN_RECEIVED) remains the
 * one place restock/refund eligibility is actually decided (Section 16/26).
 * This just closes out the reverse `Delivery` trip and tells Admin the item
 * is physically back, ready for that review.
 */
export const markReturnDeliveredToSeller = async ({ returnId, sellerId }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.sellerId) !== String(sellerId)) throw httpError(403, 'Not authorized for this return');
  if (ret.pickup.status !== RETURN_PICKUP_STATUS.PICKED_UP) {
    throw httpError(400, 'This return has not been picked up from the customer yet', { code: 'NOT_PICKED_UP' });
  }

  const delivery = await Delivery.findById(ret.pickup.deliveryId);
  if (delivery && delivery.status !== 'delivered') {
    delivery.status = 'delivered';
    delivery.endTime = new Date();
    delivery.partnerEarnings = riderPayout(delivery.route?.distanceKm, { mode: payoutModeOf({ type: 'grocery' }), rates: delivery.ratesUsed }).total;
    await delivery.save();

    await DeliveryPartner.updateOne(
      { _id: delivery.partnerId },
      { $set: { isAvailable: true }, $inc: { totalDeliveries: 1, 'earnings.total': delivery.partnerEarnings, 'earnings.pending': delivery.partnerEarnings } }
    );
  }

  ret.pickup.status = RETURN_PICKUP_STATUS.DELIVERED_TO_SELLER;
  ret.pickup.sellerConfirmedReceivedAt = new Date();
  await ret.save();

  notifyAllAdmins({
    event: NOTIFICATION_EVENT.RETURN_DELIVERED_TO_SELLER, title: 'Return back with seller',
    message: `${ret.returnNumber} — ${ret.productName} is back with the seller and ready for QC/restock review.`,
    metadata: { returnId: ret._id }, route: `/admin/returns/${ret._id}`,
  }).catch(() => {});
  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.RETURN_DELIVERED_TO_SELLER, title: 'Return delivered',
    message: `Your returned item for ${ret.returnNumber} has reached the seller.`,
    metadata: { returnId: ret._id }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});

  return ret;
};
