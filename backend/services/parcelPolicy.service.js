import ParcelPolicy from '../models/ParcelPolicy.js';
import { httpError } from '../utils/response.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
export const RIDER_VEHICLE_TYPES = ['bicycle', 'bike', 'auto', 'car'];
// Pictures customers see for a vehicle (the admin picks one).
export const PARCEL_VEHICLE_ICONS = ['bike', 'scooter', 'auto', 'car', 'van', 'truck'];
export const failParcel = (message, status = 400) => { throw httpError(status, message); };
export const flagNames = ['catalogue', 'booking', 'online_payment', 'pay_driver', 'auto_assignment', 'admin_fallback', 'fulfilment', 'refunds'];
export const parcelFlags = () => Object.fromEntries(flagNames.map(k => [k, true]));
export const productionParcel = () => ['production','prod','deployment-production'].includes(String(process.env.NODE_ENV).trim().toLowerCase()) || ['production','prod','deployment-production'].includes(String(process.env.DEPLOYMENT_ENV).trim().toLowerCase());
export function requireParcel(kind) {
  if (!parcelFlags()[kind]) failParcel('Parcel capability is not enabled', 503);
  if (productionParcel() && kind !== 'catalogue') failParcel('Production parcel operations are release-blocked', 503);
}
export function requireParcelGateway(kind = 'online_payment') {
  requireParcel(kind);
  if (process.env.PAYMENT_GATEWAY !== 'razorpay' || process.env.RAZORPAY_MODE !== 'test' || !process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) failParcel('Parcel gateway execution requires isolated Razorpay test mode', 503);
}
export function parcelPermission(req, key) {
  if (req.userType !== 'admin' || (req.user.role !== 'superAdmin' && !req.user.permissions?.includes(key))) failParcel(`${key} permission required`, 403);
}
export const boundedText = (value, label, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) failParcel(`${label} is required (maximum ${max} characters)`);
  return value.trim();
};
export const integer = (n, label, min = 0, max = MAX_CHECKOUT_PAISE) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) failParcel(`Invalid ${label}`);
  return n;
};
const strings = (v, label) => {
  if (!Array.isArray(v) || !v.length || v.length > 100) failParcel(`Explicit ${label} list required`);
  return [...new Set(v.map(x => boundedText(x, label, 100)))];
};
export function validateParcelPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) failParcel('An explicit policy object is required');
  const c = {};
  c.approvalReference = boundedText(input.approvalReference, 'Policy note');
  c.terms = boundedText(input.terms, 'Customer cancellation, prohibited parcel and failure terms', 10000);
  c.effectiveAt = new Date(input.effectiveAt);
  if (!Number.isFinite(c.effectiveAt.getTime())) failParcel('Effective date required');
  c.categories = strings(input.categories, 'allowed categories');
  c.prohibitedItems = strings(input.prohibitedItems, 'prohibited items');
  if (!Array.isArray(input.areas) || !input.areas.length || input.areas.length > 100) failParcel('Explicit service areas required');
  c.areas = input.areas.map(a => { if (!a || typeof a !== 'object') failParcel('Invalid service area'); return { name: boundedText(a.name, 'Area name', 100), pincodes: strings(a.pincodes, 'pincodes').map(p => { if (!/^\d{6}$/.test(p)) failParcel('Invalid pincode'); return p; }), lat: coordinate(a.lat, 90), lng: coordinate(a.lng, 180), radiusKm: positive(a.radiusKm, 'area radius', 100) }; });
  for (const [k, min, max] of [['basePaise',0,MAX_CHECKOUT_PAISE],['perKmPaise',0,MAX_CHECKOUT_PAISE],['minimumPaise',1,MAX_CHECKOUT_PAISE],['maximumPaise',1,MAX_CHECKOUT_PAISE],['driverBasePaise',0,MAX_CHECKOUT_PAISE],['driverPerKmPaise',0,MAX_CHECKOUT_PAISE],['quoteSeconds',30,3600],['acceptanceSeconds',15,600],['maxAttempts',1,20],['maxActiveTasks',1,10],['locationMaxAgeSeconds',30,3600]]) c[k] = integer(input[k], k, min, max);
  for (const [k, max] of [['maxWeightKg',100],['maxDimensionCm',500],['assignmentRadiusKm',100],['maxRouteKm',500]]) c[k] = positive(input[k], k, max);
  // ---- Dynamic pricing (all admin-set; absent on older policies, which price exactly as before)
  // Kilometres covered by the starting fee before distance charges begin.
  c.includedKm = input.includedKm === undefined || input.includedKm === null || input.includedKm === '' ? 0 : nonNegative(input.includedKm, 'included kilometres', c.maxRouteKm);
  // Distance slabs: from the included km (or the previous slab) up to `upToKm`, charged at the
  // slab's customer and driver per-km rates. Beyond the last slab the standard per-km rates apply.
  const rawSlabs = input.distanceSlabs ?? [];
  if (!Array.isArray(rawSlabs) || rawSlabs.length > 20) failParcel('Provide at most 20 distance slabs');
  let previousKm = c.includedKm;
  c.distanceSlabs = rawSlabs.map((s, i) => {
    if (!s || typeof s !== 'object') failParcel('Invalid distance slab');
    const upToKm = positive(s.upToKm, `slab ${i + 1} end distance`, c.maxRouteKm);
    if (upToKm <= previousKm) failParcel(`Slab ${i + 1} must end after ${previousKm} km`);
    previousKm = upToKm;
    return { upToKm, perKmPaise: integer(s.perKmPaise, `slab ${i + 1} customer rate`), driverPerKmPaise: integer(s.driverPerKmPaise, `slab ${i + 1} driver rate`) };
  });
  // Weight surcharge tiers: the highest tier whose `aboveKg` the parcel exceeds applies.
  const rawTiers = input.weightTiers ?? [];
  if (!Array.isArray(rawTiers) || rawTiers.length > 20) failParcel('Provide at most 20 weight tiers');
  c.weightTiers = rawTiers.map((t, i) => {
    if (!t || typeof t !== 'object') failParcel('Invalid weight tier');
    const aboveKg = nonNegative(t.aboveKg, `weight tier ${i + 1} weight`, c.maxWeightKg);
    if (aboveKg >= c.maxWeightKg) failParcel(`Weight tier ${i + 1} must start below the heaviest parcel allowed (${c.maxWeightKg} kg)`);
    const surchargePaise = integer(t.surchargePaise, `weight tier ${i + 1} surcharge`);
    const driverPaise = integer(t.driverPaise ?? 0, `weight tier ${i + 1} driver share`);
    if (driverPaise > surchargePaise) failParcel(`Weight tier ${i + 1}: the driver share cannot exceed the surcharge`);
    return { aboveKg, surchargePaise, driverPaise };
  }).sort((a, b) => a.aboveKg - b.aboveKg);
  if (new Set(c.weightTiers.map(t => t.aboveKg)).size !== c.weightTiers.length) failParcel('Weight tiers must start at different weights');
  // Fixed platform handling fee added to every booking.
  c.handlingFeePaise = input.handlingFeePaise === undefined || input.handlingFeePaise === null || input.handlingFeePaise === '' ? 0 : integer(input.handlingFeePaise, 'handling fee');
  // Fare boost: when no rider accepts, the customer may add one of these amounts to the fare.
  c.boostEnabled = input.boostEnabled === true;
  const rawBoosts = input.boostOptionsPaise ?? [];
  if (!Array.isArray(rawBoosts) || rawBoosts.length > 8) failParcel('Provide at most 8 boost amounts');
  c.boostOptionsPaise = [...new Set(rawBoosts.map((v, i) => integer(v, `boost amount ${i + 1}`, 1)))].sort((a, b) => a - b);
  c.boostDriverShareBps = input.boostDriverShareBps === undefined || input.boostDriverShareBps === null || input.boostDriverShareBps === '' ? 10000 : integer(input.boostDriverShareBps, 'driver share of boosts', 0, 10000);
  c.maxBoostPaise = input.maxBoostPaise === undefined || input.maxBoostPaise === null || input.maxBoostPaise === '' ? 0 : integer(input.maxBoostPaise, 'maximum total boost');
  if (c.boostEnabled && (!c.boostOptionsPaise.length || c.maxBoostPaise < c.boostOptionsPaise[0])) failParcel('Fare boost needs at least one amount and a maximum total boost of at least the smallest amount');
  // ---- Vehicles (optional). With none, the policy prices one "Doorstep delivery" service as before.
  // Each vehicle has its own capacity, rates and the rider vehicle types allowed to carry it.
  const rawVehicles = input.vehicles ?? [];
  if (!Array.isArray(rawVehicles) || rawVehicles.length > 20) failParcel('Provide at most 20 vehicles');
  const vehicleIds = new Set();
  c.vehicles = rawVehicles.map((v, i) => {
    const label = `Vehicle ${i + 1}`;
    if (!v || typeof v !== 'object' || Array.isArray(v)) failParcel(`Invalid ${label.toLowerCase()}`);
    const id = boundedText(v.id, `${label} code`, 40).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) failParcel(`${label} code may use only letters, numbers, - and _`);
    if (vehicleIds.has(id)) failParcel(`Vehicle code ${id} is used twice`);
    vehicleIds.add(id);
    const riderVehicleTypes = [...new Set(Array.isArray(v.riderVehicleTypes) ? v.riderVehicleTypes : [])];
    if (!riderVehicleTypes.length || riderVehicleTypes.some(t => !RIDER_VEHICLE_TYPES.includes(t))) failParcel(`${label}: choose which rider vehicles (${RIDER_VEHICLE_TYPES.join(', ')}) can carry it`);
    if (!Array.isArray(v.dimensionsCm) || v.dimensionsCm.length !== 3) failParcel(`${label}: length, width and height are required`);
    const vehicle = {
      id, name: boundedText(v.name, `${label} name`, 60),
      description: typeof v.description === 'string' ? v.description.trim().slice(0, 200) : '',
      enabled: v.enabled !== false, riderVehicleTypes,
      icon: PARCEL_VEHICLE_ICONS.includes(v.icon) ? v.icon : ({ bicycle:'bike', bike:'bike', auto:'auto', car:'car' })[riderVehicleTypes[0]],
      maxWeightKg: positive(v.maxWeightKg, `${label} capacity`, 5000),
      dimensionsCm: v.dimensionsCm.map(n => positive(n, `${label} size`, 1000)),
      includedKm: v.includedKm === undefined || v.includedKm === null || v.includedKm === '' ? 0 : nonNegative(v.includedKm, `${label} included kilometres`, c.maxRouteKm),
    };
    for (const [k, min] of [['basePaise', 0], ['perKmPaise', 0], ['minimumPaise', 1], ['driverBasePaise', 0], ['driverPerKmPaise', 0]]) vehicle[k] = integer(v[k], `${label} ${k}`, min);
    if (vehicle.minimumPaise > c.maximumPaise || vehicle.driverBasePaise > c.maximumPaise) failParcel(`${label}: fares must stay within the highest delivery fee`);
    return vehicle;
  });
  if (c.vehicles.length && !c.vehicles.some(v => v.enabled)) failParcel('Enable at least one vehicle');
  // Customer cancellation: instant while no rider has accepted (default), or always admin-reviewed.
  if (![undefined, 'instant_before_assignment', 'admin_review'].includes(input.customerCancel)) failParcel('Unsupported customer cancellation setting');
  c.customerCancel = input.customerCancel || 'instant_before_assignment';
  // Supported initial policy combinations are intentionally explicit.
  if (input.taxTreatment !== 'inclusive' || !['none', 'weight', undefined].includes(input.surcharges) || input.cancellationMode !== 'admin_review' || input.failureMode !== 'admin_review' || !['pickup','delivery','customer_choice'].includes(input.cashCollectionPoint) || input.partialCash !== false || typeof input.payDriverEnabled !== 'boolean') failParcel('Unsupported policy: require inclusive approved taxes, no surcharges, admin review, an approved cash collection point and exact cash');
  Object.assign(c, { taxTreatment: 'inclusive', surcharges: c.weightTiers.length ? 'weight' : 'none', cancellationMode: 'admin_review', failureMode: 'admin_review', cashCollectionPoint: input.cashCollectionPoint, partialCash: false, payDriverEnabled: input.payDriverEnabled });
  c.taxRateBps = integer(input.taxRateBps, 'explicit inclusive tax rate in basis points', 0, 10000);
  c.payDriverCategories = strings(input.payDriverCategories, 'pay-driver categories');
  if (c.payDriverCategories.some(x => !c.categories.includes(x)) || c.minimumPaise > c.maximumPaise || c.driverBasePaise > c.maximumPaise) failParcel('Inconsistent fare or category policy');
  if (c.maxActiveTasks !== 1 || c.categories.some(x=>c.prohibitedItems.includes(x))) failParcel('Initial parcel policy requires exclusive single-task custody and disjoint allowed/prohibited categories');
  return c;
}
export function coordinate(n, max) { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > max) failParcel('Valid map coordinates required'); return n; }
export const parcelCashCollectionPoints = config => config?.cashCollectionPoint === 'customer_choice' ? ['pickup','delivery'] : [config?.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery'];
function positive(n, label, max) { if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > max) failParcel(`Invalid ${label}`); return n; }
function nonNegative(n, label, max) { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) failParcel(`Invalid ${label}`); return n; }
export async function currentParcelPolicy(session) {
  const q = ParcelPolicy.findById('parcel');
  const p = await (session ? q.session(session) : q);
  if (!p || new Date(p.config.effectiveAt) > new Date()) failParcel('An effective approved parcel policy is required', 409);
  return p;
}
export function validateParcelDetails(input, c, distance) {
  const address = (a = {}, label) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) failParcel('Complete address required');
    const v = { address: boundedText(a.address, 'Address'), name: boundedText(a.name, 'Contact name', 100), phone: boundedText(a.phone, 'Phone', 20), pincode: boundedText(a.pincode, 'Pincode', 6), lat: coordinate(a.lat,90), lng: coordinate(a.lng,180) };
    if (!/^\d{6}$/.test(v.pincode) || !/^\+?[1-9]\d{9,14}$/.test(v.phone)) failParcel('Valid phone and pincode required');
    const matchingAreas = c.areas.filter(x => x.pincodes.includes(v.pincode));
    if (!matchingAreas.length) failParcel(`${label} address is outside approved service areas: pincode ${v.pincode} is not approved for parcel delivery. Choose another location.`);
    if (!matchingAreas.some(x => distance(x,v) <= x.radiusKm)) failParcel(`${label} address is outside approved service areas: the selected pin is outside the coverage radius for pincode ${v.pincode}. Check the map pin.`);
    return v;
  };
  if (!c.categories.includes(input.category) || input.acceptRestrictions !== true) failParcel('Select an approved category and accept parcel restrictions');
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim().slice(0,500) : '';
  const vehicles = parcelVehicles(c);
  if (vehicles.length) {
    // Vehicle bookings: goods default to "<category>, up to the vehicle's capacity, in the vehicle's
    // load space". A stated weight or size must fit at least one vehicle; the chosen one is checked at booking.
    const blank = v => v === undefined || v === null || v === '';
    const weightKg = blank(input.weightKg) ? null : positive(input.weightKg, 'weight', Math.max(...vehicles.map(v => v.maxWeightKg)));
    const dimensions = blank(input.dimensions) ? null : input.dimensions;
    if (dimensions && (!Array.isArray(dimensions) || dimensions.length !== 3)) failParcel('Three dimensions required');
    const packages = blank(input.packages) ? 1 : integer(input.packages, 'number of packages', 1, 99);
    const description = typeof input.description === 'string' && input.description.trim() ? boundedText(input.description, 'Parcel description') : input.category;
    return { pickup: address(input.pickup, 'Pickup'), dropoff: address(input.dropoff, 'Drop'), category: input.category, description, weightKg, ...(dimensions ? { dimensions: dimensions.map(n => positive(n, 'dimension', 1000)) } : {}), packages, instructions, acceptRestrictions: true };
  }
  const dimensions = input.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length !== 3) failParcel('Three dimensions required');
  return { pickup: address(input.pickup, 'Pickup'), dropoff: address(input.dropoff, 'Drop'), category: input.category, description: boundedText(input.description,'Parcel description'), weightKg: positive(input.weightKg,'weight',c.maxWeightKg), dimensions: dimensions.map(n => positive(n,'dimension',c.maxDimensionCm)), instructions, acceptRestrictions: true };
}
/** Whether goods described in quote details fit a vehicle. */
export function parcelVehicleFits(details, v) {
  if (details.weightKg != null && details.weightKg > v.maxWeightKg) return false;
  if (details.dimensions) {
    const goods = [...details.dimensions].sort((a, b) => b - a), space = [...v.dimensionsCm].sort((a, b) => b - a);
    if (goods.some((n, i) => n > space[i])) return false;
  }
  return true;
}
/**
 * Splits a route into charged distance bands from the admin's settings:
 * the starting fee covers `includedKm`, each slab covers up to its `upToKm` at its
 * own customer/driver rate, and anything beyond the last slab uses the standard
 * per-km rates. Returns the bands in metres (whole metres, no rounding loss).
 */
