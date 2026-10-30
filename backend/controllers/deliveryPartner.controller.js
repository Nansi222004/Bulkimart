import { riderIneligibility, riderPickupPosition } from '../services/riderEligibility.service.js';
import { storePickup, requireOrderPickup, orderStoreId, pickupCoordinates } from '../services/storePickup.service.js';
import mongoose from 'mongoose';
import DeliveryPartner from '../models/DeliveryPartner.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import Parcel from '../models/ParcelDelivery.js';
import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import { orderPaymentReady } from '../services/orderPaymentEligibility.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated, getPagination } from '../utils/response.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { VENDOR_STATUS, CHANNEL, CHANNELS, riderClaimableStatuses, OFFER_ATTEMPT_STATUS } from '../constants/enums.js';
import { parseLocation, hasUsableLocation, distanceKm, etaMinutes } from '../utils/geo.js';
import { riderPayout, payoutModeOf, rateSnapshotFor } from '../services/riderPay.service.js';
import { canTakeAnother, maxConcurrentDeliveries } from '../services/riderCapacity.service.js';
import { riderCashAllowsOrder } from '../services/riderCashEligibility.service.js';
import { notifyUser, notifySeller, notifyRider, notifyAllAdmins, NOTIFICATION_EVENT } from '../services/notification.service.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import { requestVerifiedRiderPayout, riderFinancialSummary } from '../services/deliveryPayout.service.js';
import { recordDeliveryEarning, recordCodEvent } from '../services/orderFinance.service.js';
import { DELIVERY_PAYOUT_STATUS, DELIVERY_MIN_PAYOUT_AMOUNT } from '../constants/enums.js';
import { normalizeRiderDocument, vehicleNumberError, drivingLicenceError } from '../shared/riderDocuments.mjs';

/**
 * Delivery partner onboarding — three steps, then an admin verifies by hand.
 *
 * A rider carries other people's goods and, on COD orders, other people's cash.
 * Nothing about the rider app unlocks until an admin has actually looked at the
 * licence and the Aadhaar, so registering grants no role and no access on its
 * own (see middlewares/vendor.middleware.js requireApprovedPartner).
 *
 * The status flow mirrors sellers:
 *   incomplete → pending → approved | rejected → suspended
 */

const findMine = async (userId) => DeliveryPartner.findOne({ userId });

const requireProfile = async (userId) => {
  const partner = await findMine(userId);
  if (!partner) throw httpError(404, 'Start your rider registration first');
  return partner;
};

/** Editing after submission would let a rider swap documents post-approval. */
const assertEditable = (partner) => {
  if ([VENDOR_STATUS.APPROVED, VENDOR_STATUS.SUSPENDED].includes(partner.status)) {
    throw httpError(400, 'Your details are locked. Contact support to change them.');
  }
};

// @desc    Begin rider registration
// @route   POST /api/delivery/start
// @access  Private
export const startOnboarding = asyncHandler(async (req, res) => {
  let partner = await findMine(req.user._id);

  if (!partner) {
    partner = await DeliveryPartner.create({
      userId: req.user._id,
      onboardingStep: 1,
      status: VENDOR_STATUS.INCOMPLETE,
    });
  }

  // The rider's name lives on the User, not the partner: it is the same person
  // whether they are shopping or delivering, and duplicating it guarantees the
  // two copies eventually disagree.
  const set = { deliveryPartnerId: partner._id };
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name) {
    if (name.length < 2) throw httpError(400, 'Please enter your full name');
    set.name = name;
  }

  // Link the profile only. The 'delivery' role — which is what unlocks the
  // rider app — is granted on admin approval, never at registration.
  await User.updateOne({ _id: req.user._id }, { $set: set });

  return ok(res, partner, 'Registration started');
});

// @desc    Step 1 — vehicle and driving licence
// @route   PUT /api/delivery/step/1
// @access  Private
export const submitStep1 = asyncHandler(async (req, res) => {
  const partner = await requireProfile(req.user._id);
  assertEditable(partner);

  const { vehicleType, vehicleNo, licenseNo, licenseExpiry } = req.body;
  if (!vehicleType) throw httpError(400, 'Please select your vehicle type');
  if (!['bicycle', 'bike', 'auto', 'car'].includes(vehicleType)) {
    throw httpError(400, 'Vehicle type must be bicycle, bike, auto or car');
  }
  const vehicleProblem = vehicleNumberError(vehicleNo, vehicleType);
  if (vehicleProblem) throw httpError(400, vehicleProblem);

  /**
   * A bicycle needs no licence — not a number, and not a photograph.
   *
   * This used to demand a licence number from everyone while excusing only the
   * photo, which no bicycle rider could satisfy: they have nothing to type. The
   * two rules now agree.
   */
  const needsLicence = vehicleType !== 'bicycle';
  if (needsLicence) {
    const licenceProblem = drivingLicenceError(licenseNo);
    if (licenceProblem) throw httpError(400, licenceProblem);
    if (!req.file && !partner.drivingLicense?.url) {
      throw httpError(400, 'Please upload a photo of your driving licence');
    }
  }

  if (licenseExpiry) {
    const expiry = new Date(licenseExpiry);
    if (Number.isNaN(expiry.getTime())) throw httpError(400, 'Licence expiry date is not valid');
    if (expiry < new Date()) throw httpError(400, 'That licence has already expired');
  }

  const url = req.file
    ? await uploadToCloudinary(req.file.buffer, `delivery-kyc/${req.user._id}`)
    : partner.drivingLicense?.url;

  partner.vehicleType = vehicleType;
  partner.vehicleNo = normalizeRiderDocument(vehicleNo);
  // Switching to a bicycle clears the licence rather than leaving one attached
  // to a vehicle that does not need it.
  partner.drivingLicense = needsLicence
    ? {
        no: normalizeRiderDocument(licenseNo),
        url,
        expiryDate: licenseExpiry || partner.drivingLicense?.expiryDate,
      }
    : undefined;
  if (partner.onboardingStep < 2) partner.onboardingStep = 2;

  await partner.save();
  return ok(res, partner, 'Vehicle details saved');
});

// @desc    Step 2 — Aadhaar
// @route   PUT /api/delivery/step/2
// @access  Private
export const submitStep2 = asyncHandler(async (req, res) => {
  const partner = await requireProfile(req.user._id);
  assertEditable(partner);

  const { aadhaarNumber } = req.body;
  if (!aadhaarNumber) throw httpError(400, 'Please provide your Aadhaar number');
  if (!/^\d{12}$/.test(String(aadhaarNumber).replace(/\s/g, ''))) {
    throw httpError(400, 'An Aadhaar number is 12 digits');
  }
  if (!req.files?.aadhaarFront || !req.files?.aadhaarBack) {
    throw httpError(400, 'Please upload both the front and back of your Aadhaar');
  }

  const [frontUrl, backUrl] = await Promise.all([
    uploadToCloudinary(req.files.aadhaarFront[0].buffer, `delivery-kyc/${req.user._id}`),
    uploadToCloudinary(req.files.aadhaarBack[0].buffer, `delivery-kyc/${req.user._id}`),
  ]);

  // Only the last four digits are kept — the full number is never stored.
  partner.aadhaar = {
    number: `XXXX-XXXX-${String(aadhaarNumber).slice(-4)}`,
    frontUrl,
    backUrl,
  };
  if (partner.onboardingStep < 3) partner.onboardingStep = 3;

  await partner.save();
  return ok(res, partner, 'Identity documents uploaded');
});

// @desc    Step 3 — service area and payout account
// @route   PUT /api/delivery/step/3
// @access  Private
export const submitStep3 = asyncHandler(async (req, res) => {
  const partner = await requireProfile(req.user._id);
  assertEditable(partner);

  const { zones, accountNo, ifsc, holderName, bankName, upiId } = req.body;

  const list = Array.isArray(zones)
    ? zones
    : String(zones || '').split(',').map((z) => z.trim()).filter(Boolean);

  if (list.length === 0) throw httpError(400, 'Add at least one pincode you can deliver to');
  const bad = list.find((z) => !/^\d{6}$/.test(z));
  if (bad) throw httpError(400, `"${bad}" is not a valid 6-digit pincode`);

  if (!accountNo || !ifsc || !holderName || !bankName) {
    throw httpError(400, 'Bank account details are required so we can pay you');
  }
  if (!/^\d{6,18}$/.test(String(accountNo))) {
    throw httpError(400, 'Bank account number must contain 6 to 18 digits');
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc).trim().toUpperCase())) {
    throw httpError(400, 'Please provide a valid 11-character IFSC code');
  }
  if (String(holderName).trim().length < 2) throw httpError(400, 'Please provide the account holder name');
  if (String(bankName).trim().length < 2) throw httpError(400, 'Please provide the bank name');
  if (upiId && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/.test(String(upiId).trim())) {
    throw httpError(400, 'Please provide a valid UPI ID');
  }

  // Where the rider is based. Two ways in, and both are legitimate:
  //   - the GPS button filled lat/lng for them
  //   - they typed an address, because they denied location permission,
  //     are indoors with no fix, or are registering from somewhere else
  // Requiring both would lock out anyone who says no to the permission prompt,
  // so either route is enough on its own.
  const parsed = parseLocation(req.body);
  if (!parsed.ok) throw httpError(400, parsed.message);

  const loc = parsed.location;
  const hasCoords = loc.lat !== undefined && loc.lng !== undefined;
  if (!hasCoords && !(loc.address && loc.pincode)) {
    throw httpError(400, 'Share your current location, or type your address with a 6-digit pincode');
  }

  const passbookUrl = req.file
    ? await uploadToCloudinary(req.file.buffer, `delivery-bank/${req.user._id}`)
    : partner.bankDetails?.passbookUrl;
  if (!passbookUrl) throw httpError(400, 'Please upload a passbook page or cancelled cheque');

  partner.zones = [...new Set(list)];
  // Merge, so a rider editing only their bank details does not blank the
  // coordinates the GPS captured on an earlier pass.
  partner.baseLocation = { ...(partner.baseLocation?.toObject?.() ?? partner.baseLocation ?? {}), ...loc };
  if (loc.lat !== undefined && loc.lng !== undefined) {
    partner.currentLocation = { lat: loc.lat, lng: loc.lng, updatedAt: new Date() };
  }

  const radiusRaw = req.body.deliveryRadiusKm ?? req.body.deliveryRadius ?? req.body.radius;
  if (radiusRaw !== undefined && radiusRaw !== null && radiusRaw !== '') {
    const r = Number(radiusRaw);
    if (Number.isFinite(r) && r > 0) {
      partner.deliveryRadiusKm = r;
    }
  }

  partner.bankDetails = {
    accountNo: String(accountNo),
    ifsc: String(ifsc).trim().toUpperCase(),
    holderName: String(holderName).trim(),
    bankName: String(bankName).trim(),
    upiId: upiId ? String(upiId).trim() : undefined,
    passbookUrl,
  };
  if (partner.onboardingStep < 4) partner.onboardingStep = 4;

  await partner.save();
  return ok(res, partner, 'Service area, radius and payout details saved');
});

// @desc    Submit for admin verification
// @route   POST /api/delivery/submit
// @access  Private
export const submitApplication = asyncHandler(async (req, res) => {
  const partner = await requireProfile(req.user._id);

  if (partner.status === VENDOR_STATUS.APPROVED) {
    throw httpError(400, 'Your account is already approved');
  }
  if (partner.status === VENDOR_STATUS.PENDING) {
    throw httpError(400, 'Your application is already awaiting verification');
  }
  if (partner.onboardingStep < 4) {
    throw httpError(400, 'Please complete all registration steps first');
  }

  // Re-check the documents actually exist — a step could have been skipped by
  // calling the API directly.
  const missing = [];
  if (!partner.vehicleType || !partner.vehicleNo) missing.push('vehicle details');
  if (partner.vehicleType !== 'bicycle' && !partner.drivingLicense?.url) missing.push('driving licence');
  if (!partner.aadhaar?.frontUrl || !partner.aadhaar?.backUrl) missing.push('Aadhaar documents');
  if (!partner.zones?.length) missing.push('service pincodes');
  if (!partner.bankDetails?.accountNo) missing.push('bank account');
  if (!partner.bankDetails?.passbookUrl) missing.push('payout document');
  if (!hasUsableLocation(partner.baseLocation)) missing.push('your base location');
  if (missing.length) throw httpError(400, `Still missing: ${missing.join(', ')}`);

  partner.status = VENDOR_STATUS.PENDING;
  partner.rejectionReason = undefined;
  await partner.save();

  return ok(res, { status: partner.status }, 'Application submitted for verification');
});

// @desc    My rider profile and application status
// @route   GET /api/delivery/me
// @access  Private
export const getMyProfile = asyncHandler(async (req, res) => {
  const partner = await findMine(req.user._id);
  if (!partner) throw httpError(404, 'Rider profile not found');

  // The name and phone are on the User record, but every screen that shows a
  // rider needs them next to the partner data, so send them together.
  return ok(res, {
    ...partner.toObject(),
    finance: await riderFinancialSummary(partner),
    name: req.user.name,
    phone: req.user.phone,
  });
});

