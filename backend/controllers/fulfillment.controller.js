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
import { pickupReadyForShipping, pickupStatus, pickupDefinition } from '../services/sellerPickupSync.service.js';
import {
  getShiprocketCapabilities, verifyPickupLocation, checkServiceability, createShiprocketOrder,
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
  if (!order.items.every((item) => String(item.sellerId) === String(seller._id))) throw httpError(409, 'This order contains multiple stores and needs platform support before fulfillment.');
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
  const onlineRiders = await DeliveryPartner.find({ status: 'approved', isAvailable: true }).populate('userId', 'name phone isActive').lean();
  const eligibleRiders = [];
  let manualRiderCount = 0;
  for (const rider of onlineRiders) {
    if (!rider.userId?.isActive) continue;
    const zones = rider.zones || [];
    const origin = rider.baseLocation?.point?.coordinates?.length === 2
      ? { lat: rider.baseLocation.point.coordinates[1], lng: rider.baseLocation.point.coordinates[0] } : rider.baseLocation;
    const pickupDistance = distanceKm(origin, pickup);
    // E-commerce offers use the bounded geo search; Quick has existing zone/
    // general on-duty fallbacks. This list never reserves or assigns a rider.
    if (order.type === CHANNEL.ECOM && (pickupDistance === undefined || pickupDistance > ((Number(process.env.PICKUP_RADIUS_METERS) || 5000) * 3 / 1000))) continue;
    if (order.type !== CHANNEL.ECOM && zones.length && !zones.includes(pickup.pincode) && !zones.includes(drop.pincode)) continue;
    if (rider.deliveryRadiusKm != null) {
      const origin = rider.currentLocation?.lat !== undefined ? rider.currentLocation : rider.baseLocation;
      const pickupDistance = distanceKm(origin, pickup);
      if (pickupDistance !== undefined && pickupDistance > rider.deliveryRadiusKm) continue;
    }
    if ((await canTakeAnother(rider._id)).ok) {
      manualRiderCount += 1;
      eligibleRiders.push({ name: rider.userId.name || 'Delivery partner', contact: rider.userId.phone ? `••••••${String(rider.userId.phone).slice(-4)}` : null, availability: 'On duty, capacity available' });
    }
  }
  const prepared = order.status === ORDER_STATUS.PREPARING && Boolean(order.fulfillment?.readyAt || order.fulfillment?.method || !order.fulfillment?.assignmentPolicy);
  const shipmentLocked = Boolean(order.shiprocket?.orderId || order.shiprocket?.shipmentId
    || ['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status));
  const accepted = order.vendorDecision?.status === 'accepted';
  const paymentVerified = await paymentIsReady(order);
  const syncReady = pickupReadyForShipping(seller, req.user);
  const pickupLinked = Boolean(syncReady && seller.thirdPartyFulfillment?.enabled && seller.thirdPartyFulfillment?.shiprocketPickupLocation);
  let verifiedPickup = null;
  let pickupError = null;
  if (capabilities.configured && pickupLinked) {
    try { verifiedPickup = await verifyPickupLocation(seller.thirdPartyFulfillment.shiprocketPickupLocation, pickup, seller.pickupSync?.status ? { payload: pickupDefinition(seller, req.user).payload, providerId: seller.pickupSync.providerId } : undefined); }
    catch { pickupError = 'Could not verify the registered pickup with Shiprocket. Retry later.'; }
  }
  const addressReady = Boolean(pickup.pincode && drop.pincode && drop.phone);

  const courierChannelAllowed = order.delivery?.mode !== 'same_day' && (order.type === CHANNEL.ECOM
    || (order.type === CHANNEL.GROCERY && capabilities.quickCommerce));
  const quickConfigState = order.type === CHANNEL.GROCERY ? await getQuickCommerceConfig() : null;
  const quickFeeRuleConfigured = Boolean(
    quickConfigState?.config?.fee?.type
    && Number.isFinite(quickConfigState?.config?.fee?.value)
    && quickConfigState?.config?.fee?.version
  );
  let providerQuote = null;
  let providerFailure = null;
  if (capabilities.configured && pickupLinked && verifiedPickup && addressReady && packageWeightKg && courierChannelAllowed) {
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
    pickup: { name: pickup.name, address: pickup.address, city: pickup.city, state: pickup.state, pincode: pickup.pincode, phone: pickup.phone, registeredLocation: seller.thirdPartyFulfillment?.shiprocketPickupLocation },
    destination: order.shippingAddress,
    manual: {
      available: accepted && prepared && paymentVerified && manualRiderCount > 0 && !shipmentLocked,
      eligibleRiderCount: manualRiderCount,
      assignmentMode: 'rider_acceptance',
      riders: eligibleRiders.slice(0, 30),
      reason: shipmentLocked ? 'Courier setup is already in progress or requires reconciliation' : manualRiderCount ? null : 'No eligible, approved on-duty delivery partners currently have capacity. Refresh availability to retry.',
    },
    shiprocket: {
      available: Boolean(order.type === CHANNEL.ECOM && order.delivery?.mode !== 'same_day' && shiprocketEligible && accepted && prepared && paymentVerified
        && !['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status)),
      configured: capabilities.configured,
      pickupLinked,
      pickupSync: pickupStatus(seller),
      verifiedPickup,
      packageWeightKg,
      quote: providerQuote,
      quickCommerceSupported: capabilities.quickCommerce,
      reason: shipmentLocked ? 'Courier setup already exists or needs reconciliation. Refresh the order and contact support before retrying.'
        : order.type === CHANNEL.GROCERY ? 'Quick Commerce third-party shipping remains disabled pending policy approvals and reconciliation verification'
        : order.delivery?.mode === 'same_day' ? 'Same-Day requires Bulkimart delivery'
        : !capabilities.configured ? 'Shiprocket is not configured'
        : !syncReady ? pickupStatus(seller).message || 'Pickup synchronization is pending. Check the store profile.'
        : !seller.thirdPartyFulfillment?.enabled ? 'Shiprocket delivery requires platform approval; pickup registration does not grant approval.'
        : !pickupLinked ? 'This vendor has no registered Shiprocket pickup location'
          : !verifiedPickup ? pickupError || 'Pickup location is not eligible in Shiprocket. Contact platform support to register/link the store pickup address.'
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

const activeShipmentStates = ['creating', 'assigning', 'reconciliation_required'];

export const selectManualFulfillment = asyncHandler(async (req, res) => {
  const { order } = await sellerAndOrder(req);
  if (req.body?.riderId || req.body?.partnerId) throw httpError(400, 'Riders accept eligible offers; sellers cannot choose a rider');
  if (order.fulfillment?.assignmentPolicy && !order.fulfillment?.readyAt && !order.fulfillment?.method) throw httpError(409, 'Mark the parcel ready for pickup first');
  if (order.vendorDecision?.status !== 'accepted' || order.status !== ORDER_STATUS.PREPARING) {
    throw httpError(409, 'Accept and prepare the order before selecting manual delivery');
  }
  if (!await paymentIsReady(order)) throw httpError(409, 'Payment is not verified');
  if (order.fulfillment?.method === 'manual' && !order.deliveryId) return ok(res, { deliveryType: order.deliveryType, fulfillment: order.fulfillment }, 'Manual delivery already selected');
  const updated = await Order.findOneAndUpdate({
    _id: order._id, status: ORDER_STATUS.PREPARING, 'vendorDecision.status': 'accepted',
    __v: order.__v, 'fulfillment.method': order.fulfillment?.method || null,
    'shiprocket.orderId': null, 'shiprocket.shipmentId': null,
    'shiprocket.status': { $nin: activeShipmentStates }, deliveryId: null,
  }, { $set: {
    deliveryType: 'internal', 'fulfillment.method': 'manual', 'fulfillment.selectedBy': 'seller',
    'fulfillment.selectedAt': new Date(), 'fulfillment.chargeStatus': 'not_applicable',
  }, $push: { timeline: { status: order.status, timestamp: new Date(), note: 'Seller selected manual delivery; riders accept after the parcel is offered' } }, $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: true });
  if (!updated) throw httpError(409, 'Order changed or a courier shipment is already being set up. Refresh before choosing delivery.');
  return ok(res, { deliveryType: updated.deliveryType, fulfillment: updated.fulfillment }, 'Manual Bulkimart delivery selected');
});

export const createShiprocketShipment = asyncHandler(async (req, res) => {
  const { seller, order } = await sellerAndOrder(req);
  if (order.fulfillment?.assignmentPolicy && !order.fulfillment?.readyAt && !order.fulfillment?.method) throw httpError(409, 'Mark the parcel ready for pickup first');
  if (req.body?.confirm !== true) throw httpError(400, 'Vendor confirmation is required before shipment creation');
  if (order.type !== CHANNEL.ECOM) throw httpError(409, 'Quick Commerce third-party shipment creation remains disabled pending policy approvals and live reconciliation verification');
  if (order.delivery?.mode === 'same_day') throw httpError(409, 'Same-Day delivery requires Bulkimart delivery; it cannot be switched to a standard courier.');
  if (order.vendorDecision?.status !== 'accepted' || order.status !== ORDER_STATUS.PREPARING) throw httpError(409, 'Accept and prepare the order before creating a shipment');
  if (!await paymentIsReady(order)) throw httpError(409, 'Payment is not verified');
  if (order.shiprocket?.awb) return ok(res, { shiprocket: order.shiprocket, fulfillment: order.fulfillment }, 'Shipment already created');
  if (!pickupReadyForShipping(seller, req.user)) throw httpError(409, 'Current store pickup is not synchronized. Check and retry pickup registration in the store profile.');
  if (activeShipmentStates.includes(order.shiprocket?.status)) throw httpError(409, 'Shipment setup is in progress or needs provider reconciliation. Do not create another shipment.');
  if (Boolean(order.shiprocket?.orderId) !== Boolean(order.shiprocket?.shipmentId)) throw httpError(409, 'Partial provider references require reconciliation before any shipment retry.');
  if (!getShiprocketCapabilities().configured) throw httpError(503, 'Shiprocket is not configured');
  const pickupLocation = seller.thirdPartyFulfillment?.enabled ? seller.thirdPartyFulfillment.shiprocketPickupLocation : null;
  if (!pickupLocation) throw httpError(409, 'This vendor has no registered Shiprocket pickup location');
  let verifiedPickup;
  try { verifiedPickup = await verifyPickupLocation(pickupLocation, seller.storeDetails || {}, seller.pickupSync?.status ? { payload: pickupDefinition(seller, req.user).payload, providerId: seller.pickupSync.providerId } : undefined); }
  catch { throw httpError(502, 'Could not verify the pickup location. No shipment was created. Retry later.'); }
  if (!verifiedPickup) throw httpError(409, 'Pickup location is not eligible in Shiprocket. Contact platform support.');
  const weight = totalWeightKg(order);
  if (!weight) throw httpError(400, 'Every shipment item must have a valid weight');
  const packageSize = Object.fromEntries(['length', 'breadth', 'height'].map(field => [field, Number(req.body?.package?.[field])]));
  if (Object.values(packageSize).some(value => !Number.isFinite(value) || value <= 0.5 || value > 500)) throw httpError(400, 'Package dimensions must be greater than 0.5 cm and at most 500 cm');
  let serviceability;
  try {
    serviceability = await checkServiceability({ pickupPostcode: seller.storeDetails?.pincode, deliveryPostcode: order.shippingAddress?.pincode, weight, cod: order.paymentMethod === 'cod' });
  } catch {
    throw httpError(502, 'Could not check courier serviceability. No shipment was created; please retry later.');
  }
  if (!serviceability.available || !serviceability.couriers?.length) throw httpError(409, 'No Shiprocket courier services this route');
  const couriers = serviceability.couriers.filter(entry => Number.isFinite(Number(entry.rate ?? entry.freight_charge)) && Number(entry.rate ?? entry.freight_charge) >= 0);
  const courier = req.body?.courierId != null ? couriers.find(entry => String(entry.courier_company_id) === String(req.body.courierId))
    : [...couriers].sort((a,b) => Number(a.rate ?? a.freight_charge) - Number(b.rate ?? b.freight_charge))[0];
  if (!courier) throw httpError(409, 'The selected courier has no valid serviceable quote. Refresh delivery options.');
  const approvedCharge = req.body?.quotedCourierCharge;
  if (typeof approvedCharge !== 'number' || !Number.isFinite(approvedCharge) || approvedCharge < 0) {
    throw httpError(400, 'Review and confirm a courier quote before creating the shipment.');
  }
  if (Number(courier.rate ?? courier.freight_charge) > approvedCharge) {
    throw httpError(409, 'The courier quote increased. Refresh delivery options and confirm the new estimate before retrying.');
  }

  // Customer price is frozen at checkout. This is a provider cost estimate,
  // not a new customer charge or an unapproved vendor ledger deduction.
  const quote = { provider: 'shiprocket', courierCharge: Number(courier.rate ?? courier.freight_charge), serviceFee: 0, currency: 'INR',
    customerDeliveryCharge: order.pricing?.deliveryCharge || 0, customerAdditionalCharge: 0, quotedAt: new Date(), billingPolicy: 'checkout_charge_unchanged' };
  const operationId = crypto.randomUUID();
  const locked = await Order.updateOne({
    _id: order._id, status: ORDER_STATUS.PREPARING, 'vendorDecision.status': 'accepted', deliveryId: null,
    'shiprocket.status': { $nin: activeShipmentStates }, 'shiprocket.awb': null,
    'shiprocket.orderId': order.shiprocket?.orderId || null,
    'shiprocket.shipmentId': order.shiprocket?.shipmentId || null,
    'fulfillment.method': order.fulfillment?.method || null,
  }, { $set: { 'shiprocket.status': order.shiprocket?.shipmentId ? 'assigning' : 'creating',
    'shiprocket.operationId': operationId, 'shiprocket.idempotencyKey': 'shiprocket:' + order._id,
    'shiprocket.requestedAt': new Date(), 'fulfillment.quote': quote, 'shiprocket.package': { ...packageSize, weight }, 'shiprocket.pickupLocation': pickupLocation, 'shiprocket.pickupAddress': verifiedPickup } });
  if (locked.modifiedCount !== 1) throw httpError(409, 'Order changed or shipment setup is already in progress. Refresh this order.');

  const owner = { _id: order._id, 'shiprocket.operationId': operationId };
  let shipmentId = order.shiprocket?.shipmentId;
  let remoteStarted = false;
  try {
    if (!shipmentId) {
      const a = order.shippingAddress;
      const pricing = order.pricing;
      const tip = Number(pricing.tipAmount || 0);
      const grossItems = Number(pricing.subtotal) + tip;
      const discount = Number((grossItems + quote.customerDeliveryCharge - Number(pricing.totalAmount)).toFixed(2));
      if (![grossItems, discount, Number(pricing.totalAmount)].every(Number.isFinite) || discount < 0) throw httpError(409, 'Order pricing does not reconcile; contact support before creating a shipment.');
      remoteStarted = true;
      const result = await createShiprocketOrder({
        order_id: order.orderNo, order_date: new Date(order.createdAt).toISOString().slice(0,19).replace('T',' '), pickup_location: pickupLocation,
        billing_customer_name: a.name, billing_last_name: '', billing_address: [a.line1,a.line2].filter(Boolean).join(', '), billing_city: a.city,
        billing_pincode: a.pincode, billing_state: a.state, billing_country: 'India', billing_email: req.user.email || 'orders@bulkimart.in', billing_phone: a.phone, shipping_is_billing: true,
        order_items: [...order.items.map(item => ({ name: item.name, sku: item.sku || String(item.productId), units: item.qty, selling_price: item.price })),
          ...(tip > 0 ? [{ name: 'Delivery partner tip', sku: 'BULKIMART-TIP', units: 1, selling_price: tip }] : [])],
        payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid', sub_total: grossItems,
        shipping_charges: quote.customerDeliveryCharge, total_discount: discount, ...packageSize, weight,
      });
      if (!result?.order_id || !result?.shipment_id) throw new Error('Incomplete provider response');
      shipmentId = String(result.shipment_id);
      const saved = await Order.updateOne(owner, { $set: { 'shiprocket.orderId': String(result.order_id), 'shiprocket.shipmentId': shipmentId, 'shiprocket.status': 'assigning', 'shiprocket.lastError': null } });
      if (saved.modifiedCount !== 1) throw new Error('Shipment reference could not be confirmed');
    }
    remoteStarted = true;
    const assigned = await assignCourier(shipmentId, courier.courier_company_id);
    if (!assigned?.awb) throw new Error('Provider did not confirm a waybill');
    const saved = await Order.updateOne(owner, { $set: {
      deliveryType: 'shiprocket', 'fulfillment.method': 'shiprocket', 'fulfillment.selectedBy': 'seller',
      'fulfillment.selectedAt': new Date(), 'fulfillment.vendorConfirmedAt': new Date(), 'fulfillment.chargeStatus': 'not_applicable',
      'shiprocket.awb': assigned.awb, 'shiprocket.courier': assigned.courier_name || courier.courier_name,
      'shiprocket.trackingUrl': assigned.tracking_url, 'shiprocket.status': 'awb_assigned', 'shiprocket.lastError': null,
    } });
    if (saved.modifiedCount !== 1) throw new Error('Waybill reference could not be confirmed');
  } catch (error) {
    // A timeout can mean the provider committed. Never reset another request's
    // lock or blindly retry a remote creation with an uncertain outcome.
    await Order.updateOne(owner, { $set: { 'shiprocket.status': remoteStarted ? 'reconciliation_required' : 'failed',
      'shiprocket.lastError': remoteStarted ? 'Provider outcome could not be confirmed. Reconcile using the Bulkimart order number before retrying.' : 'Shipment validation failed before contacting the provider.',
      'shiprocket.lastErrorAt': new Date() } });
    if (error.status && !remoteStarted) throw error;
    throw httpError(502, 'Shipment setup could not be confirmed. Contact support for reconciliation; do not create a duplicate shipment.');
  }
  const [label, pickup] = await Promise.allSettled([generateLabel(shipmentId), schedulePickup(shipmentId)]);
  await Order.updateOne(owner, { $set: {
    ...(label.status === 'fulfilled' && label.value?.label_url ? { 'shiprocket.labelUrl': label.value.label_url } : {}),
    ...(pickup.status === 'fulfilled' && Number(pickup.value?.pickup_status) === 1 ? { 'shiprocket.pickupScheduledAt': new Date() } : {}),
    'shiprocket.lastError': label.status === 'rejected' || pickup.status === 'rejected' || Number(pickup.value?.pickup_status) !== 1
      ? 'Waybill created; label or pickup needs follow-up. Do not recreate the shipment.' : null,
  }, $push: { timeline: { status: order.status, timestamp: new Date(), note: 'Shiprocket waybill confirmed; provider pickup and label status recorded' } }, $inc: { __v: 1 } });
  return ok(res, await Order.findById(order._id).select('shiprocket fulfillment deliveryType'), 'Shiprocket waybill created; check pickup and label status');
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
