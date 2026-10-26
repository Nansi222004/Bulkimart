import crypto from 'node:crypto';
import Return from '../models/Return.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import * as provider from './shiprocket.service.js';
import { httpError } from '../utils/response.js';
import { financialTransaction } from './financeSafety.service.js';
import { notifySeller, NOTIFICATION_EVENT } from './notification.service.js';

const ready = ['APPROVED', 'AWAITING_RETURN'];
const identity = value => value != null && /^[1-9]\d*$/.test(String(value));
const ownership = async (returnId, sellerId) => {
  const ret = await Return.findById(returnId);
  if (!ret || String(ret.sellerId) !== String(sellerId)) throw httpError(404, 'Return not found');
  const order = await Order.findById(ret.orderId);
  const item = order?.items.find(row => String(row._id) === String(ret.orderItemId));
  if (!item || String(item.sellerId) !== String(sellerId)) throw httpError(403, 'Return item ownership mismatch');
  return { ret, order, item };
};
const text = value => String(value || '').trim();
const phone = value => text(value).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
export const buildReversePayload = ({ ret, order, item, seller, customer, product }) => {
  const from = order.shippingAddress || {}, to = seller.storeDetails || {};
  const originalPackage = order.shiprocket?.package;
  const dimensions = originalPackage?.length != null ? originalPackage : product?.dimensions || {};
  const weight = order.shiprocket?.package?.weight || Number(item.weightSnapshot || product?.variants?.find(row => String(row._id) === String(ret.variantId))?.weight || product?.weight) * ret.quantity / 1000;
  const payload = {
    order_id: `RET-${ret._id}-${(ret.reverseBooking?.attemptCount || 0) + 1}`,
    order_date: new Date().toISOString().slice(0, 10),
    pickup_customer_name: text(from.name), pickup_address: text(from.line1), pickup_address_2: text(from.line2),
    pickup_city: text(from.city), pickup_state: text(from.state), pickup_country: 'India', pickup_pincode: text(from.pincode),
    pickup_email: text(customer.email), pickup_phone: phone(from.phone),
    shipping_customer_name: text(to.name || seller.businessName), shipping_address: text(to.address),
    shipping_city: text(to.city), shipping_state: text(to.state), shipping_country: 'India', shipping_pincode: text(to.pincode),
    shipping_email: text(to.email), shipping_phone: phone(to.phone),
    order_items: [{ name: ret.productName || item.name, sku: String(ret.variantId || ret.productId), units: ret.quantity, selling_price: item.price }],
    payment_method: 'PREPAID', sub_total: Math.round(item.price * ret.quantity * 100) / 100,
    length: dimensions.length, breadth: dimensions.breadth, height: dimensions.height, weight,
  };
  for (const prefix of ['pickup', 'shipping']) {
    for (const field of ['customer_name', 'address', 'city', 'state']) if (!payload[`${prefix}_${field}`]) throw httpError(400, `Missing ${prefix} ${field}; update the address before booking`);
    if (!/^[1-9]\d{5}$/.test(payload[`${prefix}_pincode`]) || !/^[6-9]\d{9}$/.test(payload[`${prefix}_phone`])) throw httpError(400, `Invalid ${prefix} postcode or phone`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.pickup_email)) throw httpError(400, 'Customer email is required for Shiprocket reverse pickup');
  if (['length', 'breadth', 'height'].some(key => !Number.isFinite(payload[key]) || payload[key] <= 0.5) || !Number.isFinite(weight) || weight <= 0) throw httpError(400, 'Verified package dimensions and weight are required');
  if (!Number.isSafeInteger(ret.quantity) || ret.quantity <= 0 || !Number.isFinite(payload.sub_total) || payload.sub_total < 0) throw httpError(400, 'Invalid return package items');
  return payload;
};