// Operational coverage can change after approval without replacing verified KYC.
export const updateServiceArea = asyncHandler(async (req, res) => {
  if (req.userType !== 'user') throw httpError(403, 'Rider account required');
  const input = req.body;
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['zones', 'version'].includes(key))) {
    throw httpError(400, 'Only delivery pincodes and profile version can be updated here');
  }
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw httpError(400, 'Refresh your profile before saving');
  if (typeof input.zones !== 'string' && !Array.isArray(input.zones)) throw httpError(400, 'Add at least one delivery pincode');
  const entries = typeof input.zones === 'string' ? input.zones.split(',') : input.zones;
  if (entries.some(value => typeof value !== 'string')) throw httpError(400, 'Enter 6-digit pincodes separated by commas');
  const zones = [...new Set(entries.map(value => value.trim()).filter(Boolean))];
  if (!zones.length || zones.length > 50 || zones.some(value => !/^\d{6}$/.test(value))) {
    throw httpError(400, 'Enter 1 to 50 valid 6-digit delivery pincodes');
  }
  const partner = await DeliveryPartner.findOneAndUpdate(
    { userId: req.user._id, __v: input.version },
    { $set: { zones }, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).select('zones __v');
  if (!partner) {
    await requireProfile(req.user._id);
    throw httpError(409, 'Your profile changed. Reload the saved service area before trying again.');
  }
  return ok(res, { zones: partner.zones, version: partner.__v }, 'Service area saved');
});

// Refresh live dispatch position without rewriting the rider's base address.
export const updatePresence = asyncHandler(async (req, res) => {
  if (req.userType !== 'user' || !req.user.roles?.includes('delivery')) throw httpError(403, 'Delivery account required');
  const parsed = parseLocation(req.body, { requireCoords: true });
  if (!parsed.ok) throw httpError(400, parsed.message);
  const partner = await DeliveryPartner.findOneAndUpdate(
    { userId: req.user._id, status: 'approved' },
    { $set: { currentLocation: { lat: parsed.location.lat, lng: parsed.location.lng, updatedAt: new Date() } }, $inc: { __v: 1 } },
    { returnDocument: 'after' },
  ).select('_id');
  if (!partner) throw httpError(403, 'Approved rider required');
  return ok(res, { updated: true }, 'Live location updated');
});

// @desc    Save or update where the rider is based
// @route   PUT /api/delivery/location
// @access  Private
export const updateLocation = asyncHandler(async (req, res) => {
  const partner = await requireProfile(req.user._id);

  // Deliberately not gated by assertEditable. That guard exists to stop a rider
  // swapping KYC documents after approval; a base location is operational, not
  // evidence, and a rider who moves house must be able to correct it.
  const parsed = parseLocation(req.body);
  if (!parsed.ok) throw httpError(400, parsed.message);

  const loc = parsed.location;
  if (!hasUsableLocation(loc)) {
    throw httpError(400, 'Share your current location, or type your address with a 6-digit pincode');
  }

  partner.baseLocation = { ...(partner.baseLocation?.toObject?.() ?? partner.baseLocation ?? {}), ...loc };
  if (loc.lat !== undefined && loc.lng !== undefined) {
    partner.currentLocation = { lat: loc.lat, lng: loc.lng, updatedAt: new Date() };
  }
  const radiusRaw = req.body.deliveryRadiusKm ?? req.body.deliveryRadius ?? req.body.radius;
  if (radiusRaw !== undefined && radiusRaw !== null && radiusRaw !== '') {
    const r = Number(radiusRaw);
    if (Number.isFinite(r) && r > 0) {
      partner.deliveryRadiusKm = r;
    }
  }
  await partner.save();

  return ok(res, { baseLocation: partner.baseLocation, deliveryRadiusKm: partner.deliveryRadiusKm }, 'Location and radius saved');
});

/**
 * Record one rider's response to being offered one order.
 *
 * Mirrors `pushTimeline` in order.controller.js — a small, unexported helper
 * next to the handlers that use it, not a service, because nothing outside
 * this file offers an order to a rider.
 *
 * NOT wired into broadcast/accept/decline/timeout yet. This step only adds
 * the write path; nothing calls it until a later step records an actual
 * OFFERED/DECLINED_BY_RIDER/OFFER_EXPIRED event. It only ever appends —
 * resolving an existing OFFERED attempt (decline/expire/accept) in place,
 * rather than pushing a second row for the same rider, is a decision for
 * whichever later step actually writes those transitions, once accept/
 * decline/timeout behavior itself is being changed.
 */
const pushOfferAttempt = (order, { riderId, status = OFFER_ATTEMPT_STATUS.OFFERED, reason }) => {
  order.offerAttempts.push({
    riderId,
    status,
    offeredAt: new Date(),
    ...(reason ? { reason } : {}),
  });
};

/**
 * Record that a rider was offered this order — once, no matter how many
 * times or which of the two paths (socket ping, pending-orders poll) says so.
 *
 * A separate helper from `pushOfferAttempt` above on purpose: that one
 * mutates an in-memory document the caller must then `.save()`, which fits
 * `acceptOrder`'s shape but neither call site here — `broadcastNewOrderToRiders`
 * doesn't save on its success path, and `getPendingDeliveryOrders` never
 * saves at all, being read-only. This is a single atomic `updateOne` instead.
 *
 * The dedup guard lives in the filter, not in a read-then-check: `$ne`
 * against the array matches only when this rider has *no* entry yet, of any
 * status. That covers every duplicate source at once — the same socket ping
 * landing twice, the 10s poll re-seeing an order it already recorded, a
 * retried broadcast, a reconnect — and, as a side effect, it also stops a
 * rider who already declined or expired on this order from ever being
 * recorded as offered it again.
 */
const recordOfferIfNew = (orderId, riderId) =>
  Order.updateOne(
    { _id: orderId, 'offerAttempts.riderId': { $ne: riderId } },
    { $push: { offerAttempts: { riderId, status: OFFER_ATTEMPT_STATUS.OFFERED, offeredAt: new Date() } } }
  );

/**
 * Offer a dispatched order to nearby riders.
 *
 * `attempt` widens the search each time nobody takes it. A parcel sitting on a
 * counter with no rider is the single most common way this flow stalls, and
 * before this the function simply logged "no riders available" and returned —
 * the order stayed `dispatched` for ever, with nobody watching and nothing
 * telling the shop.
 */