export function parcelDistanceBands(metres, c) {
  const includedMetres = Math.round((c.includedKm || 0) * 1000);
  const bands = [];
  let from = includedMetres;
  for (const slab of c.distanceSlabs || []) {
    const to = Math.round(slab.upToKm * 1000);
    if (metres > from) bands.push({ fromKm: from / 1000, toKm: Math.min(metres, to) / 1000, metres: Math.min(metres, to) - from, perKmPaise: slab.perKmPaise, driverPerKmPaise: slab.driverPerKmPaise });
    from = to;
  }
  if (metres > from) bands.push({ fromKm: from / 1000, toKm: metres / 1000, metres: metres - from, perKmPaise: c.perKmPaise, driverPerKmPaise: c.driverPerKmPaise });
  return bands;
}
/** The weight tier for a parcel: the highest tier the weight exceeds, or none. */
export const parcelWeightTier = (weightKg, c) => (c.weightTiers || []).filter(t => Number(weightKg) > t.aboveKg).sort((a, b) => b.aboveKg - a.aboveKg)[0] || null;

/** Vehicles customers can choose now. Empty means the legacy single service. */
export const parcelVehicles = c => (c?.vehicles || []).filter(v => v.enabled);
/**
 * The policy as it applies to one vehicle: the vehicle's own flat rates and capacity.
 * Distance slabs and weight tiers belong to the single-service policy; a vehicle's
 * price already reflects what it can carry.
 */
