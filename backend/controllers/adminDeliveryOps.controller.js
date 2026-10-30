import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, paginated, getPagination, httpError } from '../utils/response.js';
import { distanceKm } from '../utils/geo.js';
import { paymentAllowsFulfilment } from '../services/orderPaymentEligibility.service.js';
import { toCsv } from '../services/adminReports.service.js';

/**
 * Delivery Fleet operations — Live Dispatch, Active Deliveries, Delivery
 * Tracking and Completed Deliveries.
 *
 * Read-only views over the records dispatch already writes: Delivery trips
 * (one per rider leg, status moved by the rider app) and internal-delivery
 * Orders waiting at `dispatched`. Nothing here changes a trip; reassignment
 * stays in deliveryAssignment.controller.js, which owns its safety checks.
 */

// A trip is live until the rider finishes it, fails it, or steps back (rejected).
export const ACTIVE_TRIP_STATUSES = ['assigned', 'accepted', 'arrived_at_store', 'picked_up', 'in_transit', 'arrived_at_customer'];
// Before pickup the order can still be handed to another rider (see assignDeliveryPartner).
const PRE_PICKUP_STATUSES = ['assigned', 'accepted', 'arrived_at_store'];
const FINISHED_STATUSES = ['delivered', 'failed'];
const TRIP_LIMIT = 200, EXPORT_LIMIT = 50000;
const IST_MS = 5.5 * 3600 * 1000;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const istDayStart = (now) => { const d = new Date(now + IST_MS); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MS); };
const minutesSince = (date, now) => (date ? Math.max(0, Math.round((now - new Date(date).getTime()) / 60000)) : null);
const textParam = (query, key, max = 80) => {
  const value = query[key];
  if (value === undefined) return '';
  if (typeof value !== 'string') throw httpError(400, `Invalid ${key}`);
  if (value.trim().length > max) throw httpError(400, `${key} must be at most ${max} characters`);
  return value.trim();
};
const tripRef = (trip) => trip.orderId?.orderNo
  || trip.returnId?.returnNumber
  || (trip.subscriptionId ? `SUB-${String(trip.subscriptionId).slice(-6).toUpperCase()}` : String(trip._id).slice(-8).toUpperCase());
const tripKind = (trip) => (trip.direction === 'return_pickup' ? 'return_pickup' : trip.subscriptionId ? 'subscription' : 'order');
const partnerPopulate = { path: 'partnerId', select: 'userId vehicleType', populate: { path: 'userId', select: 'name phone' } };
const orderPopulate = { path: 'orderId', select: 'orderNo type status deliveryType userId shippingAddress.name', populate: { path: 'userId', select: 'name phone' } };
const returnPopulate = { path: 'returnId', select: 'returnNumber customerId', populate: { path: 'customerId', select: 'name phone' } };
const customerOf = (trip) => trip.orderId?.shippingAddress?.name || trip.orderId?.userId?.name || trip.returnId?.customerId?.name
  || trip.orderId?.userId?.phone || trip.returnId?.customerId?.phone || 'Customer';

/**
 * Live dispatch board.
 *
 * @route GET /api/admin/delivery-live?stage=&search=&overEta=true
 *
 * `summary` always describes every live trip, so the counts don't shift as the
 * table is filtered. "Past ETA" means the rider picked the parcel up longer ago
 * than the trip's own estimate (straight-line distance at city pace, written
 * when the trip was accepted). Trips without that estimate are never flagged:
 * there is no platform SLA to compare them with.
 */