export const broadcastNewOrderToRiders = async (orderId, attempt = 1) => {
  const order = await Order.findById(orderId);
  if (!order) return;
  if (!await orderPaymentReady(order)) return;

  // The same list accept checks against — see constants/enums.js.
  if (!riderClaimableStatuses(order.type).includes(order.status)) return;

  // Already taken while we were widening the net.
  if (order.deliveryPartnerId) return;

  if (order.deliveryType === 'shiprocket') return;
  let sellerId;
  try { sellerId = orderStoreId(order); } catch { return; }
  const seller = await Seller.findById(sellerId);
  const storePosition = storePickup(seller);
  if (!storePosition) {
    console.warn(`[RIDER BROADCAST] ${order.orderNo}: store has no pinned location — cannot find riders`);
    return;
  }

  const { lng, lat } = storePosition;
  const baseRadius = Number(process.env.PICKUP_RADIUS_METERS) || 5000;

  // 5 km, then 10, then 15. Beyond that the trip stops being worth a rider's
  // time and it becomes a problem for a person to solve, not a wider query.
  const MAX_ATTEMPTS = 3;
  const radiusMeters = baseRadius * attempt;

  // Find approved, online, available riders within 5km radius of the store
  let riders = [];
  try {
    riders = await DeliveryPartner.find({
      status: 'approved',
      isAvailable: true,
      'baseLocation.point': {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusMeters
        }
      }
    }).limit(50);
  } catch (err) {
    console.warn(`[RIDER BROADCAST] Geo search failed: ${err.message}. Trying fallback search...`);
  }

  // Going on duty stores currentLocation, not baseLocation.point. Include riders
  // currently near the pickup even when their home pin is missing or elsewhere.
  const deltaLat = radiusMeters / 111000;
  const deltaLng = deltaLat / Math.max(0.1, Math.cos(lat * Math.PI / 180));
  const liveRiders = await DeliveryPartner.find({ status: 'approved', isAvailable: true,
    'currentLocation.lat': { $gte: lat - deltaLat, $lte: lat + deltaLat },
    'currentLocation.lng': { $gte: lng - deltaLng, $lte: lng + deltaLng },
  }).limit(50);
  riders = [...new Map([...riders, ...liveRiders].map(rider => [String(rider._id), rider])).values()]
    .filter(rider => {
      const km = distanceKm(riderPickupPosition(rider), storePosition);
      return km !== undefined && km <= radiusMeters / 1000;
    });

  /**
   * A rider's own configured radius (if they've set one) is a further cap
   * ON TOP OF the shared search radius above, never a substitute for it —
   * the $near query already bounds candidates to `radiusMeters`; this only
   * excludes a rider from THIS attempt when their own limit is smaller
   * than that. A rider with no radius configured is unaffected, exactly
   * as before this field existed.
   */
  const shopLoc = { lat, lng };
  riders = riders.filter((r) => {
    if (r.deliveryRadiusKm === undefined || r.deliveryRadiusKm === null) return true;
    const riderLoc = riderPickupPosition(r);
    const km = distanceKm(riderLoc, shopLoc);
    return km === undefined || km <= r.deliveryRadiusKm;
  });

  /**
   * The wide fallbacks below are for Quick only.
   *
   * When the geo search finds nobody, this widens to matching pincode zones and
   * then to any approved online rider in the database, with no distance check at
   * all. For Quick that is a reasonable net — better a distant rider than an
   * order nobody collects.
   *
   * A Same-Day order was sold on a promise of twenty kilometres. Reaching past
   * that to a rider in another city would keep the order moving and break the
   * thing the customer actually paid for, quietly. So for internal e-commerce
   * the geo search is the whole search: if it finds nobody, the order waits for
   * a human rather than being handed to someone who cannot make the promise.
   */
  const promisedRadius = order.type === CHANNEL.ECOM;

  // Older profiles can have valid coordinates without a GeoJSON point. Use a
  // bounded numeric-coordinate search, then exact distance, rather than listing
  // an eligible rider to the seller but silently never offering that rider work.
  if (riders.length === 0 && promisedRadius) {
    const deltaLat = radiusMeters / 111000;
    const deltaLng = deltaLat / Math.max(0.1, Math.cos(lat * Math.PI / 180));
    const legacy = await DeliveryPartner.find({ status: 'approved', isAvailable: true,
      'baseLocation.point': { $exists: false },
      'baseLocation.lat': { $gte: lat - deltaLat, $lte: lat + deltaLat },
      'baseLocation.lng': { $gte: lng - deltaLng, $lte: lng + deltaLng },
    }).limit(50);
    riders = legacy.filter(rider => {
      const km = distanceKm(riderPickupPosition(rider), storePosition);
      return km !== undefined && km <= radiusMeters / 1000;
    });
  }

  if (riders.length === 0 && !promisedRadius) {
    // Fallback 1: match by zones (pincode of seller or shipping destination)
    const storePincode = seller.storeDetails?.pincode;
    const destPincode = order.shippingAddress?.pincode;
    const orConditions = [];
    if (storePincode) orConditions.push({ zones: storePincode });
    if (destPincode) orConditions.push({ zones: destPincode });

    if (orConditions.length > 0) {
      riders = await DeliveryPartner.find({
        status: 'approved',
        isAvailable: true,
        $or: orConditions
      }).limit(50);
    }

    if (riders.length === 0) {
      // Fallback 2: grab any online approved rider in the database
      riders = await DeliveryPartner.find({
        status: 'approved',
        isAvailable: true
      }).limit(50);
    }
  }

  // Apply the same account/coverage/capacity rules shown to sellers, including
  // after Quick fallback queries. Never offer jobs to inactive user accounts.
  const operational = [];
  if (order.fulfillment?.requestedRiderId) riders = await DeliveryPartner.find({ _id: order.fulfillment.requestedRiderId, status: 'approved', isAvailable: true });
  for (const rider of riders) {
    const user = await User.findById(rider.userId).select('isActive roles');
    if (!riderIneligibility(rider, user, order, seller.storeDetails) && (await canTakeAnother(rider._id)).ok && await riderCashAllowsOrder(rider._id, order)) operational.push(rider);
  }
  riders = operational.slice(0, 5);

  if (riders.length === 0) {
    console.log(`[RIDER BROADCAST] ${order.orderNo}: nobody within ${radiusMeters}m (attempt ${attempt}/${MAX_ATTEMPTS})`);

    if (attempt < MAX_ATTEMPTS) {
      // Widen and try again shortly — riders come on shift, and one may finish
      // a delivery nearby within the next half minute.
      setTimeout(() => {
        broadcastNewOrderToRiders(orderId, attempt + 1).catch(console.error);
      }, 30 * 1000);
      return;
    }

    /**
     * Out of options. The order is not cancelled — the shop has already packed
     * it and the customer has already paid — so it is flagged for a human and
     * everyone involved is told, rather than left looking fine while nothing
     * happens.
     */
    order.needsManualAssignment = true;
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      note: `No delivery partner found within ${radiusMeters / 1000} km after ${MAX_ATTEMPTS} attempts — needs manual assignment`,
    });
    await order.save();

    try {
      const { emitToSeller, emitToUser } = await import('../socket/rooms.js');
      emitToSeller(String(seller._id), 'no_rider_found', {
        orderId: order._id,
        orderNo: order.orderNo,
        searchedKm: radiusMeters / 1000,
      });
      emitToUser(order.userId, 'delivery_delayed', {
        orderId: order._id,
        message: 'We are still finding a delivery partner for your order.',
      });
      notifySeller(String(seller._id), {
        event: NOTIFICATION_EVENT.NO_RIDER_FOUND,
        title: 'No rider found nearby',
        message: `Order ${order.orderNo} needs manual delivery assignment — no rider was found within ${radiusMeters / 1000} km.`,
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifySeller (no rider) failed:', e.message));
      notifyUser(order.userId, {
        event: NOTIFICATION_EVENT.DELIVERY_DELAYED,
        title: 'Delivery is taking longer than usual',
        message: 'We are still finding a delivery partner for your order.',
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifyUser (delivery delayed) failed:', e.message));
    } catch (e) {
      console.error('[RIDER BROADCAST] notify failed:', e.message);
    }

    console.warn(`[RIDER BROADCAST] ${order.orderNo}: FLAGGED for manual assignment`);
    return;
  }

  /**
   * Riders are addressed by their DeliveryPartner id, not their User id.
   *
   * The rider app joins `rider:<partnerId>` (it passes `riderProfile._id`), so
   * broadcasting to User ids sent every ping into a room nobody was sitting in.
   * The order rang, the log said it rang, and no rider ever saw it.
   */
  const riderIds = riders.map(r => String(r._id));

  console.log(`[RIDER BROADCAST] Broadcasting order ${order.orderNo} to riders: ${riderIds.join(', ')}`);

  const shop = storePosition;
  const drop = { lat: order.shippingAddress.lat, lng: order.shippingAddress.lng };

  /**
   * Both distances a rider needs to judge the job, measured rather than invented.
   *
   * This was `(1.5 + Math.random() * 3)` — a different number every time the same
   * order was offered, and unrelated to anything. A rider decides whether to
   * accept on exactly this figure.
   */
  const legKm = distanceKm(shop, drop);

  const payload = {
    orderId: order._id,
    orderNo: order.orderNo,
    merchantName: shop.name,
    merchantAddress: [shop.address, shop.city].filter(Boolean).join(', '),
    merchantLocation: { lat: shop.lat, lng: shop.lng },
    customerName: order.shippingAddress.name,
    customerAddress: [order.shippingAddress.line1, order.shippingAddress.line2, order.shippingAddress.city]
      .filter(Boolean).join(', '),
    customerLocation: drop.lat !== undefined ? drop : undefined,
    landmarkImage: order.shippingAddress?.landmarkImage || null,
    hasLandmarkImage: Boolean(order.shippingAddress?.landmarkImage),
    // Shop → customer, which is the leg the rider is paid for.
    distance: legKm,
    etaMin: etaMinutes(legKm),
    paymentMethod: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    codAmount: order.paymentMethod === 'cod' ? Math.round(order.pricing.totalAmount) : 0,
    totalAmount: order.pricing.totalAmount,
    // The figure the settlement will use, so the offer cannot overstate it.
    // The customer's tip is part of that figure and is quoted here for the
    // same reason every other component is: a rider decides whether to accept
    // on this number, so it has to be the number they actually get.
    payout: riderPayout(legKm, { mode: payoutModeOf(order), tip: order.pricing?.tipAmount }),
    /**
     * What kind of job this is, from the order's own record.
     *
     * A Quick trip and a Shop All same-day trip look identical in this payload
     * otherwise, and they are not the same job — the second carries a promise
     * made to the customer at checkout, and a rider deciding whether to accept
     * deserves to know which one they are looking at.
     *
     * Absent on Quick orders, which have only one kind.
     */
    deliveryMode: order.delivery?.mode,
    promisedBy: order.delivery?.promisedBy,
    items: order.items.map(item => ({ name: item.name, qty: item.qty }))
  };

  /**
   * Sent per rider rather than broadcast, because one field genuinely differs:
   * how far each of them is from the shop. That was shown as a hardcoded
   * "0.8 km" to everybody, and it is one of the two numbers a rider uses to
   * judge whether the trip is worth taking.
   */
  const { emitToRider } = await import('../socket/rooms.js');
  for (const r of riders) {
    // Record the offer before ringing the rider, not after — a ping that
    // fires and a save that fails would otherwise leave a rider staring at a
    // job with no record it was ever offered.
    //
    // Whether this was a genuinely NEW attempt decides whether to ring at
    // all. `recordOfferIfNew`'s guard already stops a second OFFERED row
    // from being written for a rider who declined, expired, accepted, or is
    // still actively OFFERED on this order — but until now nothing stopped
    // the ping itself from firing anyway on a no-op write, so a rider who had
    // already turned this job down still heard their phone ring for it every
    // time the seller's own status change re-triggered a broadcast. An
    // already-active OFFERED rider isn't missing anything either: their open
    // offer is kept alive by their own 10s poll, not by a repeated ping.
    const { modifiedCount } = await recordOfferIfNew(order._id, r._id);
    const riderLoc = r?.currentLocation?.lat !== undefined ? r.currentLocation : r?.baseLocation;
    emitToRider(String(r._id), 'rider_ping', {
      ...payload,
      pickupDistance: distanceKm(riderLoc, shop),
    });
    // Persisted + pushed only for a genuinely new offer — `modifiedCount`
    // is the same "was this actually new" signal `recordOfferIfNew` already
    // computed, so a re-broadcast to an already-offered rider doesn't also
    // write a duplicate Notification row for them. Fire-and-forget: this
    // runs inside a per-rider loop and must not slow down the next ping.
    //
    // A rider the seller picked by name is told once per request even when an
    // earlier broadcast already left them an open offer (modifiedCount 0): the
    // seller's choice is news, and the marker keeps re-broadcasts silent.
    const requested = String(order.fulfillment?.requestedRiderId || '') === String(r._id);
    const announce = requested
      ? (await Order.updateOne({ _id: order._id, 'fulfillment.requestedRiderId': r._id, 'fulfillment.requestedRiderNotifiedAt': null },
        { $set: { 'fulfillment.requestedRiderNotifiedAt': new Date() } })).modifiedCount
      : modifiedCount;
    if (announce) {
      notifyRider(String(r._id), {
        event: requested ? NOTIFICATION_EVENT.RIDER_REQUESTED : NOTIFICATION_EVENT.RIDER_PING,
        dedupeKey: `rider-offer:${order._id}:${r._id}`,
        title: requested ? `${payload.merchantName || 'A store'} assigned order ${order.orderNo} to you — accept now`
          : payload.payout?.tip > 0 ? `New order offer — ₹${payload.payout.tip} tip` : 'New order offer',
        /**
         * The tip is named in the text, not only in the payload.
         *
         * This string is what becomes the push notification body, so for a
         * rider whose app is in their pocket it is the whole offer. A tip
         * that only existed in `payload.payout` would be invisible at exactly
         * the moment it is meant to persuade someone to take the job.
         */
        message: payload.payout?.tip > 0
          ? `${payload.merchantName} — ${payload.distance} km, ₹${payload.payout.total} (includes ₹${payload.payout.tip} customer tip)`
          : `${payload.merchantName} — ${payload.distance} km, ₹${payload.payout?.total ?? payload.totalAmount}`,
        metadata: { orderId: order._id, tipAmount: payload.payout?.tip || 0 },
        // Tapping the push opens the rider app, where the offer is waiting.
        route: '/delivery/dashboard',
      }).catch((e) => console.error('[NOTIFICATION] notifyRider (ping) failed:', e.message));
    }
  }
};

// @desc    Rider declines an order they were offered
// @route   POST /api/delivery/orders/:id/decline
// @access  Private (Approved riders only)
//
// OFFERED → DECLINED_BY_RIDER on the SAME offerAttempts entry — never a
// second row for the same rider/order. See Order.js offerAttemptSchema.
//
// Atomic for the same reason acceptOrder is: the winning condition (this
// rider's attempt must currently read OFFERED, and the order must still be
// unassigned) lives in the update's filter, not in a read-then-write. A
// decline arriving the instant another rider accepts, or the instant this
// same offer expires, simply fails to match — Mongo is the arbiter, not a
// race between two requests reading stale state.
const notifySellerAssignmentReleased = async order => {
  try {
    const { emitToSeller } = await import('../socket/rooms.js');
    emitToSeller(orderStoreId(order), 'rider_assignment_released', { orderId: order._id });
  } catch { /* The seller also refreshes on focus and while viewing the order. */ }
};

const releaseRequestedRider = async (order, partner, outcome) => {
  const released = await Order.updateOne({ _id: order._id, deliveryPartnerId: null, 'fulfillment.requestedRiderId': partner._id }, {
    $unset: { 'fulfillment.requestedRiderId': '', 'fulfillment.requestedRiderNotifiedAt': '' }, $set: { needsManualAssignment: true }, $inc: { __v: 1 },
  });
  if (!released.modifiedCount) return;
  await notifySellerAssignmentReleased(order);
  // Persisted + pushed, so a seller away from the order screen still learns
  // the job needs another partner. Only for the rider the seller picked.
  const name = (await User.findById(partner.userId).select('name').lean().catch(() => null))?.name || 'The delivery partner';
  let sellerId; try { sellerId = orderStoreId(order); } catch { return; }
  notifySeller(sellerId, {
    event: NOTIFICATION_EVENT.RIDER_DECLINED,
    title: outcome === 'declined' ? 'Delivery partner declined' : 'Delivery partner did not respond',
    message: `${name} ${outcome === 'declined' ? 'declined' : 'did not accept'} order ${order.orderNo}. Please assign another delivery partner.`,
    metadata: { orderId: order._id },
    route: '/orders',
  }).catch(e => console.error('[NOTIFICATION] notifySeller (rider declined) failed:', e.message));
};

export const declineOrder = asyncHandler(async (req, res) => {
  const partner = req.partner; // injected by requireApprovedPartner
  // Optional and not yet collected by any UI (see Section 4 of the request) —
  // a decline with no request body at all must not throw before reaching the
  // actual logic.
  const { reason } = req.body || {};

  const order = await Order.findOneAndUpdate(
    {
      _id: req.params.id,
      // Once assigned, the offer pool is irrelevant — nothing left to decline.
      $or: [{ deliveryPartnerId: null }, { deliveryPartnerId: { $exists: false } }],
      offerAttempts: {
        $elemMatch: { riderId: partner._id, status: OFFER_ATTEMPT_STATUS.OFFERED },
      },
    },
    {
      $set: {
        'offerAttempts.$[attempt].status': OFFER_ATTEMPT_STATUS.DECLINED_BY_RIDER,
        'offerAttempts.$[attempt].respondedAt': new Date(),
        ...(reason ? { 'offerAttempts.$[attempt].reason': reason } : {}),
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{ 'attempt.riderId': partner._id, 'attempt.status': OFFER_ATTEMPT_STATUS.OFFERED }],
    }
  );

  if (!order) {
    // Nothing matched — work out which condition failed, so the rider (and
    // the frontend's reconciliation) gets a true reason rather than a
    // generic refusal. Mirrors acceptOrder's own disambiguation read below.
    const existing = await Order.findById(req.params.id).select('deliveryPartnerId offerAttempts');
    if (!existing) throw httpError(404, 'Order not found');

    if (existing.deliveryPartnerId) {
      throw httpError(409, 'This order has already been assigned to a rider — there is nothing left to decline');
    }

    const mine = existing.offerAttempts.find((a) => String(a.riderId) === String(partner._id));
    if (!mine) throw httpError(404, 'You were not offered this order');

    if (mine.status === OFFER_ATTEMPT_STATUS.DECLINED_BY_RIDER) {
      // Idempotent: a duplicate decline is not an error, just a no-op — the
      // rider's own earlier decline already stands.
      return ok(res, { status: mine.status }, 'This offer was already declined');
    }

    throw httpError(409, `This offer is already ${mine.status} — it can no longer be declined`);
  }

  await releaseRequestedRider(order, partner, 'declined');
  return ok(res, { status: OFFER_ATTEMPT_STATUS.DECLINED_BY_RIDER }, 'Offer declined');
});

// @desc    Backend-authoritative offer expiry — the 15s countdown ran out
// @route   POST /api/delivery/orders/:id/expire
// @access  Private (Approved riders only)
//
// OFFERED → OFFER_EXPIRED on the SAME offerAttempts entry — same shape as
// declineOrder above, deliberately. A timeout is not a decline (the rider
// never acted), so it gets its own status and its own `expiredAt`, but the
// concurrency story is identical: the winning condition (this rider's
// attempt must currently read OFFERED) lives in the update's filter, so an
// expiry arriving the instant the rider accepts, or the instant they
// manually decline, simply fails to match rather than racing a read.
export const expireOrder = asyncHandler(async (req, res) => {
  const partner = req.partner; // injected by requireApprovedPartner

  const order = await Order.findOneAndUpdate(
    {
      _id: req.params.id,
      // Once assigned, the offer pool is irrelevant — nothing left to expire.
      $or: [{ deliveryPartnerId: null }, { deliveryPartnerId: { $exists: false } }],
      offerAttempts: {
        $elemMatch: { riderId: partner._id, status: OFFER_ATTEMPT_STATUS.OFFERED },
      },
    },
    {
      $set: {
        'offerAttempts.$[attempt].status': OFFER_ATTEMPT_STATUS.OFFER_EXPIRED,
        'offerAttempts.$[attempt].expiredAt': new Date(),
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{ 'attempt.riderId': partner._id, 'attempt.status': OFFER_ATTEMPT_STATUS.OFFERED }],
    }
  );

  if (!order) {
    // Nothing matched — work out which condition failed, so the frontend's
    // reconciliation gets a true reason. Mirrors declineOrder's own
    // disambiguation read above.
    const existing = await Order.findById(req.params.id).select('deliveryPartnerId offerAttempts');
    if (!existing) throw httpError(404, 'Order not found');

    if (existing.deliveryPartnerId) {
      throw httpError(409, 'This order has already been assigned to a rider — there is nothing left to expire');
    }

    const mine = existing.offerAttempts.find((a) => String(a.riderId) === String(partner._id));
    if (!mine) throw httpError(404, 'You were not offered this order');

    if (mine.status === OFFER_ATTEMPT_STATUS.OFFER_EXPIRED) {
      // Idempotent: a duplicate expiry request is not an error, just a
      // no-op — the earlier expiry already stands.
      return ok(res, { status: mine.status }, 'This offer had already expired');
    }

    throw httpError(409, `This offer is already ${mine.status} — it can no longer expire`);
  }

  await releaseRequestedRider(order, partner, 'expired');
  return ok(res, { status: OFFER_ATTEMPT_STATUS.OFFER_EXPIRED }, 'Offer expired');
});

// @desc    Rider accepts order
// @route   POST /api/delivery/orders/:id/accept
// @access  Private (Approved riders only)
export const acceptOrder = asyncHandler(async (req, res) => {
  const partner = req.partner; // injected by requireApprovedPartner

  /**
   * Capacity, not the availability flag.
   *
   * This used to read `partner.isAvailable`, which accepting an order sets to
   * false — so one trip locked the rider out of every other one, with no way to
   * relax that while the flow was still being built. The limit now lives in
   * RIDER_MAX_CONCURRENT_DELIVERIES and is unset during development.
   */
  /**
   * Validate the route before starting the claim. Capacity and reservations
   * are authoritative only inside the transaction; a refusal there rolls back
   * the entire claim instead of stranding an order without a Delivery.
   */
  // `type` is load-bearing: it decides which statuses a rider may claim from,
  // and leaving it out of the projection quietly treated every Quick order as a
  // Shop All one — claimable only at `dispatched`, which is exactly the window
  // early ringing exists to open.
  const candidate = await Order.findById(req.params.id).select('items status type fulfillment deliveryType deliveryPartnerId deliveryId shippingAddress paymentId paymentMethod');
  if (!candidate) throw httpError(404, 'Order not found');
  if (!await orderPaymentReady(candidate)) throw httpError(409, 'Payment must be verified before accepting a delivery');

  // A retry of a committed acceptance must not create another delivery or fail
  // capacity checks because the rider is now carrying this very order.
  if (String(candidate.deliveryPartnerId || '') === String(partner._id) && candidate.deliveryId) {
    const existingDelivery = await Delivery.findOne({ _id: candidate.deliveryId, orderId: candidate._id, partnerId: partner._id });
    if (existingDelivery) return ok(res, { orderId: candidate._id, deliveryId: existingDelivery._id, status: existingDelivery.status }, 'You already accepted this order');
  }
  if (candidate.deliveryType === 'shiprocket') throw httpError(409, 'Courier orders cannot be accepted by Bulkimart riders');
  const { seller: pickupSeller, shop } = await requireOrderPickup(candidate);
  if (!pickupCoordinates(candidate.shippingAddress)) throw httpError(409, 'The customer delivery address needs a valid map pin before acceptance');
  if (riderIneligibility(partner, req.user, candidate, shop || {}, { requireDuty: false })) {
    throw httpError(409, 'Your account, service coverage or pickup radius is not eligible for this order');
  }

  /**
   * Claim the order in one atomic step.
   *
   * This was a read, then a check, then a write. The same order is offered to up
   * to five riders at once, so two tapping Accept within the same moment both
   * read `deliveryPartnerId: null`, both passed the check, and the second write
   * silently overwrote the first — two riders sent to one shop, each holding a
   * different confirmation code, and only one of them able to complete.
   *
   * Putting the conditions in the filter makes MongoDB the arbiter: exactly one
   * update can match, and everyone else gets null back.
   */
  const session = await mongoose.startSession();
  let order, delivery;
  let replayed = false;
  try {
    await session.withTransaction(async () => {
      replayed = false;
      order = await Order.findOneAndUpdate(
    {
      _id: req.params.id,
      // One shared definition, so the offer and the claim cannot disagree.
      status: { $in: riderClaimableStatuses(candidate.type) },
      'fulfillment.requestedRiderId': { $in: [null, partner._id] },
      deliveryType: { $ne: 'shiprocket' },
      $or: [{ deliveryPartnerId: null }, { deliveryPartnerId: { $exists: false } }],
      /**
       * This rider's own offer, if one exists, must still be live.
       *
       * The claim below and the `arrayFilters` resolve-to-ACCEPTED further down
       * used to be able to disagree: the claim only checked the order, so it
       * could succeed and set `deliveryPartnerId` even when this rider's
       * attempt had already lost to a concurrent expiry — the array update
       * would then just silently skip (no element matched OFFERED), leaving
       * an order assigned to a rider whose own offer record read
       * OFFER_EXPIRED. Requiring it here, in the same atomic filter, means
       * the claim itself fails the instant that's true, rather than only the
       * sub-update of it. Vacuously true for a rider with no attempt at all,
       * so a "cold" accept — one that never went through offer/poll — is
       * unaffected.
       */
      offerAttempts: {
        $not: {
          $elemMatch: { riderId: partner._id, status: { $ne: OFFER_ATTEMPT_STATUS.OFFERED } },
        },
      },
    },
    {
      /**
       * Assigning a rider does not move the order along.
       *
       * This used to set `out_for_delivery` on claim. Now that a Quick order can
       * be claimed while it is still being packed, that told the customer their
       * food was on its way while it was sitting on the counter — and it skipped
       * "dispatched" entirely, so the shop's own hand-over never showed.
       *
       * The order becomes out_for_delivery when the rider actually picks it up,
       * which updateDeliveryStatus handles.
       */
      $set: {
        deliveryPartnerId: partner._id,
        // Resolves the SAME offerAttempts entry this rider was recorded
        // against — never a second one. A no-op (arrayFilters matches
        // nothing) when this rider claimed without ever polling or being
        // pinged, which is why it rides along in this update rather than
        // needing its own.
        'offerAttempts.$[attempt].status': OFFER_ATTEMPT_STATUS.ACCEPTED,
        'offerAttempts.$[attempt].respondedAt': new Date(),
      },
      $push: {
        timeline: {
          status: candidate.status,
          timestamp: new Date(),
          note: `Delivery partner ${req.user.name} assigned`,
        },
      },
    },
    {
      returnDocument: 'after',
      session,
      arrayFilters: [{ 'attempt.riderId': partner._id, 'attempt.status': OFFER_ATTEMPT_STATUS.OFFERED }],
    }
  );

  if (!order) {
    // Nothing matched. Work out which condition failed, so the rider is told
    // something true rather than a generic refusal.
    const existing = await Order.findById(req.params.id).select('status deliveryPartnerId deliveryId offerAttempts').session(session);
    if (!existing) throw httpError(404, 'Order not found');
    if (String(existing.deliveryPartnerId || '') === String(partner._id) && existing.deliveryId) {
      delivery = await Delivery.findOne({ _id: existing.deliveryId, orderId: existing._id, partnerId: partner._id }).session(session);
      if (delivery) { order = existing; replayed = true; return; }
    }
    if (existing.deliveryPartnerId) {
      throw httpError(409, 'Another rider accepted this order first');
    }
    // Order is still unassigned, so the claim failed on the new condition:
    // this rider's own offer already resolved to something other than
    // OFFERED (an expiry or a decline that landed first).
    const mine = existing.offerAttempts.find((a) => String(a.riderId) === String(partner._id));
    if (mine && mine.status !== OFFER_ATTEMPT_STATUS.OFFERED) {
      throw httpError(409, `Your offer for this order is already ${mine.status} — it can no longer be accepted`);
    }
    throw httpError(400, `This order is ${existing.status} — it is not ready for pickup`);
  }

  /**
   * No code is issued here.
   *
   * One used to be generated the moment a rider accepted, which put a number on
   * the customer's screen while the parcel was still on the shop counter. It
   * meant nothing at that point — and a code shown for twenty minutes before it
   * is needed is a code somebody reads out over the phone to whoever asks.
   *
   * It is created when the rider actually asks for it, at the door.
   */

  /**
   * The pickup is the shop, read from the seller record above.
   *
   * This used to be hardcoded: the address was the first item's *product name*
   * ("Chocolate Cream Biscuits 300g") and the coordinates were a fixed point in
   * Indore. It looked correct in testing only because the shop being tested was
   * also in Indore — every seller in Pune or Nagpur would have sent the rider
   * several hundred kilometres to a spot nobody had ever visited.
   */
  const pickup = {
    address: [shop.name || pickupSeller.businessName, shop.address, shop.city]
      .filter(Boolean).join(', '),
    lat: shop.lat,
    lng: shop.lng,
  };

  const drop = {
    address: [order.shippingAddress.line1, order.shippingAddress.line2, order.shippingAddress.city]
      .filter(Boolean).join(', '),
    lat: order.shippingAddress.lat,
    lng: order.shippingAddress.lng,
  };

  // Measured, not assumed. Straight-line: enough for an ETA, and free.
  const legKm = distanceKm(pickup, drop);

  const [createdDelivery] = await Delivery.create([{
    orderId: order._id,
    partnerId: partner._id,
    pickupLocation: pickup,
    dropLocation: drop,
    route: {
      distanceKm: legKm,
      durationMin: etaMinutes(legKm),
    },
    status: 'accepted',

    /**
     * The rates in force at the moment this rider said yes.
     *
     * Settlement reads this rather than the live rates, so an admin changing
     * the per-kilometre figure while the rider is on the road cannot change
     * what they were promised when they accepted.
     */
    ratesUsed: rateSnapshotFor(payoutModeOf(order)),

    /**
     * Seed the rider's position from where they are based.
     *
     * The live pings only start once the device reports its first fix, which
     * can be several seconds — or never, if they denied the permission. Until
     * then `partnerLocation` was empty and the customer's map showed no rider
     * at all, moments after being told one had been assigned. A slightly stale
     * pin beats a missing one, and the first real ping replaces it.
     */
    partnerLocation: riderPickupPosition(partner)
      ? { ...riderPickupPosition(partner), updatedAt: new Date() }
      : undefined,

    otpVerified: false
  }], { session });
  delivery = createdDelivery;

  order.deliveryId = delivery._id;
  await order.save({ session });

  /**
   * Only step out of the offer pool when the limit says one trip at a time.
   *
   * With no limit configured the rider stays on duty and keeps being offered
   * work, which is the point of allowing several at once. Flipping the flag
   * regardless would have taken them off the pool after the first order and
   * quietly reinstated the very restriction the limit is meant to control.
   */
  // Existing reservations outlive rollout switches. Always serialize the
  // cross-product guard; only the established capacity=1 rule changes duty.
  {
    const parcelGuard = await DeliveryPartner.updateOne({ _id: partner._id, 'parcelReservation.bookingId': { $exists: false }, 'parcelReturnClaim.token': { $exists: false } }, maxConcurrentDeliveries() === 1 ? { $set: { isAvailable: false }, $inc: { __v: 1 } } : { $inc: { __v: 1 } }, { session });
    if (!parcelGuard.matchedCount) throw httpError(409, 'Driver is reserved for a parcel task or return pickup claim');
    // The shared partner write forces competing claims to conflict/retry.
    // Recount on EVERY retry in its snapshot, excluding our uncommitted order.
    // A refusal rolls back the order, delivery, offer history and duty together.
    const currentCapacity = await canTakeAnother(partner._id, { session, excludeOrderId: order._id });
    if (!currentCapacity.ok) throw httpError(409, currentCapacity.reason);
    if (!await riderCashAllowsOrder(partner._id, order, { session })) throw httpError(409, 'Your COD cash limit has been reached. Settle your cash before accepting another COD delivery.');
  }
    });
  } finally { await session.endSession(); }

  if (replayed) return ok(res, { orderId: order._id, deliveryId: delivery._id, status: delivery.status }, 'You already accepted this order');

  // Notify other riders to clear the ping, and notify buyer
  try {
    const { emitToUser, emitToSeller } = await import('../socket/rooms.js');
    emitToUser(order.userId, 'rider_assigned', {
      orderId: order._id,
      riderName: req.user.name,
      riderPhone: req.user.phone,
      vehicleType: partner.vehicleType,
      // No code here. It does not exist yet, and once it does it travels in its
      // own 'otp_ready' event at the moment the rider asks for it at the door.
      deliveryId: delivery._id
    });
    notifyUser(order.userId, {
      event: NOTIFICATION_EVENT.RIDER_ASSIGNED,
      title: 'Rider assigned',
      message: `${req.user.name} is assigned to collect your order ${order.orderNo}.`,
      metadata: { orderId: order._id },
      route: '/orders',
    }).catch((e) => console.error('[NOTIFICATION] notifyUser (rider assigned) failed:', e.message));

    const sellerId = order.items.find(i => i.sellerId)?.sellerId;
    if (sellerId) {
      emitToSeller(sellerId, 'rider_assigned', {
        orderId: order._id,
        riderName: req.user.name,
        riderPhone: req.user.phone,
      });
      notifySeller(sellerId, {
        event: NOTIFICATION_EVENT.RIDER_ASSIGNED,
        title: 'Rider assigned',
        message: `${req.user.name} is assigned to collect order ${order.orderNo}.`,
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifySeller (rider assigned) failed:', e.message));
    }
  } catch (err) {
    console.error('Socket notification fail:', err.message);
  }

  return ok(res, {
    orderId: order._id,
    deliveryId: delivery._id,
    step: 'pickup',
    merchantName: shop.name || pickupSeller.businessName || 'Store',
    merchantAddress: [shop.address, shop.city].filter(Boolean).join(', ') || pickup.address,
    customerName: order.shippingAddress.name,
    customerAddress: `${order.shippingAddress.line1}, ${order.shippingAddress.line2 || ''}`,
    landmarkImage: order.shippingAddress?.landmarkImage || null,
    hasLandmarkImage: Boolean(order.shippingAddress?.landmarkImage),
    items: order.items.map(i => ({ name: i.name, qty: i.qty })),
    // The rider's own accept response never carried a usable code either — and
    // must not, since the whole point is that only the customer has it.
    paymentMethod: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    codAmount: order.paymentMethod === 'cod' ? Math.round(order.pricing.totalAmount) : 0,
    // Carried on the accept response too, so the job the rider just took keeps
    // showing the same pay — and the same tip — they saw on the offer, without
    // waiting for the next poll of the active-delivery view to tell them again.
    payout: riderPayout(delivery.route?.distanceKm, {
      mode: delivery.ratesUsed?.mode || payoutModeOf(order),
      rates: delivery.ratesUsed?.perKm !== undefined ? delivery.ratesUsed : undefined,
      tip: order.pricing?.tipAmount,
    }),
  }, 'Order accepted successfully');
});

// @desc    Rider cancels a delivery they accepted, before pickup
// @route   POST /api/delivery/orders/:id/cancel
// @access  Private (Approved riders only)
//
// Pre-pickup only — the frontend Cancel button has only ever existed on the
// pickup-stage screen, and this endpoint enforces that same boundary
// server-side, not just in the UI. `Delivery.status` has no cancellation
// value of its own; 'rejected' is reused for it — defined in the schema but
// never written by any other code path today.
//
// Releasing the rider does not touch Order.status. A rider stepping back is
// not the customer's order being cancelled — the order was never advanced
// at accept time in the first place (see acceptOrder's own note on this),
// so it is still sitting at whatever claimable status offered it, and
// clearing deliveryPartnerId is what makes it claimable again.
//
// Two documents move together here — ownership on Order, pickup-stage on
// Delivery — which a single findOneAndUpdate can't express safely. A
// transaction is the existing tool for exactly this shape of problem in
// this codebase (see order.controller.js's own cancel/checkout flows); this
// reuses that convention rather than introducing one.
export const cancelDelivery = asyncHandler(async (req, res) => {
  const partner = req.partner; // injected by requireApprovedPartner
  const { reason } = req.body || {};

  const order = await Order.findById(req.params.id).select('items deliveryPartnerId deliveryId status');
  if (!order) throw httpError(404, 'Order not found');

  /**
   * Ownership is read from the Delivery record, not `order.deliveryPartnerId`.
   *
   * A successful cancel clears the latter — that is the whole point, it is
   * what re-opens the order — so a second cancel request arriving after the
   * first already committed would otherwise find `deliveryPartnerId` already
   * gone and wrongly report "not assigned" instead of recognising its own
   * earlier cancellation. `Delivery.partnerId` is never cleared, so it stays
   * the reliable answer to "was this ever this rider's delivery" even after
   * the order itself has moved on.
   */
  const delivery = order.deliveryId ? await Delivery.findById(order.deliveryId)
    : await Delivery.findOne({ orderId: order._id, partnerId: partner._id, status: 'rejected' }).sort({ createdAt: -1 });
  if (!delivery || String(delivery.partnerId) !== String(partner._id)) {
    throw httpError(404, 'No active delivery assignment found');
  }

  const CANCELLABLE_DELIVERY_STATUSES = ['assigned', 'accepted', 'arrived_at_store'];

  if (delivery.status === 'rejected') {
    // Idempotent: a duplicate cancel is not an error, just a no-op — the
    // rider's own earlier cancellation already stands.
    return ok(res, { status: delivery.status }, 'This delivery was already cancelled');
  }

  const session = await mongoose.startSession();
  let cancelled = false;
  try {
    await session.withTransaction(async () => {
      // The winning condition lives in this filter, not in a read-then-write —
      // same reasoning as acceptOrder/declineOrder/expireOrder. A pickup or a
      // second cancel that already moved the Delivery past this list simply
      // fails to match.
      const deliveryResult = await Delivery.updateOne(
        { _id: order.deliveryId, partnerId: partner._id, status: { $in: CANCELLABLE_DELIVERY_STATUSES } },
        { $set: { status: 'rejected' } },
        { session }
      );
      if (deliveryResult.modifiedCount !== 1) return; // no-op transaction; disambiguated below

      const orderResult = await Order.updateOne(
        { _id: order._id, deliveryPartnerId: partner._id, deliveryId: order.deliveryId },
        {
          $unset: { deliveryPartnerId: '', deliveryId: '', 'fulfillment.requestedRiderId': '' },
          $set: { needsManualAssignment: true },
          $inc: { __v: 1 },
          $push: {
            timeline: {
              status: order.status,
              timestamp: new Date(),
              note: `Delivery partner ${req.user.name} cancelled before pickup${reason ? `: ${reason}` : ''}`,
            },
          },
        },
        { session }
      );
      if (orderResult.modifiedCount !== 1) {
        // Would leave the Delivery marked rejected with the order still
        // assigned — abort rather than commit a half-applied cancellation.
        throw httpError(409, 'This order is no longer assigned to you');
      }
      if ((await canTakeAnother(partner._id, { session })).ok) {
        await DeliveryPartner.updateOne({ _id: partner._id, 'parcelReservation.bookingId': { $exists: false }, 'parcelReturnClaim.token': { $exists: false } }, { $set: { isAvailable: true }, $inc: { __v: 1 } }, { session });
      }
      cancelled = true;
    });
  } finally {
    await session.endSession();
  }

  if (!cancelled) {
    // Nothing matched — work out which condition failed, so the rider gets a
    // true reason. Mirrors decline/expire's own disambiguation reads.
    const current = await Delivery.findById(order.deliveryId).select('status');
    if (!current) throw httpError(404, 'Delivery record not found');
    if (current.status === 'rejected') {
      // Idempotent: a duplicate cancel is not an error, just a no-op.
      return ok(res, { status: current.status }, 'This delivery was already cancelled');
    }
    throw httpError(409, `This delivery is already ${current.status} — it can no longer be cancelled`);
  }

  // Re-open the order to the existing dispatch mechanism — the same call
  // the seller's own status-update trigger already makes elsewhere in this
  // file. Not a new reassignment path; reusing the one that exists.
  await notifySellerAssignmentReleased(order);
  broadcastNewOrderToRiders(order._id).catch(console.error);

  return ok(res, { status: 'rejected' }, 'Delivery cancelled — the order has been released for reassignment');
});

// @desc    Update delivery stage / status (Heading to store -> Arrived -> Picked Up / In Transit)
// @route   PATCH /api/delivery/orders/:id/status
// @access  Private (Approved riders only)
export const updateDeliveryStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['arrived_at_store', 'picked_up', 'arrived_at_customer'].includes(status)) {
    throw httpError(400, 'Invalid status update');
  }

  const order = await Order.findById(req.params.id).select('deliveryPartnerId deliveryId userId');
  if (!order || String(order.deliveryPartnerId) !== String(req.partner._id)) {
    throw httpError(404, 'No active delivery assignment found');
  }

  const delivery = await Delivery.findById(order.deliveryId).select('status');
  if (!delivery) {
    throw httpError(404, 'Delivery record not found');
  }

  const NOTES = {
    arrived_at_store: 'Rider arrived at the store',
    picked_up: 'Rider collected the order',
    arrived_at_customer: 'Rider reached the delivery address',
  };

  /**
   * The stage lives on the Delivery, not the Order.
   *
   * `arrived_at_store` used to write `assigned` here — the initial value — so
   * reaching the shop pushed the delivery backwards and nothing downstream
   * could tell the two apart. The enum now has a state for each moment.
   *
   * The order's own status only moves once, at pickup: to a customer the parcel
   * is "out for delivery" from that point on, and the finer detail belongs to
   * the tracking screen rather than to the order's own history.
   *
   * This used to be `delivery.status = status; ... delivery.save()` — a blind
   * overwrite with no condition on the delivery's current state. That was safe
   * only because this used to be the sole writer of Delivery.status. Rider
   * cancellation (cancelDelivery) is now a second one, and a stale pickup
   * request that read the delivery just before a concurrent cancellation
   * committed would otherwise silently revert `rejected` back to `picked_up`
   * on save — confirmed live, reproducibly, before this fix. The condition
   * now lives in the update's filter, same shape as accept/decline/expire/
   * cancel, and — since it touches both Order and Delivery together — the
   * same transaction convention cancelDelivery already uses.
   */
  const TERMINAL_DELIVERY_STATUSES = ['rejected', 'delivered', 'failed'];

  const session = await mongoose.startSession();
  let applied = false;
  try {
    await session.withTransaction(async () => {
      const deliveryResult = await Delivery.updateOne(
        { _id: delivery._id, status: { $nin: TERMINAL_DELIVERY_STATUSES } },
        {
          $set: {
            status,
            ...(status === 'picked_up' ? { startTime: new Date() } : {}),
          },
        },
        { session }
      );
      if (deliveryResult.modifiedCount !== 1) return; // no-op transaction; disambiguated below

      const orderUpdate = {
        $push: { timeline: { status, timestamp: new Date(), note: NOTES[status] } },
      };
      if (status === 'picked_up') orderUpdate.$set = { status: 'out_for_delivery' };

      const orderResult = await Order.updateOne(
        { _id: order._id, deliveryPartnerId: req.partner._id },
        orderUpdate,
        { session }
      );
      if (orderResult.modifiedCount !== 1) {
        // Would leave the Delivery moved forward with the order left behind —
        // abort rather than commit a half-applied update.
        throw httpError(409, 'This order is no longer assigned to you');
      }
      applied = true;
    });
  } finally {
    await session.endSession();
  }

  if (!applied) {
    const current = await Delivery.findById(delivery._id).select('status');
    throw httpError(409, `This delivery is already ${current?.status || 'resolved'} — it can no longer be updated`);
  }

  // Notify buyer via socket
  try {
    const { emitToUser } = await import('../socket/rooms.js');
    // The stage itself, not a re-labelled version of it. Collapsing
    // 'arrived_at_store' into 'arrived' threw away which place was arrived at,
    // which is the only interesting part.
    emitToUser(order.userId, 'delivery_status_updated', {
      orderId: String(order._id),
      stage: status,
      at: new Date(),
    });
  } catch (err) {
    console.error('Socket send failed:', err.message);
  }

  return ok(res, { status }, 'Delivery status updated');
});

// @desc    Generate OTP for delivery verification
// @route   POST /api/delivery/orders/:id/generate-otp
// @access  Private (Approved riders only)
export const generateDeliveryOtp = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || String(order.deliveryPartnerId) !== String(req.partner._id)) {
    throw httpError(404, 'Active delivery not found');
  }

  const delivery = await Delivery.findById(order.deliveryId);
  if (!delivery) throw httpError(404, 'Delivery record not found');

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  delivery.otp = otp;
  delivery.otpAttempts = 0;          // a fresh code gets a fresh budget of tries
  delivery.otpIssuedAt = new Date();

  /**
   * How far the rider was from the door when they asked for the code.
   *
   * Not a gate. City GPS is routinely off by a hundred metres, and a rider
   * inside a stairwell can read far worse — refusing them there would strand an
   * honest delivery, which costs more than catching a dishonest one. So the
   * request always succeeds and the distance is simply written down. A rider
   * generating codes from two kilometres away shows up in the data; a rider
   * whose phone is having a bad day does not get punished for it.
   */
  delivery.otpIssuedFromKm = distanceKm(delivery.partnerLocation, delivery.dropLocation);
  if (delivery.otpIssuedFromKm > 1) {
    console.warn(
      `[OTP] ${order.orderNo}: code requested from ${delivery.otpIssuedFromKm} km away from the drop`
    );
  }

  await delivery.save();

  // Only the customer is told the code.
  try {
    const { emitToUser } = await import('../socket/rooms.js');
    emitToUser(order.userId, 'otp_ready', { otp });
    // The OTP itself never goes in the notification title/body/data — a lock
    // screen or notification tray is a worse place for it than the in-app
    // socket payload it already travels in.
    notifyUser(order.userId, {
      event: NOTIFICATION_EVENT.OTP_READY,
      title: 'Delivery OTP ready',
      message: `Your rider has arrived. Your delivery OTP is ${otp}. Share this code with the rider.`,
      metadata: { orderId: order._id, otp },
      route: '/orders',
    }).catch((e) => console.error('[NOTIFICATION] notifyUser (otp ready) failed:', e.message));
  } catch (err) {
    console.error(err);
  }

  /**
   * The rider is told that a code was sent — never what it is.
   *
   * This used to answer with { otp }. The whole point of the code is that only
   * the person holding the parcel's destination knows it, so handing it to the
   * courier turns the confirmation into a formality they can complete alone,
   * from anywhere, without meeting anybody.
   */
  return ok(res, { sent: true }, 'A 4-digit code has been sent to the customer. Ask them for it.');
});

