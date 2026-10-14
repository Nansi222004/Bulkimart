import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { CHANNEL, ORDER_STATUS } from '../constants/enums.js';
import crypto from 'crypto';
import { distanceKm } from '../utils/geo.js';
import { canTakeAnother } from '../services/riderCapacity.service.js';
import {
  getShiprocketCapabilities, checkServiceability, createShiprocketOrder,
  assignCourier, generateLabel, schedulePickup,
} from '../services/shiprocket.service.js';
import { calculateOptionB, getQuickCommerceConfig } from '../services/quickCommerceFinance.service.js';

const sellerAndOrder = async (req) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  const order = await Order.findById(req.params.id);
  if (!order) throw httpError(404, 'Order not found');
  if (!order.items.some((item) => String(item.sellerId) === String(seller._id))) {
    throw httpError(403, 'You can only manage fulfillment for your own order');
  }
  return { seller, order };
};

const paymentIsReady = async (order) => {
  if (order.paymentMethod === 'cod') return true;
  const payment = order.paymentId ? await Payment.findById(order.paymentId).select('status') : null;
  return payment?.status === 'paid';
};

const totalWeightKg = (order) => {
  let grams = 0;
  for (const item of order.items) {
    const weight = Number(item.weightSnapshot);
    if (!Number.isFinite(weight) || weight <= 0) return null;
    grams += weight * Number(item.qty || 0);
  }
  return Number((grams / 1000).toFixed(3));
};

export const getFulfillmentOptions = asyncHandler(async (req, res) => {
  const { seller, order } = await sellerAndOrder(req);
  const capabilities = getShiprocketCapabilities();
  const pickup = seller.storeDetails || {};
  const drop = order.shippingAddress || {};
  const packageWeightKg = totalWeightKg(order);
  const onlineRiders = await DeliveryPartner.find({ status: 'approved', isAvailable: true }).lean();
  let manualRiderCount = 0;
  for (const rider of onlineRiders) {
    const zones = rider.zones || [];
    if (zones.length && !zones.includes(pickup.pincode) && !zones.includes(drop.pincode)) continue;
    if (rider.deliveryRadiusKm != null) {
      const origin = rider.currentLocation?.lat !== undefined ? rider.currentLocation : rider.baseLocation;
      const pickupDistance = distanceKm(origin, pickup);
      if (pickupDistance !== undefined && pickupDistance > rider.deliveryRadiusKm) continue;
    }
    if ((await canTakeAnother(rider._id)).ok) manualRiderCount += 1;
  }
  const prepared = order.status === ORDER_STATUS.PREPARING;
  const accepted = order.vendorDecision?.status === 'accepted';
  const paymentVerified = await paymentIsReady(order);
  const pickupLinked = Boolean(seller.thirdPartyFulfillment?.enabled && seller.thirdPartyFulfillment?.shiprocketPickupLocation);
  const addressReady = Boolean(pickup.pincode && drop.pincode && drop.phone);

  const courierChannelAllowed = order.type === CHANNEL.ECOM
    || (order.type === CHANNEL.GROCERY && capabilities.quickCommerce);
  const quickConfigState = order.type === CHANNEL.GROCERY ? await getQuickCommerceConfig() : null;
  const quickFeeRuleConfigured = Boolean(
    quickConfigState?.config?.fee?.type
    && Number.isFinite(quickConfigState?.config?.fee?.value)
    && quickConfigState?.config?.fee?.version
  );
  let providerQuote = null;
  let providerFailure = null;
  if (capabilities.configured && pickupLinked && addressReady && packageWeightKg && courierChannelAllowed) {
    try {
      const serviceability = await checkServiceability({
        pickupPostcode: pickup.pincode, deliveryPostcode: drop.pincode,
        weight: packageWeightKg, cod: order.paymentMethod === 'cod',
      });
      const chargeOf = (entry) => order.type === CHANNEL.GROCERY
        ? Number(entry.freight_charge ?? Infinity)
        : Number(entry.rate ?? entry.freight_charge ?? Infinity);
      const best = [...serviceability.couriers].sort((a, b) => chargeOf(a) - chargeOf(b))[0];
      if (best) {
        const courierCharge = chargeOf(best);
        if (!Number.isFinite(courierCharge)) throw new Error('Provider quote did not include freight_charge');
        const optionB = order.type === CHANNEL.GROCERY && quickFeeRuleConfigured
          ? calculateOptionB({
            customerDeliveryCharge: order.pricing?.deliveryCharge || 0,
            eligibleCourierFreight: courierCharge,
            feeRule: quickConfigState.config.fee,
          }) : null;
        providerQuote = {
          provider: 'shiprocket', courierId: best.courier_company_id, courierName: best.courier_name,
          courierCharge, serviceFee: optionB?.bulkimartServiceFee || 0, currency: 'INR',
          accountingStatus: 'estimated', optionB,
          feeRule: order.type === CHANNEL.GROCERY ? {
            type: quickConfigState.config.fee.type, value: quickConfigState.config.fee.value,
            version: quickConfigState.config.fee.version, calculationBasis: 'eligible_courier_freight',
          } : null,
        };
      } else providerFailure = 'No courier services this route';
    } catch { providerFailure = 'Provider serviceability check failed'; }
  }
  const shiprocketEligible = capabilities.configured && pickupLinked && addressReady
    && packageWeightKg && courierChannelAllowed
    && Boolean(providerQuote)
    && (order.type !== CHANNEL.GROCERY || (
      quickFeeRuleConfigured && quickConfigState.activationReady && quickConfigState.config.enabled
    ));

  return ok(res, {
    orderId: order._id,
    channel: order.type,
    stateReady: accepted && prepared && paymentVerified,
    manual: {
      available: accepted && prepared && paymentVerified && manualRiderCount > 0,
      eligibleRiderCount: manualRiderCount,
      reason: manualRiderCount ? null : 'No approved, available delivery partners are currently online',
    },
    shiprocket: {
      available: Boolean(shiprocketEligible && accepted && prepared && paymentVerified),
      configured: capabilities.configured,
      pickupLinked,
      packageWeightKg,
      quote: providerQuote,
      quickCommerceSupported: capabilities.quickCommerce,
      reason: !capabilities.configured ? 'Shiprocket is not configured'
        : !pickupLinked ? 'This vendor has no registered Shiprocket pickup location'
          : !packageWeightKg ? 'Every item requires a package weight'
            : order.type === CHANNEL.GROCERY && !quickFeeRuleConfigured ? 'Quick Commerce third-party service fee is not configured'
              : order.type === CHANNEL.GROCERY && !quickConfigState?.activationReady ? `Activation blocked: ${quickConfigState?.blockers?.join('; ')}`
                : order.type === CHANNEL.GROCERY && !quickConfigState?.config?.enabled ? 'Quick Commerce third-party delivery is disabled'
                : !addressReady ? 'Pickup or destination address is incomplete'
                  : providerFailure,
      activation: order.type === CHANNEL.GROCERY ? {
        enabled: Boolean(quickConfigState?.config?.enabled),
        ready: Boolean(quickConfigState?.activationReady),
        blockers: quickConfigState?.blockers || [],
      } : undefined,
    },
  }, 'Fulfillment options evaluated');
});

