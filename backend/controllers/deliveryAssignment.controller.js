import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { distanceKm } from '../utils/geo.js';
import { canTakeAnother } from '../services/riderCapacity.service.js';
import { payoutModeOf, rateSnapshotFor } from '../services/riderPay.service.js';

const pickupFor = async (order) => {
  const sellerId = order.items.find((item) => item.sellerId)?.sellerId;
  const seller = sellerId ? await Seller.findById(sellerId).select('businessName storeDetails') : null;
  const shop = seller?.storeDetails;
  if (!shop || shop.lat === undefined || shop.lng === undefined) {
    throw httpError(409, 'The vendor must pin its pickup location before rider assignment');
  }
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

const isRiderEligible = async (partner, pickup, order) => {
  if (partner.status !== 'approved' || !partner.isAvailable) return false;
  const zones = partner.zones || [];
  if (zones.length && !zones.includes(pickup.pincode) && !zones.includes(order.shippingAddress?.pincode)) return false;
  if (partner.deliveryRadiusKm != null) {
    const origin = partner.currentLocation?.lat !== undefined ? partner.currentLocation : partner.baseLocation;
    const distance = distanceKm(origin, pickup);
    if (distance !== undefined && distance > partner.deliveryRadiusKm) return false;
  }
  return (await canTakeAnother(partner._id)).ok;
};

export const getManualAssignmentQueue = asyncHandler(async (_req, res) => {
  const orders = await Order.find({
    deliveryType: 'internal', status: 'dispatched',
  }).sort({ createdAt: 1 }).lean();

  const partners = await DeliveryPartner.find({ status: 'approved', isAvailable: true })
    .populate('userId', 'name phone').lean();
  const formattedOrders = [];
  for (const order of orders) {
    let eligiblePartnerIds = [];
    try {
      const { pickup } = await pickupFor(order);
      for (const partner of partners) {
        if (await isRiderEligible(partner, pickup, order)) eligiblePartnerIds.push(String(partner._id));
      }
    } catch { /* the assignment endpoint returns the actionable location error */ }
    formattedOrders.push({
      _id: order._id, orderNo: order.orderNo, channel: order.type,
      city: order.shippingAddress?.city, pincode: order.shippingAddress?.pincode,
      needsManualAssignment: order.needsManualAssignment,
      failureReason: order.fulfillment?.failureReason,
      deliveryPartnerId: order.deliveryPartnerId,
      eligiblePartnerIds,
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
  if (!mongoose.isValidObjectId(partnerId)) throw httpError(400, 'A valid delivery partner is required');
  const [order, partner] = await Promise.all([
    Order.findById(req.params.id), DeliveryPartner.findById(partnerId),
  ]);
  if (!order) throw httpError(404, 'Order not found');
  if (!partner) throw httpError(404, 'Delivery partner not found');
  if (order.deliveryType !== 'internal' || order.status !== 'dispatched') {
    throw httpError(409, 'Only accepted, prepared, ready-for-pickup manual orders can be assigned');
  }
  if (String(order.deliveryPartnerId || '') === String(partner._id)) {
    return ok(res, { orderId: order._id, deliveryId: order.deliveryId, partnerId: partner._id }, 'This rider is already assigned');
  }
  const { pickup } = await pickupFor(order);
  if (!await isRiderEligible(partner, pickup, order)) {
    throw httpError(409, 'This rider is offline, outside the service area, or at active-order capacity');
  }
  const drop = {
    address: [order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.city].filter(Boolean).join(', '),
    lat: order.shippingAddress?.lat, lng: order.shippingAddress?.lng,
  };
  if (drop.lat === undefined || drop.lng === undefined) throw httpError(409, 'The delivery address must be pinned before rider assignment');

  const session = await mongoose.startSession();
  let delivery;
  try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(order._id).session(session);
      if (fresh.status !== 'dispatched' || fresh.deliveryType !== 'internal') throw httpError(409, 'Order is no longer assignable');
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
        orderId: fresh._id, partnerId: partner._id, pickupLocation: pickup, dropLocation: drop,
        route: { distanceKm: distanceKm(pickup, drop) }, status: 'accepted',
        ratesUsed: rateSnapshotFor(payoutModeOf(fresh)), otpVerified: false,
        partnerLocation: partner.baseLocation?.lat !== undefined
          ? { lat: partner.baseLocation.lat, lng: partner.baseLocation.lng, updatedAt: new Date() } : undefined,
      }], { session });
      delivery = createdDelivery;
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
  return ok(res, { orderId: order._id, deliveryId: delivery._id, partner: { _id: partner._id, name: riderUser?.name, phone: riderUser?.phone } }, 'Delivery partner assigned');
});