export function parcelVehicleConfig(c, v) {
  return { ...c, basePaise: v.basePaise, perKmPaise: v.perKmPaise, minimumPaise: v.minimumPaise, driverBasePaise: v.driverBasePaise, driverPerKmPaise: v.driverPerKmPaise,
    includedKm: v.includedKm || 0, distanceSlabs: [], weightTiers: [], maxWeightKg: v.maxWeightKg, maxDimensionCm: Math.max(...v.dimensionsCm) };
}
/** What a booking records about its vehicle (frozen with the booking). */
export const parcelVehicleSnapshot = v => ({ id: v.id, name: v.name, icon: v.icon, riderVehicleTypes: [...v.riderVehicleTypes], maxWeightKg: v.maxWeightKg, dimensionsCm: [...v.dimensionsCm] });
/**
 * Customer fare and driver earning, entirely from the admin's policy:
 *   customer = max(minimum, starting fee + slab distance charges + weight surcharge + handling fee)
 *   driver   = starting driver earning + slab driver rates + weight-tier driver share
 * GST is included in the customer fare. Older policies (no included km, slabs, tiers or
 * handling fee) produce exactly the previous figures.
 */
export function parcelFare(distanceKm, p, details = {}, vehicle) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > p.config.maxRouteKm) failParcel('Route distance is unsupported', 409);
  const c = vehicle ? parcelVehicleConfig(p.config, vehicle) : p.config, metres = Math.ceil(distanceKm * 1000);
  const bands = parcelDistanceBands(metres, c);
  // One rounding per side (up to the paisa), so a single-band policy equals the old formula.
  const distanceFee = Math.ceil(bands.reduce((sum, b) => sum + b.metres * b.perKmPaise, 0) / 1000);
  const driverDistance = Math.ceil(bands.reduce((sum, b) => sum + b.metres * b.driverPerKmPaise, 0) / 1000);
  const tier = parcelWeightTier(details.weightKg, c);
  const weightSurchargePaise = tier?.surchargePaise || 0;
  const handlingFeePaise = c.handlingFeePaise || 0;
  const totalPaise = Math.max(c.minimumPaise, c.basePaise + distanceFee + weightSurchargePaise + handlingFeePaise);
  const driverPaise = c.driverBasePaise + driverDistance + (tier?.driverPaise || 0);
  const taxPaise = Math.round(totalPaise * c.taxRateBps / (10000 + c.taxRateBps));
  if (!Number.isSafeInteger(totalPaise) || totalPaise > c.maximumPaise || driverPaise > totalPaise-taxPaise) failParcel('Fare or earning exceeds approved limits',409);
  return { policyVersion: p.version, policy: structuredClone(p.config), distanceMetres: metres, basePaise: c.basePaise, distancePaise: distanceFee,
    weightSurchargePaise, handlingFeePaise, includedKm: c.includedKm || 0,
    bands: bands.map(b => ({ fromKm: b.fromKm, toKm: b.toKm, perKmPaise: b.perKmPaise })),
    totalPaise, taxPaise, driverPaise, platformPaise: totalPaise - taxPaise - driverPaise, currency: 'INR' };
}
/**
 * A fare after the customer adds `amountPaise` as a boost. The rider receives the
 * admin's share of it (frozen with the booking's policy); GST stays included in the
 * fare, and customer total = GST + rider + platform always holds.
 */