export const selectManualFulfillment = asyncHandler(async (req, res) => {
  const { order } = await sellerAndOrder(req);
  if (order.vendorDecision?.status !== 'accepted' || order.status !== ORDER_STATUS.PREPARING) {
    throw httpError(409, 'Accept and prepare the order before selecting manual delivery');
  }
  if (!await paymentIsReady(order)) throw httpError(409, 'Payment is not verified');
  if (order.shiprocket?.orderId) throw httpError(409, 'A Shiprocket order already exists for this fulfillment');

  order.deliveryType = 'internal';
  order.fulfillment = {
    method: 'manual', selectedBy: 'seller', selectedAt: new Date(), chargeStatus: 'not_applicable',
  };
  await order.save();
  return ok(res, { deliveryType: order.deliveryType, fulfillment: order.fulfillment }, 'Manual Bulkimart delivery selected');
});

export const createShiprocketShipment = asyncHandler(async (req, res) => {
  const { seller, order } = await sellerAndOrder(req);
  if (req.body?.confirm !== true) throw httpError(400, 'Vendor confirmation is required before shipment creation');
  if (order.type !== CHANNEL.ECOM) {
    throw httpError(409, 'Quick Commerce third-party shipment creation remains disabled pending policy approvals and live reconciliation verification');
  }
  if (order.vendorDecision?.status !== 'accepted' || order.status !== ORDER_STATUS.PREPARING) {
    throw httpError(409, 'Accept and prepare the order before creating a shipment');
  }
  if (!await paymentIsReady(order)) throw httpError(409, 'Payment is not verified');
  const pickupLocation = seller.thirdPartyFulfillment?.enabled
    ? seller.thirdPartyFulfillment?.shiprocketPickupLocation : null;
  if (!pickupLocation) throw httpError(409, 'This vendor has no registered Shiprocket pickup location');

  if (order.shiprocket?.awb) {
    return ok(res, { shiprocket: order.shiprocket }, 'Shipment already created');
  }

  const weight = totalWeightKg(order);
  if (!weight) throw httpError(400, 'Every shipment item must have a valid weight');
  const packageSize = ['length', 'breadth', 'height'].reduce((value, field) => ({
    ...value, [field]: Number(req.body?.package?.[field]),
  }), {});
  if (Object.values(packageSize).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw httpError(400, 'Package length, breadth, and height must be positive numbers');
  }
  const serviceability = await checkServiceability({
    pickupPostcode: seller.storeDetails?.pincode,
    deliveryPostcode: order.shippingAddress?.pincode,
    weight,
    cod: order.paymentMethod === 'cod',
  });
  if (!serviceability.available) throw httpError(409, 'No Shiprocket courier services this route');
  const courier = serviceability.couriers
    .find((entry) => String(entry.courier_company_id) === String(req.body?.courierId))
    || serviceability.couriers[0];

  const key = `shiprocket:${order._id}`;
  let shipmentId = order.shiprocket?.shipmentId;
  try {
    if (!shipmentId) {
      const lock = await Order.updateOne(
        { _id: order._id, 'shiprocket.orderId': { $exists: false }, 'shiprocket.status': { $ne: 'creating' } },
        { $set: { 'shiprocket.status': 'creating', 'shiprocket.idempotencyKey': key, 'shiprocket.requestedAt': new Date() } },
      );
      if (lock.modifiedCount !== 1) throw httpError(409, 'Shipment creation is already in progress');

      const a = order.shippingAddress;
      const result = await createShiprocketOrder({
        order_id: order.orderNo,
        order_date: new Date(order.createdAt).toISOString().slice(0, 19).replace('T', ' '),
        pickup_location: pickupLocation,
        billing_customer_name: a.name,
        billing_last_name: '',
        billing_address: [a.line1, a.line2].filter(Boolean).join(', '),
        billing_city: a.city,
        billing_pincode: a.pincode,
        billing_state: a.state,
        billing_country: 'India',
        billing_email: req.user.email || 'orders@bulkimart.in',
        billing_phone: a.phone,
        shipping_is_billing: true,
        order_items: order.items.map((item) => ({
          name: item.name, sku: item.sku || String(item.productId), units: item.qty,
          selling_price: item.price,
        })),
        payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
        sub_total: order.pricing?.subtotal,
        ...packageSize,
        weight,
      });
      if (!result?.order_id || !result?.shipment_id) throw new Error('Shiprocket returned an incomplete order response');
      shipmentId = String(result.shipment_id);
      await Order.updateOne({ _id: order._id }, { $set: {
        'shiprocket.orderId': String(result.order_id), 'shiprocket.shipmentId': shipmentId,
        'shiprocket.status': 'order_created', 'shiprocket.lastError': null,
      } });
    }

    const assigned = await assignCourier(shipmentId, courier?.courier_company_id);
    const [labelResult, pickupResult] = await Promise.allSettled([
      generateLabel(shipmentId), schedulePickup(shipmentId),
    ]);
    await Order.updateOne({ _id: order._id }, { $set: {
      deliveryType: 'shiprocket',
      fulfillment: { method: 'shiprocket', selectedBy: 'seller', selectedAt: new Date(), vendorConfirmedAt: new Date(), chargeStatus: 'not_applicable' },
      'shiprocket.awb': assigned.awb,
      'shiprocket.courier': assigned.courier_name || courier?.courier_name,
      'shiprocket.trackingUrl': assigned.tracking_url,
      'shiprocket.labelUrl': labelResult.status === 'fulfilled' ? labelResult.value?.label_url : undefined,
      'shiprocket.pickupScheduledAt': pickupResult.status === 'fulfilled' ? new Date() : undefined,
      'shiprocket.status': 'awb_assigned',
      'shiprocket.lastError': null,
    } });
  } catch (error) {
    await Order.updateOne({ _id: order._id }, { $set: {
      'shiprocket.status': shipmentId ? 'order_created' : 'failed',
      'shiprocket.lastError': error.message,
      'shiprocket.lastErrorAt': new Date(),
    } });
    throw error;
  }

  const updated = await Order.findById(order._id).select('shiprocket fulfillment deliveryType');
  return ok(res, updated, 'Shiprocket shipment and AWB created');
});

