import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Return from '../models/Return.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Delivery from '../models/Delivery.js';
import { distanceKm } from '../utils/geo.js';
import { httpError } from '../utils/response.js';
import { financialTransaction } from './financeSafety.service.js';
import { postLedgerEntry } from './sellerLedger.service.js';
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
  if (ret.pickupMethod !== 'MANUAL') return;
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
        metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/seller/item-returns?return=${ret._id}`,
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

    const active = { _id: ret._id, pickupMethod: 'MANUAL', status: { $in: [RETURN_STATUS.APPROVED, RETURN_STATUS.AWAITING_RETURN] }, 'pickup.status': RETURN_PICKUP_STATUS.NOT_ASSIGNED };
    const result = existing
      ? await Return.updateOne({ ...active, 'pickup.offerAttempts': { $elemMatch: { riderId: r._id, status: OFFER_ATTEMPT_STATUS.OFFERED } } }, { $set: { 'pickup.offerAttempts.$.offeredAt': new Date() } })
      : await Return.updateOne({ ...active, 'pickup.offerAttempts.riderId': { $ne: r._id } }, { $push: { 'pickup.offerAttempts': { riderId: r._id, status: OFFER_ATTEMPT_STATUS.OFFERED } } });
    if (!result.modifiedCount) continue;

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
  if (![RETURN_PICKUP_STATUS.NOT_ASSIGNED, RETURN_PICKUP_STATUS.CANCELLED].includes(ret.pickup.status)) {
    throw httpError(400, `This return's pickup is already ${ret.pickup.status.toLowerCase()}`, { code: 'PICKUP_ALREADY_ASSIGNED' });
  }
  const order = await Order.findById(ret.orderId).lean();
  const seller = await Seller.findById(sellerId).lean();
  const item = order?.items.find(row => String(row._id) === String(ret.orderItemId));
  if (!item || String(item.sellerId) !== String(sellerId)) throw httpError(403, 'Return item ownership mismatch');
  const city = value => String(value || '').trim().toLowerCase();
  if (!city(order.shippingAddress?.city) || city(order.shippingAddress.city) !== city(seller?.storeDetails?.city)) throw httpError(400, 'Local rider pickup requires customer and seller in the same city; select Shiprocket');
  if (!Number.isFinite(distanceKm(order.shippingAddress, seller?.storeDetails))) throw httpError(400, 'Pickup and seller coordinates are required');
  const claimed = await Return.updateOne({ _id: returnId, status: { $in: [RETURN_STATUS.APPROVED, RETURN_STATUS.AWAITING_RETURN] }, 'pickup.status': { $in: ['NOT_ASSIGNED', 'CANCELLED'] }, 'reverseBooking.state': { $nin: ['creating', 'booked', 'uncertain', 'cancel_pending'] } }, {
    $set: { pickupMethod: 'MANUAL', 'pickup.status': 'NOT_ASSIGNED' }, $push: { history: { toStatus: ret.status, changedByRole: 'seller', comment: 'Seller selected Manual Delivery / Local Rider' } },
  });
  if (!claimed.matchedCount) throw httpError(409, 'Reconcile or cancel the existing courier pickup first');
  ret.pickupMethod = 'MANUAL'; ret.pickup.status = 'NOT_ASSIGNED';
  broadcastReturnPickupToRiders(String(ret._id), 1).catch((e) => console.warn('[RETURN PICKUP] broadcast failed:', e.message));
  return ret;
};

export const acceptReturnPickup = async ({ returnId, partnerId }) => {
  // A parcel reservation and an in-flight reverse acceptance share one rider
  // document as their arbiter. The core capacity, status and earning behavior
  // stays unchanged; reservation protection survives rollout flag changes.
  // No expired claim is automatically taken over.
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw httpError(400, 'Invalid return id');
  const token = crypto.randomUUID();
  const claimedPartner = await DeliveryPartner.findOneAndUpdate({ _id: partnerId, 'parcelReservation.bookingId': { $exists: false }, 'parcelReturnClaim.token': { $exists: false } }, { $set: { parcelReturnClaim: { token, startedAt: new Date() } } }, { returnDocument: 'after' });
  if (!claimedPartner) throw httpError(409, 'Driver is reserved for another task');
  try { return await acceptReturnPickupCore({ returnId, partnerId, token }); }
  finally { await DeliveryPartner.updateOne({ _id: partnerId, 'parcelReturnClaim.token': token }, { $unset: { parcelReturnClaim: 1 } }); }
};