export const bookReturnCourier = async ({ returnId, sellerId }) => {
  const { ret, order, item } = await ownership(returnId, sellerId);
  if (!ready.includes(ret.status) || !['NOT_ASSIGNED', 'CANCELLED'].includes(ret.pickup?.status)) throw httpError(409, 'Return is not available for courier pickup');
  if (ret.reverseBooking?.state === 'booked') return ret;
  if (ret.pickupMethod === 'MANUAL' || ['creating', 'uncertain', 'cancel_pending'].includes(ret.reverseBooking?.state)) throw httpError(409, 'Existing pickup must be reconciled or cancelled before booking');
  const seller = await Seller.findById(sellerId), customer = await User.findById(ret.customerId), product = await Product.findById(ret.productId);
  if (!customer || !seller) throw httpError(400, 'Pickup contact is unavailable');
  const payload = buildReversePayload({ ret, order, item, seller, customer, product });
  const environment = await provider.prepareReverseClient();
  const service = await provider.checkServiceability({ pickupPostcode: payload.pickup_pincode, deliveryPostcode: payload.shipping_pincode, weight: payload.weight, cod: false });
  if (!service.available) throw httpError(400, 'Shiprocket reports this pickup route is not serviceable');
  const token = crypto.randomUUID();
  const claimed = await Return.findOneAndUpdate({ _id: returnId, status: { $in: ready }, pickupMethod: { $ne: 'MANUAL' }, 'pickup.status': { $in: ['NOT_ASSIGNED', 'CANCELLED'] }, 'reverseBooking.state': { $nin: ['creating', 'booked', 'uncertain', 'cancel_pending'] } }, {
    $set: { pickupMethod: 'SHIPROCKET', 'pickup.status': 'NOT_ASSIGNED', 'reverseBooking.trackingRank': 0, 'reverseBooking.events': [], 'reverseBooking.state': 'creating', 'reverseBooking.step': 'create', 'reverseBooking.operationToken': token, 'reverseBooking.reference': payload.order_id,
      'reverseBooking.environment': environment, 'reverseBooking.dispatchedAt': new Date(), 'reverseBooking.attemptedAt': new Date(), 'reverseBooking.package': { length: payload.length, breadth: payload.breadth, height: payload.height, weight: payload.weight } },
    $unset: { 'reverseBooking.orderId': 1, 'reverseBooking.shipmentId': 1, 'reverseBooking.error': 1, 'reverseBooking.trackingState': 1, 'reverseBooking.deliveredAt': 1, awbNumber: 1, trackingUrl: 1, reverseShipmentId: 1, pickupScheduledAt: 1 },
    $inc: { 'reverseBooking.attemptCount': 1 },
    $push: { history: { toStatus: ret.status, changedByRole: 'seller', comment: 'Seller selected Shiprocket reverse pickup' } },
  }, { returnDocument: 'after' });
  if (!claimed) throw httpError(409, 'Pickup already claimed; reload the return');
  try {
    const response = await provider.createReverseOrder(payload);
    if (!identity(response?.order_id) || !identity(response?.shipment_id)) throw new Error('Provider did not return valid booking identifiers');
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token }, { $set: { 'reverseBooking.orderId': String(response.order_id), 'reverseBooking.shipmentId': String(response.shipment_id), reverseShipmentId: String(response.shipment_id), 'reverseBooking.providerStatus': String(response.status || ''), 'reverseBooking.step': 'awb' } });
    const awb = await provider.assignCourier(response.shipment_id, undefined, { isReturn: true });
    if (!awb?.awb) throw new Error('Provider did not return an AWB');
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token }, { $set: { awbNumber: awb.awb, ...(awb.courier_name ? { courierName: awb.courier_name } : {}), ...(safeTrackingUrl(awb.tracking_url) ? { trackingUrl: awb.tracking_url } : {}), 'reverseBooking.step': 'schedule' } });
    const pickup = await provider.schedulePickup(response.shipment_id);
    if (Number(pickup?.pickup_status) !== 1) throw new Error('Provider has not confirmed pickup scheduling');
    // Webhooks may arrive while scheduling is in flight. Never overwrite a newer scan.
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token, 'reverseBooking.trackingRank': { $lt: 1 } }, { $set: { 'reverseBooking.trackingState': 'SCHEDULED', 'reverseBooking.trackingRank': 1 } });
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token, 'reverseBooking.state': { $nin: ['cancelled', 'cancel_pending'] } }, { $set: { 'reverseBooking.state': 'booked', 'reverseBooking.step': 'scheduled',
      ...(pickup.response?.pickup_scheduled_date && Number.isFinite(Date.parse(pickup.response.pickup_scheduled_date)) ? { pickupScheduledAt: new Date(pickup.response.pickup_scheduled_date) } : {}) }, $unset: { 'reverseBooking.operationToken': 1, 'reverseBooking.error': 1 } });
  } catch (error) {
    // Even a 4xx may follow partial provider work. Never automatically dispatch again.
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token, 'reverseBooking.trackingRank': { $lt: 1 } }, { $set: { 'reverseBooking.state': 'uncertain', 'reverseBooking.error': 'Provider outcome requires reconciliation. Refresh tracking; do not create another pickup.' }, $unset: { 'reverseBooking.operationToken': 1 } });
    await Return.updateOne({ _id: returnId, 'reverseBooking.operationToken': token }, { $unset: { 'reverseBooking.operationToken': 1 } });
    throw httpError(409, 'Shiprocket outcome is uncertain; reconcile the existing booking before retrying');
  }
  return Return.findById(returnId);
};