// @desc    Verify OTP and complete delivery
// @route   POST /api/delivery/orders/:id/verify-otp
// @access  Private (Approved riders only)
export const verifyDeliveryOtp = asyncHandler(async (req, res) => {
  const { otp, codCollected } = req.body;
  if (!otp) throw httpError(400, 'OTP is required');

  const order = await Order.findById(req.params.id);
  if (!order || String(order.deliveryPartnerId) !== String(req.partner._id)) {
    throw httpError(404, 'Active delivery assignment not found');
  }

  const delivery = await Delivery.findById(order.deliveryId);
  if (!delivery) throw httpError(404, 'Delivery record not found');

  /**
   * A 4-digit code is 10,000 possibilities — a couple of minutes of guessing
   * for anyone willing to loop. Without a cap, withholding the code from the
   * rider achieves nothing: they would simply try every one.
   */
  const MAX_ATTEMPTS = 5;
  if ((delivery.otpAttempts || 0) >= MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Ask the customer to have a new code sent.');
  }

  // No code has been issued yet — the rider skipped straight to verifying.
  if (!delivery.otp) {
    throw httpError(400, 'Send the code to the customer first, then ask them for it');
  }

  if (delivery.otp !== String(otp).trim()) {
    delivery.otpAttempts = (delivery.otpAttempts || 0) + 1;
    await delivery.save();

    const left = MAX_ATTEMPTS - delivery.otpAttempts;
    throw httpError(400, left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
      : 'Incorrect code. No attempts left — ask for a new code to be sent.');
  }

  // OTP verified — everything below is one logical operation: Delivery,
  // Order, and the rider's earnings must all move together or not at all.
  //
  // This used to be `delivery.status = 'delivered'; ... Promise.all([three
  // independent .save() calls])` — no condition on the delivery's current
  // state, and three separate writes with no shared transaction. Two
  // concurrent correct-OTP submissions (a double-tap; the submit button has
  // no in-flight guard) would both pass validation against the same stale
  // read and both credit earnings — a real double-payment path. The
  // condition now lives in the update's filter, same shape as
  // cancelDelivery/updateDeliveryStatus: only a Delivery still short of
  // 'delivered'/'rejected'/'failed' can complete, and whichever request's
  // atomic write actually lands first is the only one that reaches the
  // earnings credit at all — the loser's own conditioned write matches
  // nothing and never gets there.
  //
  // The same function that produced the figure quoted on the offer screen,
  // computed once, before the transaction — it depends only on data already
  // loaded, not on anything the transaction itself could race.
  const settlement = riderPayout(delivery.route?.distanceKm, {
    mode: delivery.ratesUsed?.mode || payoutModeOf(order),
    // The rate frozen at acceptance. Deliveries taken before rates became
    // configurable have no snapshot and settle at the live rate, exactly as
    // they always did.
    rates: delivery.ratesUsed?.perKm !== undefined ? delivery.ratesUsed : undefined,
    /**
     * The tip is read from the order, not from a frozen snapshot, because
     * unlike a rate it is not something an admin can change underneath the
     * rider — it was fixed by the customer at checkout and nothing edits it
     * afterwards. It is credited the same way on a COD order as on a prepaid
     * one: the cash a rider collects at the door is money they owe back, not
     * money they keep, so paying the tip through earnings is what actually
     * gets it to them.
     */
    tip: order.pricing?.tipAmount,
  });
  const earnings = settlement.total;
  const tipEarned = settlement.tip;
  let creditedEarnings = earnings, creditedTip = tipEarned, earningStatus = 'eligible';

  const TERMINAL_DELIVERY_STATUSES = ['delivered', 'rejected', 'failed'];

  const session = await mongoose.startSession();
  let completed = false;
  try {
    await session.withTransaction(async () => {
      const deliveryResult = await Delivery.updateOne(
        { _id: delivery._id, status: { $nin: TERMINAL_DELIVERY_STATUSES } },
        {
          $set: {
            otpVerified: true,
            status: 'delivered',
            endTime: new Date(),
            partnerEarnings: earnings,
            partnerTip: tipEarned,
          },
        },
        { session }
      );
      if (deliveryResult.modifiedCount !== 1) return; // no-op transaction; disambiguated below

      /**
       * Return & Refund — Phase 3: stamp the real delivery moment onto
       * every item, and (only for a return-eligible item) the deadline
       * computed from ITS OWN frozen snapshot — never today's
       * CategoryReturnPolicy. A non-eligible item still gets `deliveredAt`
       * (a plain fact) but `returnEligibleUntil` stays null, never a
       * deadline that would make it look returnable.
       */
      const deliveredAt = new Date();
      const itemsWithDeliveryStamp = order.items.map((item) => {
        const plain = item.toObject ? item.toObject() : item;
        const { returnEligible, returnWindowDays } = plain.returnPolicy || {};
        const eligibleUntil = returnEligible && Number.isFinite(returnWindowDays) && returnWindowDays > 0
          ? new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000)
          : null;
        return {
          ...plain, deliveredAt, returnEligibleUntil: eligibleUntil,
          // NHCONE Coins (Phase 7) — no longer credited here. This item
          // enters PENDING and waits for its own return window (or, for a
          // non-returnable item, becomes due immediately) — the sweeper
          // (services/coin.service.js::processReturnWindowRewards) decides
          // and credits it later, once any Return on it has resolved.
          coinRewardStatus: 'PENDING',
          coinRewardEligibleAt: eligibleUntil || deliveredAt,
        };
      });

      const orderResult = await Order.updateOne(
        { _id: order._id, deliveryPartnerId: req.partner._id, status: { $ne: 'delivered' } },
        {
          $set: { status: 'delivered', items: itemsWithDeliveryStamp },
          $push: {
            timeline: {
              status: 'delivered',
              timestamp: deliveredAt,
              note: 'Order delivered successfully by rider',
            },
          },
        },
        { session }
      );
      if (orderResult.modifiedCount !== 1) {
        // Would leave the Delivery marked delivered with the order left
        // behind — abort rather than commit a half-applied completion.
        throw httpError(409, 'This order could not be marked delivered');
      }

      // $inc, not a read-modify-write — the field never passes through this
      // process's memory, so there is nothing here for a second concurrent
      // request to race even in principle. Reached only because the
      // Delivery write above actually matched, which is the real exactly-
      // once guarantee; this step is just how the credit itself is applied.
      const earningRecord = await recordDeliveryEarning({ order, delivery, settlement, session });
      const heldEarning = Boolean(earningRecord);
      creditedEarnings = earningRecord && !earningRecord.credited ? 0 : earnings;
      creditedTip = earningRecord && !earningRecord.credited ? 0 : tipEarned;
      earningStatus = earningRecord?.status || 'eligible';
      await DeliveryPartner.updateOne(
        { _id: req.partner._id },
        {
          $set: { isAvailable: true, ...(heldEarning ? { financialWorkflowVersion: 2 } : {}) },
          $inc: {
            totalDeliveries: 1,
            'earnings.total': creditedEarnings,
            ...(heldEarning ? { 'earnings.held': creditedEarnings } : { 'earnings.pending': creditedEarnings }),
            // A breakdown of the credit above, not an extra one — `earnings`
            // already contains the tip.
            'earnings.tips': creditedTip,
          },
        },
        { session }
      );

      // NHCONE Coins (Phase 7) — no immediate credit here anymore. Every
      // item was just stamped `coinRewardStatus: 'PENDING'` above; the
      // return-window-aware sweeper decides and credits it later.

      completed = true;
    });
  } finally {
    await session.endSession();
  }

  if (!completed) {
    // Nothing matched — work out which condition failed. Mirrors decline/
    // expire/cancel's own disambiguation reads.
    const current = await Delivery.findById(delivery._id).select('status partnerEarnings partnerTip financialEarningStatus');
    if (current?.status === 'delivered') {
      // Idempotent: a duplicate completion is not an error, just a no-op —
      // no second earnings credit, no second delivery count increment.
      return ok(res, {
        earnings: current.partnerEarnings ?? 0,
        tip: current.partnerTip ?? 0,
        earningStatus: current.financialEarningStatus || 'eligible',
      }, 'This delivery was already completed');
    }
    throw httpError(409, `This delivery is already ${current?.status || 'resolved'} — it cannot be completed`);
  }

  // COD cash is recorded in the same step as delivery, so it cannot be
  // forgotten. A failure here never undoes the completed delivery; the rider
  // can still report it from the earnings screen.
  let codCollection = null;
  if (order.paymentMethod === 'cod' && order.financialSnapshot?.version === 2 && req.body.codCollected != null && req.body.codCollected !== '') {
    try {
      await recordCodEvent({ orderId: order._id, partnerId: req.partner._id, actorId: req.user._id, action: 'collect',
        // Cash is counted in whole rupees, matching the rounded COD amount shown to the rider.
        input: { amount: Math.round(Number(req.body.codCollected)), method: 'cash', reference: `OTP-${delivery._id}`, reason: 'Recorded by the rider at OTP delivery' } });
      codCollection = { recorded: true };
    } catch (error) {
      codCollection = { recorded: false, message: error.message };
    }
  }

  // Notify buyer and seller
  try {
    const { emitToUser, emitToSeller } = await import('../socket/rooms.js');
    emitToUser(order.userId, 'order_delivered', { orderId: order._id });
    notifyUser(order.userId, {
      event: NOTIFICATION_EVENT.ORDER_DELIVERED,
      title: 'Order delivered',
      message: `Order ${order.orderNo} has been delivered. Enjoy!`,
      metadata: { orderId: order._id },
      route: '/orders',
    }).catch((e) => console.error('[NOTIFICATION] notifyUser (order delivered) failed:', e.message));

    // NHCONE Coins (Phase 7) — no longer credited synchronously here, so no
    // "Coins added" notification fires at this exact moment either; the
    // sweeper's own credit path can send one later if that becomes needed
    // (Section 28 — not overbuilt in this phase).

    const sellerId = order.items.find(i => i.sellerId)?.sellerId;
    if (sellerId) {
      emitToSeller(sellerId, 'order_delivered', { orderId: order._id });
      notifySeller(sellerId, {
        event: NOTIFICATION_EVENT.ORDER_DELIVERED,
        title: 'Order delivered',
        message: `Order ${order.orderNo} has been delivered to the customer.`,
        metadata: { orderId: order._id },
        route: '/orders',
      }).catch((e) => console.error('[NOTIFICATION] notifySeller (order delivered) failed:', e.message));
    }
  } catch (err) {
    console.error(err);
  }

  return ok(res, { earnings: creditedEarnings, tip: creditedTip, earningStatus, codCollection },
    earningStatus === 'reconciliation_required' ? 'Delivery completed; earnings require verified rate and distance reconciliation' : earningStatus === 'held' ? 'Delivery completed; earnings recorded as held pending verified-funds release' : tipEarned > 0
      ? `Delivery completed — ₹${earnings} earned, including a ₹${tipEarned} tip from the customer`
      : 'Delivery verified and completed successfully');
});