export function boostedParcelPricing(pricing, amountPaise) {
  const c = pricing.policy;
  const totalPaise = pricing.totalPaise + amountPaise;
  const driverBoostPaise = Math.floor(amountPaise * (c.boostDriverShareBps ?? 10000) / 10000);
  const driverPaise = pricing.driverPaise + driverBoostPaise;
  const taxPaise = Math.round(totalPaise * c.taxRateBps / (10000 + c.taxRateBps));
  if (!Number.isSafeInteger(totalPaise) || totalPaise > MAX_CHECKOUT_PAISE || driverPaise > totalPaise - taxPaise) failParcel('Boosted fare exceeds approved limits', 409);
  return { totalPaise, driverPaise, taxPaise, platformPaise: totalPaise - taxPaise - driverPaise, driverBoostPaise, boostPaise: (pricing.boostPaise || 0) + amountPaise };
}
export function parcelSettlementBlockers(b) {
  const reasons = ['parcel_payout_adapter_not_release_approved'];
  if (b.status !== 'delivered') reasons.push('delivery_not_verified');
  if (b.paymentMethod === 'online' && !b.finance.bankEvidence) reasons.push('gateway_bank_settlement_unreconciled');
  if (b.paymentMethod === 'pay_driver' && b.cash.status !== 'reconciled') reasons.push('cash_deposit_unreconciled');
  if (b.finance.dispute || b.cancellation || b.exception?.status === 'admin_review') reasons.push('operational_or_financial_review');
  if (b.finance.refundStatus && b.finance.refundStatus !== 'confirmed') reasons.push('refund_unresolved');
  return reasons;
}
// A financial review must never become a dispatch or proof bypass after an
// operational cancellation/exception is rejected or retried.
export const parcelOperationalHold = b => Boolean(b.finance?.dispute
  || b.finance?.gatewayDisputes?.length
  || (b.finance?.refundStatus && b.finance.refundStatus !== 'none')
  || b.finance?.refundedPaise > 0);