export const shiprocketWebhook = asyncHandler(async (req, res) => {
  const expected = process.env.SHIPROCKET_WEBHOOK_SECRET;
  if (!expected) throw httpError(503, 'Shiprocket webhook authentication is not configured');
  // Shiprocket sends the optional webhook security token in x-api-key.
  const supplied = String(req.get('x-api-key') || '');
  const valid = supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) throw httpError(401, 'Invalid Shiprocket webhook token');

  const awb = String(req.body?.awb || req.body?.awb_code || '');
  const shipmentId = String(req.body?.shipment_id || '');
  if (!awb && !shipmentId) throw httpError(400, 'Webhook is missing shipment identity');
  const status = String(req.body?.current_status || req.body?.shipment_status || req.body?.status || 'unknown');
  const eventId = String(req.body?.event_id || crypto.createHash('sha256')
    .update(JSON.stringify({ awb, shipmentId, status, timestamp: req.body?.timestamp || req.body?.updated_at || '' }))
    .digest('hex'));

  const result = await Order.updateOne(
    {
      ...(awb ? { 'shiprocket.awb': awb } : { 'shiprocket.shipmentId': shipmentId }),
      'shiprocket.webhookEvents.eventId': { $ne: eventId },
    },
    {
      $set: { 'shiprocket.status': status },
      $push: { 'shiprocket.webhookEvents': { eventId, status, receivedAt: new Date() } },
    },
  );
  return ok(res, { processed: result.modifiedCount === 1 }, result.modifiedCount ? 'Tracking update applied' : 'Webhook already processed or shipment not found');
});