// @desc    Get pending delivery orders (fallback/on-mount pings check)
// @route   GET /api/delivery/orders/pending
// @access  Private (Approved riders only)
export const getPendingDeliveryOrders = asyncHandler(async (req, res) => {
  const partner = req.partner;
  if (!partner) {
    throw httpError(404, 'Rider profile not found');
  }

  /**
   * Only orders a rider can actually take.
   *
   * This listed `confirmed` and `preparing` as well, but accept refuses anything
   * that is not `dispatched` — so the app offered jobs that were still being
   * packed and every Accept came back 400. An order is available to riders at
   * exactly the moment the shop hands it over, and nowhere else.
   */
  /**
   * Every job this rider could actually take, whichever storefront it came from.
   *
   * This asked for `type: CHANNEL.GROCERY`, which silently excluded every
   * Same-Day order — they are Shop All orders carried by our own riders. The
   * socket ping still reached the rider, so a rider watching at that exact
   * second saw the offer; a rider who opened the app a minute later, came on
   * duty afterwards, or whose socket had reconnected saw nothing at all. This
   * poll is the net behind the ping, and it had a hole the shape of Same-Day.
   *
   * The carrier decides, matching the gate the broadcast already uses
   * (`deliveryType !== 'shiprocket'`). `$ne` rather than `=== 'internal'` so the
   * grocery orders placed before `deliveryType` was recorded still qualify.
   *
   * Claimable statuses differ per storefront — Quick from `confirmed`, Shop All
   * only once `dispatched` — so the channels are asked separately and the answer
   * still comes from riderClaimableStatuses(), which is not touched.
   */
  const pendingOrders = await Order.find({
    deliveryType: { $ne: 'shiprocket' },
    $and: [
      { $or: CHANNELS.map((ch) => ({ type: ch, status: { $in: riderClaimableStatuses(ch) } })) },
      { $or: [{ deliveryPartnerId: null }, { deliveryPartnerId: { $exists: false } }] },
      { 'fulfillment.requestedRiderId': { $in: [null, partner._id] } },
    ],
    /**
     * Not an order this rider already resolved.
     *
     * The poll used to return every claimable order to every requesting
     * rider, full stop — `recordOfferIfNew` further down stopped a second
     * OFFERED row from being written for a rider who had already declined,
     * expired, or (briefly, before assignment clears it) accepted, but
     * nothing stopped the order from still showing up in this list every
     * 10 seconds regardless. A rider who turned a job down kept seeing it
     * reappear. Same `$not: $elemMatch` shape as acceptOrder's own claim
     * guard — vacuously true for a rider with no attempt yet, true while
     * their attempt is still the active OFFERED, false the moment it
     * resolves to anything else.
     */
    offerAttempts: {
      $not: {
        $elemMatch: {
          riderId: partner._id,
          status: { $in: [OFFER_ATTEMPT_STATUS.DECLINED_BY_RIDER, OFFER_ATTEMPT_STATUS.OFFER_EXPIRED, OFFER_ATTEMPT_STATUS.ACCEPTED] },
        },
      },
    },
  }).sort({ createdAt: 1 });

  const formatted = [];
  for (const order of pendingOrders) {
    if (!await orderPaymentReady(order)) continue;
    let sellerId;
    try { sellerId = orderStoreId(order); } catch { continue; }
    const seller = await Seller.findById(sellerId);
    if (!seller) continue;

    // Every order returned here genuinely is being offered to this rider
    // right now — this poll exists precisely so a rider who missed (or never
    // received) the socket ping still sees it. Recorded the same way the
    // ping itself is; the guard inside makes repeat polls of the same order
    // no-ops.
    const shop = storePickup(seller);
    if (!shop) continue;
    if (riderIneligibility(partner, req.user, order, shop)) continue;
    if (!await riderCashAllowsOrder(partner._id, order)) continue;
    await recordOfferIfNew(order._id, partner._id);
    const drop = { lat: order.shippingAddress.lat, lng: order.shippingAddress.lng };
    const legKm = distanceKm(shop, drop);

    // How far this particular rider has to travel just to reach the shop.
    const riderLoc = partner?.currentLocation?.lat !== undefined ? partner.currentLocation : partner?.baseLocation;
    const pickupKm = distanceKm(riderLoc, shop);

    formatted.push({
      orderId: order._id,
      orderNo: order.orderNo,
      merchantName: shop.name || 'Store',
      merchantAddress: [shop.address, shop.city].filter(Boolean).join(', '),
      merchantLocation: { lat: shop.lat, lng: shop.lng },
      customerName: order.shippingAddress.name,
      customerAddress: [order.shippingAddress.line1, order.shippingAddress.line2, order.shippingAddress.city]
        .filter(Boolean).join(', '),
      customerLocation: drop.lat !== undefined ? drop : undefined,
      landmarkImage: order.shippingAddress?.landmarkImage || null,
      hasLandmarkImage: Boolean(order.shippingAddress?.landmarkImage),
      distance: legKm,
      pickupDistance: pickupKm,
      etaMin: etaMinutes(legKm),
      paymentMethod: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
      codAmount: order.paymentMethod === 'cod' ? Math.round(order.pricing.totalAmount) : 0,
      totalAmount: order.pricing.totalAmount,
      // Computed by the same function that pays out on completion.
      payout: riderPayout(legKm, { mode: payoutModeOf(order), tip: order.pricing?.tipAmount }),
      // Same fields the socket ping carries, so an offer picked up by the poll
      // is indistinguishable from one that arrived live.
      deliveryMode: order.delivery?.mode,
      promisedBy: order.delivery?.promisedBy,
      items: order.items.map(item => ({ name: item.name, qty: item.qty }))
    });
  }

  return ok(res, formatted, 'Pending delivery orders retrieved successfully');
});