const safeTrackingUrl = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const trackingStates = { 1: ['AWB_ASSIGNED', 0], 3: ['SCHEDULED', 1], 4: ['SCHEDULED', 1], 15: ['SCHEDULED', 1], 19: ['OUT_FOR_PICKUP', 1], 13: ['PICKUP_FAILED', 1], 20: ['PICKUP_FAILED', 1], 42: ['COLLECTED', 2], 6: ['IN_TRANSIT', 3], 18: ['IN_TRANSIT', 3], 17: ['OUT_FOR_DELIVERY', 4], 7: ['DELIVERED', 5], 8: ['CANCELLED', 5], 45: ['CANCELLED', 5], 12: ['LOST', 5], 24: ['DESTROYED', 5], 25: ['DAMAGED', 5] };

// Called only behind authenticated webhook handling or an authenticated provider GET.
export const applyReverseTracking = async ({ shipmentId, awb, statusId, status, eventId, environment }) => {
  const mapped = trackingStates[Number(statusId)];
  if (!mapped || (!shipmentId && !awb)) return { matched: false, changed: false };
  const result = await financialTransaction(async session => {
    const ret = await Return.findOne({ pickupMethod: 'SHIPROCKET', 'reverseBooking.environment': environment, ...(shipmentId ? { 'reverseBooking.shipmentId': String(shipmentId) } : { awbNumber: String(awb) }) }).session(session);
    if (!ret) return { matched: false, changed: false };
    if (awb && ret.awbNumber && String(awb) !== ret.awbNumber || shipmentId && String(shipmentId) !== ret.reverseBooking.shipmentId) throw httpError(400, 'Reverse shipment identity mismatch');
    const key = eventId || crypto.createHash('sha256').update(`${shipmentId}:${awb}:${statusId}:${status}`).digest('hex');
    if (ret.reverseBooking.events.some(row => row.key === key)) return { matched: true, changed: false };
    const [state, rank] = mapped;
    // Terminal success cannot be undone by late scans or cancellation requests.
    if (ret.reverseBooking.trackingRank === 5 || rank < ret.reverseBooking.trackingRank || state === 'CANCELLED' && ret.reverseBooking.trackingRank >= 2) return { matched: true, changed: false };
    ret.reverseBooking.events.push({ key, status: String(status || state), at: new Date() });
    ret.reverseBooking.trackingState = state; ret.reverseBooking.trackingRank = rank;
    ret.reverseBooking.providerStatus = String(status || state);
    if (awb) ret.awbNumber = String(awb);
    if (state === 'CANCELLED') {
      ret.reverseBooking.state = 'cancelled'; ret.pickup.status = 'CANCELLED';
      ret.history.push({ toStatus: ret.status, changedByRole: 'system', comment: `Provider confirmed cancellation: reference ${ret.reverseBooking.reference}, order ${ret.reverseBooking.orderId}, shipment ${ret.reverseBooking.shipmentId}, AWB ${ret.awbNumber || 'not assigned'}` });
    }
    else if (rank >= 1 && ret.reverseBooking.state !== 'cancel_pending') { ret.reverseBooking.state = 'booked'; ret.reverseBooking.error = undefined; }
    if (['COLLECTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(state) && !ret.pickedUpAt) ret.pickedUpAt = new Date();
    if (state === 'DELIVERED') ret.reverseBooking.deliveredAt = new Date();
    await ret.save({ session });
    return { matched: true, changed: true, sellerId: ret.sellerId, returnId: ret._id, delivered: state === 'DELIVERED' };
  });
  if (result.delivered) notifySeller(result.sellerId, { event: NOTIFICATION_EVENT.RETURN_DELIVERED_TO_SELLER, title: 'Courier return delivered', message: 'Confirm physical receipt of the returned package before inspection.', route: '/seller/returns', metadata: { returnId: result.returnId } }).catch(() => {});
  return result;
};

export const reconcileReturnCourier = async ({ returnId, sellerId }) => {
  let { ret } = await ownership(returnId, sellerId);
  if (ret.pickupMethod !== 'SHIPROCKET') throw httpError(409, 'Return has no courier booking');
  const environment = await provider.prepareReverseClient();
  if (environment !== ret.reverseBooking.environment) throw httpError(409, 'Provider environment does not match the booking');
  if (ret.reverseBooking.operationToken && Date.now() - new Date(ret.reverseBooking.attemptedAt).getTime() < 300000) throw httpError(409, 'Pickup operation is still running');
  if (!ret.reverseBooking.shipmentId) {
    const found = await provider.findReverseOrders(ret.reverseBooking.reference);
    if (found.length !== 1 || !identity(found[0].id)) throw httpError(409, 'No unique provider booking found; uncertainty remains and rebooking is blocked');
    const detail = await provider.getReverseOrder(found[0].id);
    const shipments = Array.isArray(detail?.shipments) ? detail.shipments : detail?.shipments ? [detail.shipments] : [];
    if (String(detail?.channel_order_id) !== ret.reverseBooking.reference || shipments.length !== 1 || !identity(shipments[0].id)) throw httpError(409, 'Provider return identity requires manual reconciliation');
    ret = await Return.findOneAndUpdate({ _id: returnId, 'reverseBooking.reference': ret.reverseBooking.reference, 'reverseBooking.shipmentId': { $exists: false } }, { $set: { 'reverseBooking.orderId': String(detail.id), 'reverseBooking.shipmentId': String(shipments[0].id), reverseShipmentId: String(shipments[0].id), ...(shipments[0].awb ? { awbNumber: String(shipments[0].awb) } : {}) } }, { returnDocument: 'after' }) || await Return.findById(returnId);
  }
  const data = await provider.trackReverseShipment(ret.reverseBooking.shipmentId);
  const tracking = data?.tracking_data;
  const track = tracking?.shipment_track?.find(row => String(row.shipment_id) === ret.reverseBooking.shipmentId);
  if (!track) throw httpError(409, 'Provider has not supplied matching tracking evidence; resolve in Shiprocket and refresh');
  await applyReverseTracking({ shipmentId: ret.reverseBooking.shipmentId, awb: track.awb_code, statusId: tracking.shipment_status, status: track.current_status, environment });
  return Return.findById(returnId);
};

export const cancelReturnCourier = async ({ returnId, sellerId }) => {
  const { ret } = await ownership(returnId, sellerId);
  if (!ready.includes(ret.status) || ret.pickupMethod !== 'SHIPROCKET' || ret.reverseBooking.state !== 'booked' || ret.reverseBooking.trackingRank >= 2 || !ret.reverseBooking.orderId) throw httpError(409, 'Only a confirmed, uncollected courier booking can be cancelled');
  const environment = await provider.prepareReverseClient();
  if (environment !== ret.reverseBooking.environment) throw httpError(409, 'Provider environment mismatch');
  const claimed = await Return.updateOne({ _id: returnId, 'reverseBooking.state': 'booked', 'reverseBooking.trackingRank': { $lt: 2 } }, { $set: { 'reverseBooking.state': 'cancel_pending' }, $push: { history: { toStatus: ret.status, changedByRole: 'seller', comment: 'Courier cancellation requested; awaiting provider confirmation' } } });
  if (!claimed.modifiedCount) throw httpError(409, 'Courier booking changed');
  try { await provider.cancelReverseOrder(ret.reverseBooking.orderId); }
  catch { throw httpError(409, 'Cancellation outcome uncertain; refresh tracking before changing pickup method'); }
  return Return.findById(returnId); // An acknowledgement is not cancellation evidence.
};