export const getLiveDispatch = asyncHandler(async (req, res) => {
  const stage = textParam(req.query, 'stage') || 'all';
  const search = textParam(req.query, 'search');
  const overEtaOnly = textParam(req.query, 'overEta') === 'true';
  if (stage !== 'all' && !ACTIVE_TRIP_STATUSES.includes(stage)) throw httpError(400, 'Unsupported delivery stage');

  const now = Date.now();
  const todayStart = istDayStart(now);
  const [trips, finishedToday, online, dispatched] = await Promise.all([
    Delivery.find({ status: { $in: ACTIVE_TRIP_STATUSES } })
      .select('orderId subscriptionId returnId direction partnerId status pickupLocation dropLocation route startTime partnerLocation createdAt')
      .sort({ createdAt: 1 })
      .populate(partnerPopulate).populate(orderPopulate).populate(returnPopulate)
      .lean(),
    Delivery.aggregate([
      // Bug #193: some trips reach a finished status without endTime being written.
      // Fall back to updatedAt so deliveredToday / failedToday counts are accurate.
      {
        $match: {
          status: { $in: FINISHED_STATUSES },
          $or: [{ endTime: { $gte: todayStart } }, { updatedAt: { $gte: todayStart } }],
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    DeliveryPartner.find({ status: 'approved', isAvailable: true }).select('_id').lean(),
    Order.find({ deliveryType: 'internal', status: 'dispatched' }).select('paymentMethod paymentId needsManualAssignment').lean(),
  ]);

  const rows = trips.map((trip) => {
    const pickedUp = !PRE_PICKUP_STATUSES.includes(trip.status);
    const etaMinutes = Number.isFinite(trip.route?.durationMin) && trip.route.durationMin > 0 ? Math.round(trip.route.durationMin) : null;
    const minutesSincePickup = pickedUp ? minutesSince(trip.startTime, now) : null;
    const remaining = pickedUp ? distanceKm(trip.partnerLocation, trip.dropLocation) : undefined;
    const kind = tripKind(trip);
    return {
      id: String(trip._id),
      ref: tripRef(trip),
      kind,
      channel: trip.orderId?.type || null,
      customer: customerOf(trip),
      rider: { id: trip.partnerId?._id ? String(trip.partnerId._id) : null, name: trip.partnerId?.userId?.name || trip.partnerId?.userId?.phone || 'Rider', phone: trip.partnerId?.userId?.phone || null, vehicle: trip.partnerId?.vehicleType || null },
      stage: trip.status,
      pickedUp,
      assignedAt: trip.createdAt,
      pickedUpAt: trip.startTime || null,
      minutesSinceAssigned: minutesSince(trip.createdAt, now),
      minutesSincePickup,
      etaMinutes,
      overEta: minutesSincePickup !== null && etaMinutes !== null ? minutesSincePickup > etaMinutes : null,
      routeKm: Number.isFinite(trip.route?.distanceKm) ? trip.route.distanceKm : null,
      remainingKm: remaining === undefined ? null : remaining,
      lastPingAt: trip.partnerLocation?.updatedAt || null,
      lastPingMinutes: minutesSince(trip.partnerLocation?.updatedAt, now),
      pickupAddress: trip.pickupLocation?.address || null,
      dropAddress: trip.dropLocation?.address || null,
      // Mirrors assignDeliveryPartner's own preconditions, so the button only
      // appears where the assignment board would accept a new rider.
      reassignable: kind === 'order' && !pickedUp && trip.orderId?.status === 'dispatched' && trip.orderId?.deliveryType === 'internal',
    };
  });

  // Orders waiting for a rider: internal, dispatched, payment secured, no live trip.
  const liveOrderIds = new Set(trips.map((trip) => String(trip.orderId?._id || '')).filter(Boolean));
  const waiting = dispatched.filter((order) => !liveOrderIds.has(String(order._id)));
  const paymentIds = waiting.filter((order) => order.paymentMethod !== 'cod' && order.paymentId).map((order) => order.paymentId);
  const payments = new Map((await Payment.find({ _id: { $in: paymentIds } }).select('status').lean()).map((p) => [String(p._id), p]));
  const awaiting = waiting.filter((order) => paymentAllowsFulfilment(order, payments.get(String(order.paymentId))));

  const byStage = Object.fromEntries(ACTIVE_TRIP_STATUSES.map((status) => [status, 0]));
  for (const row of rows) byStage[row.stage] += 1;
  const busy = new Set(rows.map((row) => row.rider.id).filter(Boolean));
  const onlineIds = online.map((p) => String(p._id));
  const deliveredToday = finishedToday.find((r) => r._id === 'delivered')?.count || 0;
  const failedToday = finishedToday.find((r) => r._id === 'failed')?.count || 0;

  let list = rows;
  if (stage !== 'all') list = list.filter((row) => row.stage === stage);
  if (overEtaOnly) list = list.filter((row) => row.overEta === true);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const digits = search.replace(/\D/g, '');
    list = list.filter((row) => rx.test(row.ref) || rx.test(row.customer) || rx.test(row.rider.name) || (digits.length >= 4 && String(row.rider.phone || '').includes(digits)));
  }

  return ok(res, {
    asOf: new Date(now).toISOString(),
    summary: {
      activeTrips: rows.length,
      byStage,
      prePickup: rows.filter((row) => !row.pickedUp).length,
      onTheRoad: rows.filter((row) => row.pickedUp).length,
      overEta: rows.filter((row) => row.overEta === true).length,
      awaitingRider: awaiting.length,
      needsManualAssignment: awaiting.filter((order) => order.needsManualAssignment).length,
      ridersOnline: onlineIds.length,
      ridersBusy: busy.size,
      ridersFree: onlineIds.filter((id) => !busy.has(id)).length,
      deliveredToday,
      failedToday,
      todaySuccessRate: deliveredToday + failedToday ? Math.round((deliveredToday / (deliveredToday + failedToday)) * 1000) / 10 : null,
    },
    trips: list.slice(0, TRIP_LIMIT),
    meta: { total: list.length, shown: Math.min(list.length, TRIP_LIMIT), truncated: list.length > TRIP_LIMIT },
  }, 'Live dispatch');
});

/* ---- Completed Deliveries -------------------------------------------------- */

/**
 * Search is resolved to ids first (customers and riders by name or phone,
 * orders by number), so it filters the whole history before paginating rather
 * than only the page that happened to be fetched.
 */
async function historyFilter(query) {
  const status = textParam(query, 'status') || 'all';
  const search = textParam(query, 'search');
  if (status !== 'all' && !FINISHED_STATUSES.includes(status)) throw httpError(400, 'Status must be delivered or failed');
  const filter = { status: status === 'all' ? { $in: FINISHED_STATUSES } : status };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const userIds = (await User.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').lean()).map((u) => u._id);
    const [orders, partners] = await Promise.all([
      Order.find({ $or: [{ orderNo: rx }, { userId: { $in: userIds } }] }).select('_id').lean(),
      DeliveryPartner.find({ userId: { $in: userIds } }).select('_id').lean(),
    ]);
    filter.$or = [{ orderId: { $in: orders.map((o) => o._id) } }, { partnerId: { $in: partners.map((p) => p._id) } }];
  }
  return filter;
}

const historyRow = (trip) => ({
  id: tripRef(trip),
  kind: tripKind(trip),
  partner: trip.partnerId?.userId?.name || trip.partnerId?.userId?.phone || 'Rider',
  customer: customerOf(trip),
  assignedAt: trip.createdAt,
  pickedUpAt: trip.startTime || null,
  deliveredAt: trip.endTime || trip.updatedAt,
  durationMin: trip.startTime && trip.endTime ? Math.round((new Date(trip.endTime) - new Date(trip.startTime)) / 60000) : null,
  otpVerified: trip.otpVerified,
  status: trip.status,
});
const historyQuery = (filter) => Delivery.find(filter)
  .select('orderId subscriptionId returnId direction partnerId status startTime endTime createdAt updatedAt otpVerified')
  .sort({ endTime: -1, updatedAt: -1, _id: -1 })
  .populate(partnerPopulate).populate(orderPopulate).populate(returnPopulate);

// @route GET /api/admin/delivery-history?status=&search=&page=&limit=
export const getDeliveryHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = await historyFilter(req.query);
  const [trips, total] = await Promise.all([historyQuery(filter).skip(skip).limit(limit).lean(), Delivery.countDocuments(filter)]);
  return paginated(res, trips.map(historyRow), { page, limit, total });
});

const istDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

// @route GET /api/admin/delivery-history/export?status=&search=
export const exportDeliveryHistory = asyncHandler(async (req, res) => {
  const filter = await historyFilter(req.query);
  const total = await Delivery.countDocuments(filter);
  if (total > EXPORT_LIMIT) throw httpError(400, `This export has ${total} trips; narrow it with a search or status (limit ${EXPORT_LIMIT}).`);
  const rows = (await historyQuery(filter).lean()).map(historyRow);
  const csv = toCsv(
    ['Order ref', 'Trip type', 'Delivery partner', 'Customer', 'Assigned (IST)', 'Picked up (IST)', 'Finished (IST)', 'Trip duration (min)', 'OTP verified', 'Status'],
    rows.map((r) => [r.id, r.kind.replace('_', ' '), r.partner, r.customer, istDateTime(r.assignedAt), istDateTime(r.pickedUpAt), istDateTime(r.deliveredAt), r.durationMin, r.status === 'delivered' ? (r.otpVerified ? 'Yes' : 'No') : '', r.status]),
  );
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="bulkimart-delivery-history-${new Date(Date.now() + IST_MS).toISOString().slice(0, 10)}.csv"`);
  return res.send(`﻿${csv}`);
});