// @desc    Toggle rider availability (online/offline duty status)
// @route   PUT /api/delivery/availability
// @access  Private (Approved riders only)
export const toggleAvailability = asyncHandler(async (req, res) => {
  const { isAvailable, lat, lng } = req.body;
  const partner = req.partner;
  const wantsWork = Boolean(isAvailable);

  // Coordinates are optional here, same as before this fix — the frontend only
  // attempts a GPS fix when going online and silently sends none if permission
  // is denied or the fix times out (see DeliveryContext.jsx:handleToggleOnline).
  // When they ARE sent, they must be real coordinates, not silently accepted
  // and stored as NaN — a bad `Number(lat)` used to write straight through to
  // `currentLocation` with no validation at all.
  const hasLat = lat !== undefined && lat !== null && lat !== '';
  const hasLng = lng !== undefined && lng !== null && lng !== '';
  let parsedLat, parsedLng;

  if (hasLat || hasLng) {
    if (!hasLat || !hasLng) {
      throw httpError(400, 'Both latitude and longitude are required together');
    }
    parsedLat = Number(lat);
    parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      throw httpError(400, 'Invalid latitude — must be a number between -90 and 90');
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      throw httpError(400, 'Invalid longitude — must be a number between -180 and 180');
    }
  }

  /**
   * Going on duty is refused while a delivery is still open.
   *
   * `isAvailable` means "free to be given a job", and accepting one sets it to
   * false. But this endpoint overwrote that unconditionally, so a rider who
   * tapped the duty toggle mid-delivery became eligible again and could collect
   * a second order — and a third. One rider here was carrying three at once,
   * each with a customer expecting it.
   *
   * Going off duty is always allowed: a rider must be able to stop taking new
   * work without abandoning what they are already holding.
   */
  if (wantsWork) {
    const capacity = await canTakeAnother(partner._id);
    if (!capacity.ok) {
      throw httpError(409, `${capacity.reason} (${capacity.open} still open)`);
    }
  }

  partner.isAvailable = wantsWork;
  if (hasLat && hasLng) {
    // Going offline never invalidates the last known fix — the rider's last
    // real position stays on record rather than being cleared, since nothing
    // here was asked to erase it and a stale-but-real point is more useful
    // than none at all.
    partner.currentLocation = {
      lat: parsedLat,
      lng: parsedLng,
      updatedAt: new Date(),
    };
  }
  await partner.save();

  return ok(res, { isAvailable: partner.isAvailable },
    `You are now ${partner.isAvailable ? 'on duty' : 'off duty'}`);
});



