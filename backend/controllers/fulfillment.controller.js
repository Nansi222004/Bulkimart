import Order from '../models/Order.js';
import mongoose from 'mongoose';
import { storePickup, pickupLocationError } from '../services/storePickup.service.js';
import { shiprocketEnvironment } from '../config/shiprocketEnvironment.js';
import { orderPaymentReady as paymentIsReady } from '../services/orderPaymentEligibility.service.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Delivery from '../models/Delivery.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { CHANNEL, ORDER_STATUS } from '../constants/enums.js';
import crypto from 'crypto';
import Payment from '../models/Payment.js';
import Snapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { requireVerifiedQuickCollection } from '../services/quickShiprocketCollection.service.js';
import { riderIneligibility } from '../services/riderEligibility.service.js';
import { notifyRider, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { canTakeAnother } from '../services/riderCapacity.service.js';
import { riderCodCashBalances, riderCashAllowsOrder } from '../services/riderCashEligibility.service.js';
import { RIDER_COD_CASH_LIMIT } from '../shared/deliveryCash.mjs';
import { pickupReadyForShipping, pickupStatus, pickupDefinition } from '../services/sellerPickupSync.service.js';
import {
  getShiprocketCapabilities, verifyPickupLocation, checkServiceability, createShiprocketOrder,
  assignCourier, generateLabel, schedulePickup,
} from '../services/shiprocket.service.js';
import { calculateOptionB, getQuickCommerceConfig, validateServiceFeeConfiguration } from '../services/quickCommerceFinance.service.js';

export const sellerAndOrder = async (req) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  let order = await Order.findById(req.params.id);
  if (!order) throw httpError(404, 'Order not found');
  if (!order.items.some((item) => String(item.sellerId) === String(seller._id))) {
    throw httpError(403, 'You can only manage fulfillment for your own order');
  }
  if (!order.items.every((item) => String(item.sellerId) === String(seller._id))) throw httpError(409, 'This order contains multiple stores and needs platform support before fulfillment.');
  // Earlier rider cancellations left this reference behind. Release only a
  // matching rejected trip; a concurrent new assignment must win unchanged.
  if (order.status === ORDER_STATUS.DISPATCHED && order.deliveryId && !order.deliveryPartnerId
      && await Delivery.exists({ _id: order.deliveryId, orderId: order._id, status: 'rejected' })) {
    const released = await Order.findOneAndUpdate({ _id: order._id, deliveryId: order.deliveryId, deliveryPartnerId: null, __v: order.__v }, {
      $unset: { deliveryId: '', 'fulfillment.requestedRiderId': '' }, $set: { needsManualAssignment: true }, $inc: { __v: 1 },
    }, { returnDocument: 'after' });
    if (!released) throw httpError(409, 'Assignment changed. Refresh this order.');
    order = released;
  }
  return { seller, order };
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
  const pickup = storePickup(seller) || seller.storeDetails || {};
  const pickupPinned = Boolean(storePickup(seller));
  const drop = order.shippingAddress || {};
  const packageWeightKg = totalWeightKg(order);
  const onlineRiders = await DeliveryPartner.find({ status: 'approved', isAvailable: true }).populate('userId', 'name phone isActive roles').lean();
  const eligibleRiders = [];
  const cashBalances = order.paymentMethod === 'cod' ? await riderCodCashBalances(onlineRiders.map(rider => rider._id)) : new Map();
  for (const rider of onlineRiders) {
    if (!pickupPinned || riderIneligibility(rider, rider.userId, { ...(order.toObject?.() || order), fulfillment: {} }, pickup)) continue;
    if (order.paymentMethod === 'cod' && (cashBalances.get(String(rider._id)) || 0) >= RIDER_COD_CASH_LIMIT * 100) continue;
    if (order.offerAttempts?.some(attempt => String(attempt.riderId) === String(rider._id) && attempt.status !== 'OFFERED')) continue;
    if ((await canTakeAnother(rider._id)).ok) eligibleRiders.push({ id: rider._id, name: rider.userId.name || 'Delivery partner', contact: rider.userId.phone ? '••••••' + String(rider.userId.phone).slice(-4) : null, online: true, availability: 'On duty, capacity available' });
  }
  const manualRiderCount = eligibleRiders.length;
  const prepared = order.status === ORDER_STATUS.PREPARING && Boolean(order.fulfillment?.readyAt || order.fulfillment?.method || !order.fulfillment?.assignmentPolicy);
  const manualPrepared = prepared || order.status === ORDER_STATUS.DISPATCHED && order.deliveryType !== 'shiprocket';
  const shipmentLocked = Boolean(order.shiprocket?.orderId || order.shiprocket?.shipmentId
    || ['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status));
  const accepted = order.vendorDecision?.status === 'accepted';
  const paymentVerified = await paymentIsReady(order);
  const stateReason = !accepted ? 'Accept this order before arranging delivery.' : !manualPrepared ? 'Start preparation and mark the parcel Ready for pickup before choosing delivery.' : !paymentVerified ? 'Payment must be verified before fulfillment.' : order.deliveryId || order.deliveryPartnerId ? 'A rider has already been assigned. Refresh the order to see the assignment.' : null;
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
  const feeSnapshot = order.type === CHANNEL.GROCERY ? await Snapshot.findOne({ orderId: order._id, sellerId: seller._id }).lean() : null;
  const feePayment = feeSnapshot ? await Payment.findOne({ quickFeeSnapshotId: feeSnapshot._id }).select('status gateway.orderId refundObligations.status').lean() : null;
  let quickFeeRuleConfigured = false;
  try { validateServiceFeeConfiguration(quickConfigState?.config); quickFeeRuleConfigured = true; } catch { /* Missing approvals never imply a zero fee. */ }
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
            version: quickConfigState.config.fee.version, calculationBasis: quickConfigState.config.fee.calculationBasis,
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
    stateReady: accepted && manualPrepared && paymentVerified && !order.deliveryId && !order.deliveryPartnerId,
    stateReason,
    pickup: { name: pickup.name, address: pickup.address, city: pickup.city, state: pickup.state, pincode: pickup.pincode, phone: pickup.phone, registeredLocation: seller.thirdPartyFulfillment?.shiprocketPickupLocation },
    destination: order.shippingAddress,
    manual: {
      available: pickupPinned && accepted && manualPrepared && paymentVerified && manualRiderCount > 0 && !shipmentLocked && !order.deliveryId && !order.deliveryPartnerId,
      eligibleRiderCount: manualRiderCount,
      assignmentMode: 'rider_acceptance',
      riders: eligibleRiders.slice(0, 30),
      reason: !pickupPinned ? pickupLocationError(seller).message : stateReason || (shipmentLocked ? 'Courier setup is already in progress or requires reconciliation' : manualRiderCount ? null : 'No eligible on-duty riders have capacity and coverage for this pickup. Approval alone does not put a rider on duty. Refresh availability or contact support to check the rider duty, location and service pincodes.'),
      pickupEditorPath: '/seller/profile',
    },
    shiprocket: {
      available: Boolean(order.delivery?.mode !== 'same_day' && shiprocketEligible && accepted && prepared && paymentVerified
        && !['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status)),
      feeCollection: order.type === CHANNEL.GROCERY ? { snapshot: feeSnapshot, status: feePayment?.status || 'not_started', reconciliationRequired: Boolean(feePayment?.refundObligations?.length) } : undefined,
      configured: capabilities.configured,
      environment: capabilities.mode,
      pickupLinked,
      pickupSync: pickupStatus(seller, req.user),
      shippingApproved: Boolean(seller.thirdPartyFulfillment?.enabled),
      verifiedPickup,
      packageWeightKg,
      quote: providerQuote,
      quickCommerceSupported: capabilities.quickCommerce,
      reason: stateReason || (shipmentLocked ? 'Courier setup already exists or needs reconciliation. Refresh the order and contact support before retrying.'
        : order.type === CHANNEL.GROCERY && (!quickConfigState.activationReady || !quickConfigState.config.enabled) ? 'Quick Commerce Shiprocket remains disabled pending approved fees, policies and seller collection reconciliation'
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
                  : providerFailure),
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
  const { seller, order } = await sellerAndOrder(req);
  if (!storePickup(seller)) throw pickupLocationError(seller);
  if (await Snapshot.exists({ orderId: order._id })) throw httpError(409, 'A Shiprocket fee obligation exists; reconcile it before switching delivery method');
  const riderId = req.body?.riderId;
  if (riderId && !mongoose.isValidObjectId(riderId)) throw httpError(400, 'Select a valid delivery partner');
  if (order.deliveryId || order.deliveryPartnerId) throw httpError(409, 'A delivery partner is already assigned. Refresh the order.');
  if (order.fulfillment?.assignmentPolicy && !order.fulfillment?.readyAt && !order.fulfillment?.method) throw httpError(409, 'Mark the parcel ready for pickup first');
  if (order.vendorDecision?.status !== 'accepted' || ![ORDER_STATUS.PREPARING, ORDER_STATUS.DISPATCHED].includes(order.status)) {
    throw httpError(409, 'Accept and prepare the order before selecting manual delivery');
  }
  if (!await paymentIsReady(order)) throw httpError(409, 'Payment is not verified');
  if (riderId) {
    const rider = await DeliveryPartner.findById(riderId).populate('userId', 'isActive roles');
    if (!rider || riderIneligibility(rider, rider.userId, { ...(order.toObject?.() || order), fulfillment: {} }, storePickup(seller))
        || !(await canTakeAnother(rider._id)).ok || !await riderCashAllowsOrder(rider._id, order)
        || order.offerAttempts?.some(attempt => String(attempt.riderId) === String(riderId) && attempt.status !== 'OFFERED')) {
      throw httpError(409, 'This delivery partner is no longer eligible. Refresh availability and select another partner.');
    }
  }
  const updated = await Order.findOneAndUpdate({
    _id: order._id, status: order.status, 'vendorDecision.status': 'accepted',
    __v: order.__v, 'fulfillment.method': order.fulfillment?.method || null,
    'shiprocket.orderId': null, 'shiprocket.shipmentId': null,
    'shiprocket.status': { $nin: activeShipmentStates }, deliveryId: null, deliveryPartnerId: null,
  }, { $set: {
    deliveryType: 'internal', 'fulfillment.method': 'manual', 'fulfillment.selectedBy': 'seller',
    'fulfillment.selectedAt': new Date(), 'fulfillment.chargeStatus': 'not_applicable',
    'fulfillment.requestedRiderId': riderId || null, 'fulfillment.requestedRiderNotifiedAt': null, needsManualAssignment: false,
  }, $push: { timeline: { status: order.status, timestamp: new Date(), note: riderId ? 'Seller requested a delivery partner; awaiting rider acceptance' : 'Seller selected manual delivery; riders accept after the parcel is offered' } }, $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: true });
  if (!updated) throw httpError(409, 'Order changed or a courier shipment is already being set up. Refresh before choosing delivery.');
  if (updated.status === ORDER_STATUS.DISPATCHED) {
    // The broadcast pushes the requested rider an acceptable offer.
    const { broadcastNewOrderToRiders } = await import('./deliveryPartner.controller.js');
    broadcastNewOrderToRiders(updated._id).catch(console.error);
  } else if (riderId) {
    // Not offerable until dispatch, but the rider should know the job is theirs now.
    notifyRider(riderId, {
      event: NOTIFICATION_EVENT.RIDER_REQUESTED,
      title: `New delivery assigned by ${seller.storeDetails?.name || seller.businessName || 'a store'}`,
      message: `Order ${updated.orderNo} is assigned to you. You will be asked to accept it as soon as the parcel is ready for pickup.`,
      metadata: { orderId: updated._id },
      route: '/delivery/dashboard',
    }).catch(e => console.error('[NOTIFICATION] notifyRider (requested) failed:', e.message));
  }
  return ok(res, { deliveryType: updated.deliveryType, fulfillment: updated.fulfillment }, 'Manual Bulkimart delivery selected');
});

export const createShiprocketShipment = asyncHandler(async (req, res) => {
  const { seller, order } = await sellerAndOrder(req);
  const environment = shiprocketEnvironment();
  const hasProviderReferences = order.shiprocket?.orderId || order.shiprocket?.shipmentId || order.shiprocket?.awb;
  const priorEnvironment = order.shiprocket?.environment || (/MOCK/i.test([order.shiprocket?.orderId,order.shiprocket?.shipmentId,order.shiprocket?.awb].join(' ')) ? 'mock' : 'live');
  if (hasProviderReferences && priorEnvironment !== environment.mode) throw httpError(409, 'Shipment belongs to a different provider environment; use isolated test data and reconcile existing references');
  if (order.fulfillment?.assignmentPolicy && !order.fulfillment?.readyAt && !order.fulfillment?.method) throw httpError(409, 'Mark the parcel ready for pickup first');
  if (req.body?.confirm !== true) throw httpError(400, 'Vendor confirmation is required before shipment creation');
  let quickCollection = null;
  if (order.type === CHANNEL.GROCERY) {
    const state = await getQuickCommerceConfig();
    if (!state.config.enabled || !state.activationReady) throw httpError(409, 'Quick Commerce Shiprocket is disabled pending approved configuration and reconciliation');
    quickCollection = await requireVerifiedQuickCollection(order, seller._id);
  } else if (order.type !== CHANNEL.ECOM) throw httpError(409, 'Unsupported courier channel');
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
  const courierCharge = entry => Number(quickCollection ? entry.freight_charge : entry.rate ?? entry.freight_charge);
  const couriers = serviceability.couriers.filter(entry => Number.isFinite(courierCharge(entry)) && courierCharge(entry) >= 0);
  const courier = req.body?.courierId != null ? couriers.find(entry => String(entry.courier_company_id) === String(req.body.courierId))
    : [...couriers].sort((a,b) => courierCharge(a) - courierCharge(b))[0];
  if (!courier) throw httpError(409, 'The selected courier has no valid serviceable quote. Refresh delivery options.');
  if (quickCollection && (courierCharge(courier) !== quickCollection.snapshot.eligibleCourierFreight || String(courier.courier_company_id) !== quickCollection.snapshot.providerCourierId)) throw httpError(409, 'Paid courier quote changed; platform reconciliation is required before shipment creation');
  const approvedCharge = req.body?.quotedCourierCharge;
  if (typeof approvedCharge !== 'number' || !Number.isFinite(approvedCharge) || approvedCharge < 0) {
    throw httpError(400, 'Review and confirm a courier quote before creating the shipment.');
  }
  if (courierCharge(courier) > approvedCharge) {
    throw httpError(409, 'The courier quote increased. Refresh delivery options and confirm the new estimate before retrying.');
  }

  // Customer price is frozen at checkout. This is a provider cost estimate,
  // not a new customer charge or an unapproved vendor ledger deduction.
  const quote = { provider: 'shiprocket', courierCharge: courierCharge(courier), serviceFee: quickCollection?.snapshot.serviceFee.grossAmount || 0, currency: 'INR',
    customerDeliveryCharge: order.pricing?.deliveryCharge || 0, customerAdditionalCharge: 0, quotedAt: new Date(), billingPolicy: 'checkout_charge_unchanged' };
  const operationId = crypto.randomUUID();
  const locked = await Order.updateOne({
    _id: order._id, status: ORDER_STATUS.PREPARING, 'vendorDecision.status': 'accepted', deliveryId: null,
    'shiprocket.status': { $nin: activeShipmentStates }, 'shiprocket.awb': null,
    'shiprocket.orderId': order.shiprocket?.orderId || null,
    'shiprocket.shipmentId': order.shiprocket?.shipmentId || null,
    'fulfillment.method': order.fulfillment?.method || null,
  }, { $set: { 'shiprocket.status': order.shiprocket?.shipmentId ? 'assigning' : 'creating',
    'shiprocket.environment': environment.mode,
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
      'fulfillment.selectedAt': new Date(), 'fulfillment.vendorConfirmedAt': new Date(), 'fulfillment.chargeStatus': quickCollection ? 'collected' : 'not_applicable',
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
  const environment = shiprocketEnvironment();
  const expected = environment.webhookSecret;
  if (!expected) throw httpError(503, 'Shiprocket webhook authentication is not configured');
  // Shiprocket sends the optional webhook security token in x-api-key.
  const supplied = String(req.get('x-api-key') || '');
  const valid = Buffer.byteLength(supplied) === Buffer.byteLength(expected)
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) throw httpError(401, 'Invalid Shiprocket webhook token');

  if (Number(req.body?.is_return) === 1) {
    const { applyReverseTracking } = await import('../services/returnCourier.service.js');
    const result = await applyReverseTracking({ shipmentId: req.body.shipment_id, awb: req.body.awb || req.body.awb_code,
      statusId: req.body.shipment_status_id, status: req.body.shipment_status, eventId: req.body.event_id, environment: environment.mode });
    return ok(res, { processed: result.changed }, 'Return tracking evidence checked');
  }

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
      ...(environment.mode === 'sandbox' ? { 'shiprocket.environment': 'sandbox' } : {
        $or: [{ 'shiprocket.environment': environment.mode }, { 'shiprocket.environment': { $exists: false } }],
      }),
      ...(environment.mode === 'live' ? { $nor: ['orderId','shipmentId','awb'].map(field => ({ ['shiprocket.' + field]: /MOCK/i })) } : {}),
      'shiprocket.webhookEvents.eventId': { $ne: eventId },
    },
    {
      $set: { 'shiprocket.status': status },
      $push: { 'shiprocket.webhookEvents': { eventId, status, receivedAt: new Date() } },
    },
  );
  return ok(res, { processed: result.modifiedCount === 1 }, result.modifiedCount ? 'Tracking update applied' : 'Webhook already processed or shipment not found');
});
