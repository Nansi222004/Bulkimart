import mongoose from 'mongoose';
import Order from '../models/Order.js';
import { orderPaymentReady } from '../services/orderPaymentEligibility.service.js';
import Seller from '../models/Seller.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { distanceKm } from '../utils/geo.js';
import { canTakeAnother } from '../services/riderCapacity.service.js';
import { riderCashAllowsOrder } from '../services/riderCashEligibility.service.js';
import { payoutModeOf, rateSnapshotFor } from '../services/riderPay.service.js';
import { requireOrderPickup, pickupCoordinates } from '../services/storePickup.service.js';
import { notifyRider, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { emitToRider } from '../socket/rooms.js';

const pickupFor = async (order) => {
  const { seller, shop } = await requireOrderPickup(order);
  return {
    seller,
    pickup: {
      address: [shop.name || seller.businessName, shop.address, shop.city].filter(Boolean).join(', '),
      lat: shop.lat,
      lng: shop.lng,
      pincode: shop.pincode,
    },
  };
};

const isRiderEligible = async (partner, pickup, order, { session = null, checkCapacity = true } = {}) => {
  if (partner.parcelReservation?.bookingId) return false;
  if (partner.status !== 'approved' || !partner.isAvailable) return false;
  if (!await riderCashAllowsOrder(partner._id, order, { session })) return false;
  const user = await User.findById(partner.userId).select('isActive roles').session(session);
  if (!user?.isActive || !user.roles?.includes('delivery')) return false;
  const zones = partner.zones || [];
  if (zones.length && !zones.includes(pickup.pincode) && !zones.includes(order.shippingAddress?.pincode)) return false;
  if (partner.deliveryRadiusKm != null) {
    const origin = partner.currentLocation?.lat !== undefined ? partner.currentLocation : partner.baseLocation;
    const distance = distanceKm(origin, pickup);
    if (distance === undefined || !Number.isFinite(distance) || distance > partner.deliveryRadiusKm) return false;
  }
  return !checkCapacity || (await canTakeAnother(partner._id, { session })).ok;
};

export const getManualAssignmentQueue = asyncHandler(async (_req, res) => {
  const orders = await Order.find({
    deliveryType: 'internal', status: 'dispatched',
  }).sort({ createdAt: 1 }).lean();

  const partners = await DeliveryPartner.find({ status: 'approved', isAvailable: true })
    .populate('userId', 'name phone').lean();
  const formattedOrders = [];
  for (const order of orders) {
    if (!await orderPaymentReady(order)) continue;
    let eligiblePartnerIds = [];
    let pickupStore, pickupError;
    try {
      const { pickup, seller } = await pickupFor(order);
      pickupStore = { _id: seller._id, name: seller.storeDetails?.name || seller.businessName, ...pickup };
      for (const partner of partners) {
        if (await isRiderEligible(partner, pickup, order)) eligiblePartnerIds.push(String(partner._id));
      }
    } catch (error) {
      if (error.status !== 409) throw error;
      pickupError = error.message;
      pickupStore = error.meta?.sellerId ? { _id: error.meta.sellerId } : null;
    }
    formattedOrders.push({
      _id: order._id, orderNo: order.orderNo, channel: order.type,
      city: order.shippingAddress?.city, pincode: order.shippingAddress?.pincode,
      needsManualAssignment: order.needsManualAssignment,
      failureReason: order.fulfillment?.failureReason,
      deliveryPartnerId: order.deliveryPartnerId,
      eligiblePartnerIds,
      pickupStore, pickupError,
      createdAt: order.createdAt,
    });
  }
  return ok(res, {
    orders: formattedOrders,
    partners: partners.map((partner) => ({
      _id: partner._id, name: partner.userId?.name || 'Delivery partner', phone: partner.userId?.phone,
      zones: partner.zones || [], status: partner.isAvailable ? 'Available' : 'Offline',
      deliveryRadiusKm: partner.deliveryRadiusKm,
    })),
  }, 'Manual assignment queue loaded');
});

export const assignDeliveryPartner = asyncHandler(async (req, res) => {
  const { partnerId, reason = 'Manual admin assignment' } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'A valid order is required');
  if (!mongoose.isValidObjectId(partnerId)) throw httpError(400, 'A valid delivery partner is required');
  const [order, partner] = await Promise.all([
    Order.findById(req.params.id), DeliveryPartner.findById(partnerId),
  ]);
  if (!order) throw httpError(404, 'Order not found');
  if (!await orderPaymentReady(order)) throw httpError(409, 'Payment must be verified before delivery assignment');
  if (!partner) throw httpError(404, 'Delivery partner not found');
  if (order.deliveryType !== 'internal' || order.status !== 'dispatched') {
    throw httpError(409, 'Only accepted, prepared, ready-for-pickup manual orders can be assigned');
  }
  if (order.shiprocket?.orderId || order.shiprocket?.shipmentId || ['creating','assigning','reconciliation_required'].includes(order.shiprocket?.status)) throw httpError(409, 'Courier fulfillment must be reconciled before manual assignment');
  if (String(order.deliveryPartnerId || '') === String(partner._id)) {
    return ok(res, { orderId: order._id, deliveryId: order.deliveryId, partnerId: partner._id }, 'This rider is already assigned');
  }
  const { pickup } = await pickupFor(order);
  if (!await isRiderEligible(partner, pickup, order, { checkCapacity: false })) {
    throw httpError(409, 'This rider is offline, outside the service area, or at active-order capacity');
  }
  const drop = {
    address: [order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.city].filter(Boolean).join(', '),
    lat: order.shippingAddress?.lat, lng: order.shippingAddress?.lng,
  };
  if (!pickupCoordinates(drop)) throw httpError(409, 'The delivery address must have a valid map pin before rider assignment');

  const session = await mongoose.startSession();
  let delivery;
  let assigned = false;
  try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(order._id).session(session);
      if (!fresh) throw httpError(404, 'Order no longer exists');
      if (String(fresh?.deliveryPartnerId || '') === String(partner._id) && fresh.deliveryId) {
        delivery = await Delivery.findById(fresh.deliveryId).session(session);
        assigned = false; return;
      }
      if (String(fresh?.deliveryId || '') !== String(order.deliveryId || '') || String(fresh?.deliveryPartnerId || '') !== String(order.deliveryPartnerId || '')) throw httpError(409, 'Assignment changed. Refresh before reassigning this order');
      if (fresh.status !== 'dispatched' || fresh.deliveryType !== 'internal') throw httpError(409, 'Order is no longer assignable');
      if (fresh.shiprocket?.orderId || fresh.shiprocket?.shipmentId || ['creating','assigning','reconciliation_required'].includes(fresh.shiprocket?.status)) throw httpError(409, 'Courier fulfillment is in progress; refresh before assignment');
      // Re-read the actual store and rider before creating the delivery snapshot.
      const currentPickup = await pickupFor(fresh);
      const currentPartner = await DeliveryPartner.findById(partnerId).session(session);
      if (!currentPartner || !await isRiderEligible(currentPartner, currentPickup.pickup, fresh, { session, checkCapacity: false })) throw httpError(409, 'The selected rider is no longer available or eligible');
      const parcelGuard = await DeliveryPartner.updateOne({ _id: partnerId, 'parcelReservation.bookingId': { $exists: false }, 'parcelReturnClaim.token': { $exists: false } }, { $inc: { __v: 1 } }, { session });
      if (!parcelGuard.matchedCount) throw httpError(409, 'Driver is reserved for a parcel task or return pickup claim');
      // Serialize first; recount within this transaction on every retry.
      const capacity = await canTakeAnother(partnerId, { session });
      if (!capacity.ok) throw httpError(409, capacity.reason);
      if (fresh.deliveryId) {
        const old = await Delivery.findById(fresh.deliveryId).session(session);
        if (old && !['assigned', 'accepted', 'arrived_at_store'].includes(old.status)) {
          throw httpError(409, 'The current rider already picked up this order; it cannot be reassigned');
        }
        if (old) await Delivery.updateOne({ _id: old._id }, { $set: { status: 'rejected' } }, { session });
        const activeHistory = [...(fresh.assignmentHistory || [])].reverse().find((entry) => !entry.unassignedAt);
        if (activeHistory) activeHistory.unassignedAt = new Date();
      }
      const [createdDelivery] = await Delivery.create([{
        orderId: fresh._id, partnerId: partner._id, pickupLocation: currentPickup.pickup, dropLocation: drop,
        route: { distanceKm: distanceKm(currentPickup.pickup, drop) }, status: 'accepted',
        ratesUsed: rateSnapshotFor(payoutModeOf(fresh)), otpVerified: false,
        partnerLocation: partner.baseLocation?.lat !== undefined
          ? { lat: partner.baseLocation.lat, lng: partner.baseLocation.lng, updatedAt: new Date() } : undefined,
      }], { session });
      delivery = createdDelivery;
      assigned = true;
      fresh.deliveryPartnerId = partner._id;
      fresh.deliveryId = delivery._id;
      fresh.needsManualAssignment = false;
      fresh.fulfillment = { ...(fresh.fulfillment?.toObject?.() || fresh.fulfillment || {}), method: 'manual', selectedBy: 'admin', selectedAt: new Date(), chargeStatus: 'not_applicable' };
      fresh.assignmentHistory.push({ partnerId: partner._id, assignedBy: req.user._id, assignedByRole: 'admin', assignedAt: new Date(), reason });
      fresh.timeline.push({ status: fresh.status, timestamp: new Date(), note: `Manually assigned to delivery partner ${partner._id}` });
      await fresh.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const riderUser = await User.findById(partner.userId).select('name phone').lean();
  let notificationWarning;
  if (assigned) {
    try {
      const notification = await notifyRider(String(partner._id), {
        event: NOTIFICATION_EVENT.RIDER_ASSIGNED, title: 'Delivery assigned',
        message: `Order ${order.orderNo} is assigned to you. Open your active delivery for pickup and drop-off details.`,
        route: '/delivery/dashboard', metadata: { orderId: order._id },
      });
      if (!notification) notificationWarning = 'Assignment saved; notification could not be confirmed. The rider can refresh Active Delivery. Retrying assignment will not create another delivery.';
      emitToRider(String(partner._id), 'delivery_assigned', { orderId: String(order._id) });
    } catch { notificationWarning = 'Assignment saved, but rider notification failed. Ask the rider to refresh Active Delivery; do not create another assignment.'; }
  }
  return ok(res, { orderId: order._id, deliveryId: delivery._id, notificationWarning, partner: { _id: partner._id, name: riderUser?.name, phone: riderUser?.phone } }, notificationWarning || 'Delivery partner assigned');
});

export const setStorePickupLocation = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'A valid seller is required');
  const { lat, lng } = req.body || {};
  if (!pickupCoordinates({lat,lng})) throw httpError(400, 'Enter finite numeric latitude (-90 to 90) and longitude (-180 to 180)');
  const seller = await Seller.findOneAndUpdate({ _id: req.params.id }, { $set: {
    'storeDetails.lat':lat, 'storeDetails.lng':lng, 'storeDetails.point':{type:'Point',coordinates:[lng,lat]},
    'storeDetails.locationSource':'manual',
  }, $inc:{__v:1} }, {returnDocument:'after',runValidators:true});
  if (!seller) throw httpError(404, 'Seller not found');
  return ok(res, {sellerId:seller._id,lat,lng}, 'Store pickup pin saved. Refresh and revalidate assignment.');
});