// @desc    Ping the rider's live position during an active delivery
// @route   PUT /api/delivery/orders/:id/location
// @access  Private (Approved riders only)
export const updateDeliveryLocation = asyncHandler(async (req, res) => {
  /**
   * Distinct from PUT /api/delivery/location, which sets where a rider is
   * *based* — a value that changes when they move house, not every few
   * seconds. The rider app was posting live GPS to that one, quietly
   * overwriting their home base with wherever they happened to be, and
   * nothing was ever emitted to the customer watching the map.
   */
  const order = await Order.findById(req.params.id).select("userId deliveryPartnerId deliveryId status");
  if (!order || String(order.deliveryPartnerId) !== String(req.partner._id)) {
    throw httpError(404, "No active delivery assignment found");
  }

  const parsed = parseLocation(req.body, { requireCoords: true });
  if (!parsed.ok) throw httpError(400, parsed.message);
  const { lat, lng } = parsed.location;

  // Stored on the Delivery, so the trail belongs to this trip rather than to
  // the rider in general.
  await Delivery.updateOne(
    { _id: order.deliveryId },
    { $set: { partnerLocation: { lat, lng, updatedAt: new Date() } } }
  );

  // The customer watching the map is the whole point of this endpoint.
  try {
    const { emitToUser } = await import("../socket/rooms.js");
    emitToUser(order.userId, "location_update", {
      orderId: String(order._id),
      deliveryId: String(order.deliveryId),
      lat,
      lng,
      at: new Date(),
    });
  } catch (err) {
    console.error("[LOCATION] emit failed:", err.message);
  }

  // Deliberately terse: this is called every few seconds from a phone on
  // mobile data, so the response should not carry a payload nobody reads.
  return ok(res, null, "Location updated");
});

// @desc    The delivery this rider is currently carrying, if any
// @route   GET /api/delivery/orders/active
// @access  Private (Approved riders only)
export const getActiveDelivery = asyncHandler(async (req, res) => {
  /**
   * Restores a trip in progress.
   *
   * The rider app kept the active delivery in React state alone, so a refresh —
   * or a phone locking and the tab being evicted — left a rider holding an order
   * with no screen for it. The app showed "listening for orders" while the
   * server still had them assigned; they could not go back on duty, because the
   * delivery was open; and the customer waited for somebody who no longer had
   * any way to complete it.
   */
  const order = await Order.findOne({
    deliveryPartnerId: req.partner._id,
    status: { $nin: ['delivered', 'cancelled', 'returned', 'refunded'] },
  }).sort({ updatedAt: -1 });

  if (!order) return ok(res, null, 'No delivery in progress');

  const delivery = order.deliveryId ? await Delivery.findById(order.deliveryId) : null;
  const sellerItem = order.items.find((i) => i.sellerId);
  const seller = sellerItem
    ? await Seller.findById(sellerItem.sellerId).select('businessName storeDetails')
    : null;
  const shop = storePickup(seller) || {};

  const inTransit = ['picked_up', 'in_transit', 'arrived_at_customer'].includes(delivery?.status);

  return ok(res, {
    orderId: order._id,
    orderNo: order.orderNo,
    // Which screen the rider app should be showing.
    step: inTransit ? 'transit' : 'pickup',
    stage: delivery?.status || null,
    // Whether a code has already gone out, so the button does not offer to send
    // a second one and invalidate the number the customer is reading aloud.
    otpSent: Boolean(delivery?.otp),

    merchantName: shop.name || seller?.businessName || 'Store',
    merchantAddress: delivery?.pickupLocation?.address || [shop.address, shop.city].filter(Boolean).join(', '),
    merchantLocation: pickupCoordinates(delivery?.pickupLocation) || pickupCoordinates(shop) || undefined,

    customerName: order.shippingAddress?.name,
    customerPhone: order.shippingAddress?.phone || null,
    customerAddress: [order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.city]
      .filter(Boolean).join(', '),
    customerLocation: order.shippingAddress?.lat !== undefined
      ? { lat: order.shippingAddress.lat, lng: order.shippingAddress.lng }
      : undefined,
    landmarkImage: order.shippingAddress?.landmarkImage || null,
    hasLandmarkImage: Boolean(order.shippingAddress?.landmarkImage),
    orderType: order.type || null,
    deliveryMode: order.delivery?.mode || null,
    deliveryType: order.deliveryType || null,

    items: order.items.map((i) => ({ name: i.name, qty: i.qty })),
    paymentMethod: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    codAmount: order.paymentMethod === 'cod' ? Math.round(order.pricing.totalAmount) : 0,
    distance: delivery?.route?.distanceKm,
    payout: riderPayout(delivery?.route?.distanceKm, {
      mode: delivery?.ratesUsed?.mode || payoutModeOf(order),
      rates: delivery?.ratesUsed?.perKm !== undefined ? delivery.ratesUsed : undefined,
      tip: order.pricing?.tipAmount,
    }),
    // Never the code itself — only the customer holds that.
  }, 'Delivery in progress');
});