const acceptReturnPickupCore = async ({ returnId, partnerId, token }) => {
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw httpError(400, 'Invalid return id');

  const session = await mongoose.startSession();
  let claimed, delivery;
  try {
    await session.withTransaction(async () => {
      // The durable token excludes forward/manual/parcel claims even if this
      // process crashes. The transactional write also conflicts with claims that
      // began before token acquisition; their retry must observe the token.
      const guard = await DeliveryPartner.updateOne({ _id: partnerId,
        'parcelReturnClaim.token': token, 'parcelReservation.bookingId': { $exists: false },
      }, { $inc: { __v: 1 } }, { session });
      if (!guard.matchedCount) throw httpError(409, 'Driver claim changed; refresh before accepting');
      const cap = await canTakeAnother(partnerId, { session });
      if (!cap.ok) throw httpError(409, cap.reason, { code: 'CAPACITY_EXCEEDED' });

      claimed = await Return.findOneAndUpdate(
        {
          _id: returnId,
          pickupMethod: 'MANUAL',
          status: { $in: [RETURN_STATUS.APPROVED, RETURN_STATUS.AWAITING_RETURN] },
          'pickup.offerAttempts': { $elemMatch: { riderId: partnerId, status: OFFER_ATTEMPT_STATUS.OFFERED } },
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
        { returnDocument: 'after', arrayFilters: [{ 'o.riderId': partnerId }], session }
      );

      if (!claimed) {
        const fresh = await Return.findById(returnId).session(session).lean();
        if (!fresh) throw httpError(404, 'Return not found');
        if (fresh.pickup?.partnerId) throw httpError(409, 'This pickup has already been taken by another rider', { code: 'ALREADY_ASSIGNED' });
        throw httpError(409, 'This offer is no longer available', { code: 'OFFER_NOT_AVAILABLE' });
      }

      const order = await Order.findById(claimed.orderId).select('shippingAddress userId').session(session).lean();
      const seller = await Seller.findById(claimed.sellerId).select('storeDetails businessName').session(session).lean();
      const km = distanceKm(order?.shippingAddress, seller?.storeDetails);

      [delivery] = await Delivery.create([{
        returnId: claimed._id,
        partnerId,
        direction: 'return_pickup',
        pickupLocation: { address: [order?.shippingAddress?.line1, order?.shippingAddress?.city].filter(Boolean).join(', '), lat: order?.shippingAddress?.lat, lng: order?.shippingAddress?.lng },
        dropLocation: { address: seller?.storeDetails?.address || seller?.storeDetails?.name, lat: seller?.storeDetails?.lat, lng: seller?.storeDetails?.lng },
        route: { distanceKm: km },
        status: 'accepted',
        ratesUsed: rateSnapshotFor(PAYOUT_MODE.QUICK),
        partnerLocation: { lat: order?.shippingAddress?.lat, lng: order?.shippingAddress?.lng, updatedAt: new Date() },
      }], { session });

      claimed.pickup.deliveryId = delivery._id;
      await claimed.save({ session });
    });
  } finally { await session.endSession(); }

  if (claimed.sellerId) {
    notifySeller(claimed.sellerId, {
      event: NOTIFICATION_EVENT.RETURN_PICKUP_ASSIGNED, title: 'Rider assigned for return pickup',
      message: `A rider accepted the pickup for return ${claimed.returnNumber}.`,
      metadata: { returnId: claimed._id, returnNumber: claimed.returnNumber }, route: `/seller/item-returns?return=${claimed._id}`,
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
    { returnDocument: 'after', arrayFilters: [{ 'o.riderId': partnerId, 'o.status': OFFER_ATTEMPT_STATUS.OFFERED }] }
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
    { returnDocument: 'after', arrayFilters: [{ 'o.riderId': partnerId, 'o.status': OFFER_ATTEMPT_STATUS.OFFERED }] }
  );
  return result || await Return.findById(returnId); // idempotent, same shape as declineReturnPickup
};

/* ============================================================================
 * PICKUP OTP — customer hands the item to the rider
 * ========================================================================== */

const genOtp = () => crypto.randomInt(1000, 10000).toString();

export const generateReturnPickupOtp = async ({ returnId, partnerId }) => {
  const ret = await Return.findById(returnId);
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
  if (!ret.pickup.deliveryId) throw httpError(400, 'No pickup trip on record');
  if (ret.pickupMethod === 'SHIPROCKET' || ret.pickup.status !== 'ASSIGNED') throw httpError(409, 'Only an assigned manual pickup can request an OTP');

  const otp = genOtp();
  const issued = await Delivery.updateOne({ _id: ret.pickup.deliveryId, otpVerified: { $ne: true }, $or: [{ otpIssuedAt: { $exists: false } }, { otpIssuedAt: { $lte: new Date(Date.now() - 60000) } }] }, { $set: { otp, otpVerified: false, otpAttempts: 0, otpIssuedAt: new Date() } });
  if (!issued.modifiedCount) throw httpError(409, 'OTP was recently issued or pickup already completed');

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
  const result = await financialTransaction(async session => {
    const ret = await Return.findById(returnId).session(session);
    if (!ret || String(ret.pickup?.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
    if (ret.pickupMethod === 'SHIPROCKET' || ret.pickup.status !== 'ASSIGNED') throw httpError(409, 'Pickup is not awaiting collection');
    const delivery = await Delivery.findOne({ _id: ret.pickup.deliveryId, partnerId, direction: 'return_pickup' }).session(session);
    if (!delivery || !delivery.otp || delivery.otpVerified) throw httpError(409, 'No active pickup OTP');
    if (delivery.otpAttempts >= OTP_MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts; regenerate the pickup code');
    if (!delivery.otpIssuedAt || Date.now() - delivery.otpIssuedAt.getTime() > 600000) throw httpError(400, 'Pickup OTP expired');
    if (String(otp) !== delivery.otp) {
      delivery.otpAttempts += 1; await delivery.save({ session });
      return { incorrect: true };
    }
    delivery.otpVerified = true; delivery.status = 'picked_up'; await delivery.save({ session });
    ret.pickup.status = 'PICKED_UP'; ret.pickedUpAt = new Date(); await ret.save({ session });
    return { ret, delivery };
  });
  if (result.incorrect) throw httpError(400, 'Incorrect pickup code', { code: 'WRONG_OTP' });
  const { ret, delivery } = result;

  notifyUser(ret.customerId, {
    event: NOTIFICATION_EVENT.RETURN_PICKED_UP, title: 'Item picked up',
    message: `Your return ${ret.returnNumber} has been picked up and is on its way back to the seller.`,
    metadata: { returnId: ret._id }, route: `/orders/${ret.orderId}`,
  }).catch(() => {});
  if (ret.sellerId) {
    notifySeller(ret.sellerId, {
      event: NOTIFICATION_EVENT.RETURN_PICKED_UP, title: 'Return picked up',
      message: `The rider picked up ${ret.productName} for return ${ret.returnNumber} and is on the way.`,
      metadata: { returnId: ret._id, returnNumber: ret.returnNumber }, route: `/seller/item-returns?return=${ret._id}`,
    }).catch(() => {});
  }

  return { ret, delivery };
};

/* ============================================================================
 * LOCATION + STAGE (optional, live tracking — reuses Delivery's own fields)
 * ========================================================================== */

export const updateReturnPickupLocation = async ({ returnId, partnerId, lat, lng }) => {
  const ret = await Return.findById(returnId).select('pickup pickupMethod').lean();
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup?.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');
  if (ret.pickupMethod === 'SHIPROCKET' || !['ASSIGNED', 'PICKED_UP'].includes(ret.pickup.status)) throw httpError(409, 'Pickup is not active');
  await Delivery.updateOne({ _id: ret.pickup.deliveryId }, { $set: { partnerLocation: { lat, lng, updatedAt: new Date() } } });
  return { ok: true };
};

/** Rider-self-service stage marks — never the final seller-receipt step (Section 16/23). */
export const updateReturnPickupStage = async ({ returnId, partnerId, status }) => {
  const allowed = ['arrived_at_store', 'in_transit', 'arrived_at_customer'];
  if (!allowed.includes(status)) throw httpError(400, `status must be one of: ${allowed.join(', ')}`);

  const ret = await Return.findById(returnId).select('pickup sellerId returnNumber pickupMethod').lean();
  if (!ret) throw httpError(404, 'Return not found');
  if (String(ret.pickup?.partnerId) !== String(partnerId)) throw httpError(403, 'Not your assigned pickup');

  if (ret.pickupMethod === 'SHIPROCKET' || !['ASSIGNED', 'PICKED_UP'].includes(ret.pickup.status) || status !== 'arrived_at_store' && ret.pickup.status !== 'PICKED_UP') throw httpError(409, 'Pickup stage requires verified collection');
  const delivery = await Delivery.findOneAndUpdate({ _id: ret.pickup.deliveryId, status: { $ne: 'delivered' } }, { $set: { status } }, { returnDocument: 'after' });
  if (!delivery) throw httpError(409, 'Pickup trip already completed');
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
  const ret = await financialTransaction(async session => {
    const ret = await Return.findById(returnId).session(session);
    if (!ret || String(ret.sellerId) !== String(sellerId)) throw httpError(404, 'Return not found');
    if (ret.pickup.status === 'DELIVERED_TO_SELLER') return ret;
    if (!['APPROVED', 'AWAITING_RETURN'].includes(ret.status)) throw httpError(409, 'Return is not awaiting receipt');
    if (ret.pickupMethod === 'SHIPROCKET') {
      if (ret.reverseBooking?.trackingState !== 'DELIVERED' || !ret.reverseBooking.deliveredAt) throw httpError(409, 'Verified courier delivery evidence is required');
    } else {
      if (ret.pickup.status !== 'PICKED_UP') throw httpError(409, 'Return has not been collected');
      const delivery = await Delivery.findOne({ _id: ret.pickup.deliveryId, direction: 'return_pickup', partnerId: ret.pickup.partnerId, otpVerified: true }).session(session);
      if (!delivery) throw httpError(409, 'Verified pickup trip is required');
      if (delivery.status === 'delivered') throw httpError(409, 'Historical receipt/earnings require reconciliation');
      const amount = riderPayout(delivery.route?.distanceKm, { mode: payoutModeOf({ type: 'grocery' }), rates: delivery.ratesUsed }).total;
      if (!Number.isFinite(amount) || amount < 0 || !delivery.ratesUsed?.rateId) throw httpError(409, 'Verified rider rates are required');
      delivery.status = 'delivered'; delivery.endTime = new Date(); delivery.partnerEarnings = amount;
      const rider = await DeliveryPartner.findById(delivery.partnerId).session(session);
      if (!rider) throw httpError(409, 'Assigned rider is missing');
      if (rider.financialWorkflowVersion === 2 && amount > 0) {
        await postLedgerEntry({ idempotencyKey: 'RETURN_PICKUP:' + delivery._id + ':EARNING', partnerId: delivery.partnerId, deliveryId: delivery._id, orderId: ret.orderId,
          account: 'rider_payable', type: 'delivery_earning', direction: 'credit', bucket: 'eligible', amount,
          description: 'Return pickup ' + ret.returnNumber, metadata: { source: 'return-pickup', returnId: String(ret._id) } }, { session });
      }
      await DeliveryPartner.updateOne({ _id: delivery.partnerId }, { $set: { isAvailable: true }, $inc: { totalDeliveries: 1, 'earnings.total': amount, 'earnings.pending': amount } }, { session });
      await delivery.save({ session });
    }
    ret.pickup.status = 'DELIVERED_TO_SELLER';
    ret.pickup.sellerConfirmedReceivedAt = new Date();
    ret.history.push({ toStatus: ret.status, changedByRole: 'seller', comment: 'Seller confirmed physical receipt' });
    await ret.save({ session });
    return ret;
  });

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