/**
 * Every resolved offer/delivery outcome for this rider, newest first.
 *
 * Two sources, deliberately kept separate rather than merged into a new
 * collection:
 *
 *   Order.offerAttempts — offers that never became a Delivery at all
 *   (declined or expired before acceptance). A rider can have at most one
 *   attempt per order (see recordOfferIfNew's own dedup guard), so each
 *   matching order contributes exactly one history row.
 *
 *   Delivery — offers this rider actually accepted, whichever way they
 *   ended: delivered, or cancelled pre-pickup (`rejected` — the only writer
 *   of that status in this codebase is cancelDelivery, so it means
 *   CANCELLED_BY_RIDER unambiguously, not the unrelated "offer rejected"
 *   reading the enum name might suggest). `failed` is included for when the
 *   architecture eventually writes it; nothing does yet, so it will not
 *   appear — not fabricated, just structurally ready.
 *
 * An order can appear from at most one of the two sources for a given
 * rider: an offer that resolved to DECLINED_BY_RIDER/OFFER_EXPIRED never had
 * a Delivery created (Delivery only exists once acceptOrder succeeds), so
 * there is no overlap to deduplicate between them.
 */
export const getRiderHistory = asyncHandler(async (req, res) => {
  const partner = req.partner;
  const { page, limit, skip } = getPagination(req.query);

  const OFFER_TYPES = ['DECLINED_BY_RIDER', 'OFFER_EXPIRED'];
  const DELIVERY_TYPE_BY_STATUS = { delivered: 'DELIVERED', rejected: 'CANCELLED_BY_RIDER', failed: 'FAILED' };

  // ?type= restricts to one source query instead of running both and
  // throwing half the results away. 'ALL' (or the param simply being
  // absent) means no restriction — both sources are queried.
  const wantedType = req.query.type && req.query.type !== 'ALL' ? req.query.type : undefined;
  const wantsOffers = !wantedType || OFFER_TYPES.includes(wantedType);
  const wantsDeliveries = !wantedType || Object.values(DELIVERY_TYPE_BY_STATUS).includes(wantedType);

  const [offerOrders, deliveries] = await Promise.all([
    wantsOffers
      ? Order.find(
          {
            offerAttempts: {
              $elemMatch: {
                riderId: partner._id,
                status: { $in: wantedType ? [wantedType] : OFFER_TYPES },
              },
            },
          },
          // Positional projection: only the one matching attempt for this
          // rider, never the whole array — nothing about another rider's
          // offer on the same order is read or returned.
          { orderNo: 1, 'offerAttempts.$': 1 }
        ).lean()
      : [],
    wantsDeliveries
      ? Delivery.find({
          partnerId: partner._id,
          status: wantedType
            ? Object.keys(DELIVERY_TYPE_BY_STATUS).find((k) => DELIVERY_TYPE_BY_STATUS[k] === wantedType)
            : { $in: Object.keys(DELIVERY_TYPE_BY_STATUS) },
        })
          .select('orderId returnId direction status endTime updatedAt partnerEarnings partnerTip')
          .populate('orderId', 'orderNo')
          .populate('returnId', 'returnNumber')
          .lean()
      : [],
  ]);

  const offerItems = offerOrders.map((o) => {
    const attempt = o.offerAttempts[0]; // the positional projection guarantees exactly one
    const type = attempt.status; // already DECLINED_BY_RIDER or OFFER_EXPIRED
    return {
      id: String(attempt._id),
      orderId: String(o._id),
      orderNo: o.orderNo,
      type,
      timestamp: (type === 'OFFER_EXPIRED' ? attempt.expiredAt : attempt.respondedAt) || attempt.offeredAt,
    };
  });

  // A return pickup belongs to a Return, not an Order, and is listed under its
  // return number; a record whose order or return no longer exists is skipped.
  const deliveryItems = deliveries
    .filter((d) => d.direction === 'return_pickup' ? d.returnId : d.orderId)
    .map((d) => {
      const type = DELIVERY_TYPE_BY_STATUS[d.status];
      const isReturn = d.direction === 'return_pickup';
      const item = {
        id: String(d._id),
        orderId: String(isReturn ? d.returnId._id : d.orderId._id),
        orderNo: isReturn ? d.returnId.returnNumber : d.orderId.orderNo,
        ...(isReturn ? { kind: 'return_pickup' } : {}),
        type,
        timestamp: (type === 'DELIVERED' ? d.endTime : null) || d.updatedAt,
      };
      if (type === 'DELIVERED' && d.partnerEarnings !== undefined) {
        item.amount = d.partnerEarnings;
        // Surfaced separately so the history row can show what part of this
        // delivery's pay the customer chose to add.
        if (d.partnerTip > 0) item.tip = d.partnerTip;
      }
      return item;
    });

  const parcelItems = (await Parcel.find({ $or: [{ partnerId: partner._id }, { 'assignment.attempts.partnerId': partner._id }] })
    .select('reference status partnerId pricing.driverPaise proof.delivery.verifiedAt exception assignment.attempts updatedAt').lean())
    .flatMap((b) => parcelHistoryItems(b, partner._id))
    .filter((item) => !wantedType || item.type === wantedType);

  const all = [...offerItems, ...deliveryItems, ...parcelItems].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const total = all.length;
  const page_ = all.slice(skip, skip + limit);

  return paginated(res, page_, { page, limit, total });
});

// A parcel job in the rider's history: its outcome for this rider plus any offer they declined or let expire.
const parcelNumber = (b) => `#${String(b.reference || b._id).slice(-6).toUpperCase()}`;
function parcelHistoryItems(b, partnerId) {
  const mine = String(b.partnerId || '') === String(partnerId), base = { orderId: String(b._id), orderNo: parcelNumber(b), kind: 'parcel' };
  const offers = (b.assignment?.attempts || []).filter((a) => String(a.partnerId) === String(partnerId) && ['rejected', 'timeout'].includes(a.outcome))
    .map((a) => ({ ...base, id: `${b._id}:${a.token}`, type: a.outcome === 'rejected' ? 'DECLINED_BY_RIDER' : 'OFFER_EXPIRED', timestamp: a.resolvedAt || a.expiresAt || a.offeredAt }));
  if (!mine) return offers;
  if (b.status === 'delivered') return [...offers, { ...base, id: String(b._id), type: 'DELIVERED', timestamp: b.proof?.delivery?.verifiedAt || b.updatedAt, amount: (b.pricing?.driverPaise || 0) / 100 }];
  if (b.status === 'delivery_failed' || (b.status === 'cancelled' && b.exception)) return [...offers, { ...base, id: String(b._id), type: 'FAILED', timestamp: b.exception?.at || b.updatedAt }];
  return offers;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const istDayStart = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
};

// @desc    Today's and this week's earnings, read from the rider's completed deliveries
// @route   GET /api/delivery/earnings/summary
// @access  Private (approved delivery partner)
//
// Days and weeks are India time; the week runs Monday to Sunday. Amounts are
// the pay recorded on each Delivery at completion (tip included, as on the
// partner's lifetime total), summed in paise so rupee totals never drift.
export const getEarningsSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const todayStart = istDayStart(now);
  const weekdayIndex = (new Date(now.getTime() + IST_OFFSET_MS).getUTCDay() + 6) % 7;
  const weekStart = new Date(todayStart.getTime() - weekdayIndex * DAY_MS);

  const deliveries = await Delivery.find({ partnerId: req.partner._id, status: 'delivered', endTime: { $gte: weekStart, $lte: now } })
    .select('orderId returnId direction endTime partnerEarnings partnerTip')
    .populate('orderId', 'orderNo paymentMethod pricing.totalAmount')
    .populate('returnId', 'returnNumber')
    .sort({ endTime: -1 })
    .lean();

  const paise = (value) => Math.round((Number(value) || 0) * 100);
  const daily = { trips: 0, totalPaise: 0, tipsPaise: 0, breakdown: [] };
  const weekly = { trips: 0, totalPaise: 0, tipsPaise: 0, dayPaise: WEEKDAY_LABELS.map(() => 0) };

  for (const delivery of deliveries) {
    const amountPaise = paise(delivery.partnerEarnings), tipPaise = paise(delivery.partnerTip);
    const dayIndex = Math.floor((istDayStart(delivery.endTime).getTime() - weekStart.getTime()) / DAY_MS);
    weekly.trips += 1; weekly.totalPaise += amountPaise; weekly.tipsPaise += tipPaise;
    if (dayIndex >= 0 && dayIndex < 7) weekly.dayPaise[dayIndex] += amountPaise;
    if (delivery.endTime >= todayStart) {
      daily.trips += 1; daily.totalPaise += amountPaise; daily.tipsPaise += tipPaise;
      const order = delivery.orderId || {};
      const isCod = delivery.direction !== 'return_pickup' && order.paymentMethod === 'cod';
      daily.breakdown.push({
        id: String(delivery._id),
        type: delivery.direction === 'return_pickup' ? 'Return pickup' : 'Delivery',
        completedAt: delivery.endTime,
        orderId: delivery.direction === 'return_pickup' ? delivery.returnId?.returnNumber || '—' : order.orderNo || '—',
        amount: amountPaise / 100,
        tip: tipPaise / 100,
        isCod,
        codAmount: isCod ? Math.round(Number(order.pricing?.totalAmount) || 0) : 0,
      });
    }
  }

  // Parcel jobs pay the rider's fixed earning at delivery. They count towards the same totals; the
  // parcel figures are also returned on their own because parcel pay is released after review.
  const [weekParcels, [lifetimeParcels = { trips: 0, paise: 0 }]] = await Promise.all([
    Parcel.find({ partnerId: req.partner._id, status: 'delivered', 'proof.delivery.verifiedAt': { $gte: weekStart, $lte: now } })
      .select('reference pricing.driverPaise proof.delivery.verifiedAt paymentMethod cash').sort({ 'proof.delivery.verifiedAt': -1 }).lean(),
    Parcel.aggregate([{ $match: { partnerId: req.partner._id, status: 'delivered' } }, { $group: { _id: null, trips: { $sum: 1 }, paise: { $sum: '$pricing.driverPaise' } } }]),
  ]);
  let weekParcelPaise = 0;
  for (const parcel of weekParcels) {
    const amountPaise = parcel.pricing?.driverPaise || 0, completedAt = parcel.proof.delivery.verifiedAt;
    const dayIndex = Math.floor((istDayStart(completedAt).getTime() - weekStart.getTime()) / DAY_MS);
    weekly.trips += 1; weekly.totalPaise += amountPaise; weekParcelPaise += amountPaise;
    if (dayIndex >= 0 && dayIndex < 7) weekly.dayPaise[dayIndex] += amountPaise;
    if (completedAt >= todayStart) {
      const cash = parcel.paymentMethod === 'pay_driver' && parcel.cash?.amountPaise > 0;
      daily.trips += 1; daily.totalPaise += amountPaise;
      daily.breakdown.push({ id: String(parcel._id), type: 'Parcel delivery', completedAt, orderId: parcelNumber(parcel), amount: amountPaise / 100, tip: 0, isCod: cash, codAmount: cash ? parcel.cash.amountPaise / 100 : 0 });
    }
  }
  daily.breakdown.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  return ok(res, {
    timezone: 'Asia/Kolkata',
    parcels: { weekTotal: weekParcelPaise / 100, lifetimeTrips: lifetimeParcels.trips, lifetimeTotal: lifetimeParcels.paise / 100 },
    daily: { date: todayStart, trips: daily.trips, total: daily.totalPaise / 100, tips: daily.tipsPaise / 100, breakdown: daily.breakdown },
    weekly: { weekStart, trips: weekly.trips, total: weekly.totalPaise / 100, tips: weekly.tipsPaise / 100,
      days: WEEKDAY_LABELS.map((day, index) => ({ day, amount: weekly.dayPaise[index] / 100 })) },
  });
});

/* ============================================================================
 * RIDER-INITIATED PAYOUTS — withdraw a specific amount from earnings.pending.
 *
 * Coexists with the pre-existing admin bulk `settleRiderPayout` action in
 * admin.controller.js: that one sweeps whatever `earnings.pending` happens to
 * be at the moment an admin clicks it, while this lets a rider carve out one
 * specific amount and track it as its own request. No double-counting is
 * possible — the reservation below atomically removes `amount` from
 * `earnings.pending` the instant the request is created, so a bulk settle run
 * afterward only ever sees what is left.
 * ========================================================================== */

// @desc    Request a withdrawal of a specific amount from pending earnings
// @route   POST /api/delivery/payouts
// @access  Private/DeliveryPartner (approved)
export const requestPayout = asyncHandler(async (req, res) => {
  const result = await requestVerifiedRiderPayout({ partnerId: req.partner._id, userId: req.user._id,
    amount: req.body.amount, key: req.get('Idempotency-Key') || req.body.idempotencyKey });
  return res.status(201).json({ success: true, message: 'Payout reservation recorded', data: result });
});

// @desc    This rider's own payout request history
// @route   GET /api/delivery/payouts
// @access  Private/DeliveryPartner (approved)
export const getMyPayouts = asyncHandler(async (req, res) => {
  const partner = req.partner;
  const { page, limit, skip } = getPagination(req.query);

  const [rows, total] = await Promise.all([
    DeliveryPayout.find({ partnerId: partner._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DeliveryPayout.countDocuments({ partnerId: partner._id }),
  ]);

  return paginated(res, rows, { page, limit, total });
});
